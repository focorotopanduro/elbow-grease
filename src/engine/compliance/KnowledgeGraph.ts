/**
 * Knowledge Graph — RDF-inspired triple store for IPC rules.
 *
 * Stores the plumbing code as (subject, predicate, object) triples
 * that can be queried with pattern matching. This replaces hardcoded
 * if/else compliance logic with a declarative, extensible rule base.
 *
 * Triple format:
 *   Subject   — entity URI (e.g. "bldg:pipe-42", "ipc:TrapArm")
 *   Predicate — relationship or property (e.g. "ipc:maxDistance")
 *   Object    — value or entity URI (e.g. 5.0, "ipc:Fixture")
 *
 * The KG supports:
 *   - Pattern matching queries (SPARQL-like WHERE clauses)
 *   - Inference via transitivity (isUpstreamOf chains)
 *   - Rule templates that bind to graph patterns
 *   - Live binding to the PlumbingDAG (building instances)
 */

import type { CodeReference, ViolationSeverity } from './IPCOntology';

// ── Triple ──────────────────────────────────────────────────────

export interface Triple {
  subject: string;
  predicate: string;
  object: string | number | boolean;
  /** Provenance: which code section contributed this triple. */
  source?: CodeReference;
}

// ── Query pattern ───────────────────────────────────────────────

export interface TriplePattern {
  subject?: string;     // null = wildcard
  predicate?: string;
  object?: string | number | boolean;
}

// ── Rule template ───────────────────────────────────────────────

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  codeRef: CodeReference;
  severity: ViolationSeverity;

  /**
   * WHERE clause: patterns that must all match for this rule to fire.
   * Variables start with ? (e.g. "?pipe", "?fixture").
   */
  conditions: RuleCondition[];

  /**
   * CHECK clause: the actual constraint to evaluate.
   * If this returns a cost > 0, the rule is violated.
   */
  check: ConstraintCheck;
}

export interface RuleCondition {
  subject: string;    // entity ref or ?variable
  predicate: string;
  object: string;     // entity ref, ?variable, or literal
}

export interface ConstraintCheck {
  /** The variable to evaluate (e.g. "?pipe"). */
  variable: string;
  /** Which property to read from the bound entity. */
  property: string;
  /** Comparison operator. */
  op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
  /** Threshold value or reference to another variable's property. */
  threshold: number | { variable: string; property: string };
  /** Human message template (variables substituted at runtime). */
  message: string;
}

// ── Knowledge Graph class ───────────────────────────────────────

export class KnowledgeGraph {
  private triples: Triple[] = [];

  /** Index: subject → triples. */
  private bySubject = new Map<string, Triple[]>();
  /** Index: predicate → triples. */
  private byPredicate = new Map<string, Triple[]>();
  /** Index: object → triples (string keys only). */
  private byObject = new Map<string, Triple[]>();

  /** Registered rule templates. */
  private rules: RuleTemplate[] = [];

  // ── Triple CRUD ─────────────────────────────────────────────

  add(triple: Triple): void {
    this.triples.push(triple);
    this.indexTriple(triple);
  }

  addBatch(triples: Triple[]): void {
    for (const t of triples) this.add(t);
  }

  remove(subject: string, predicate: string): void {
    this.triples = this.triples.filter(
      (t) => !(t.subject === subject && t.predicate === predicate),
    );
    this.rebuildIndex();
  }

  /** Get all triples for a subject. */
  about(subject: string): Triple[] {
    return this.bySubject.get(subject) ?? [];
  }

  /** Get a single value: kg.value("bldg:pipe-1", "ipc:diameter") → 2 */
  value(subject: string, predicate: string): string | number | boolean | undefined {
    const matches = (this.bySubject.get(subject) ?? [])
      .filter((t) => t.predicate === predicate);
    return matches[0]?.object;
  }

  // ── Pattern matching ────────────────────────────────────────

  /**
   * Query triples matching a pattern. Null fields are wildcards.
   */
  query(pattern: TriplePattern): Triple[] {
    let results = this.triples;

    if (pattern.subject !== undefined) {
      results = this.bySubject.get(pattern.subject) ?? [];
    }

    if (pattern.predicate !== undefined) {
      results = results.filter((t) => t.predicate === pattern.predicate);
    }

    if (pattern.object !== undefined) {
      results = results.filter((t) => t.object === pattern.object);
    }

    return results;
  }

  /**
   * Multi-pattern query with variable binding.
   * Variables start with "?" and bind across patterns.
   *
   * Returns all valid binding sets.
   */
  queryPatterns(patterns: RuleCondition[]): Map<string, string | number | boolean>[] {
    if (patterns.length === 0) return [new Map()];

    // Start with first pattern
    let bindings = this.matchPattern(patterns[0]!, new Map());

    // Progressively narrow with subsequent patterns
    for (let i = 1; i < patterns.length; i++) {
      const nextBindings: Map<string, string | number | boolean>[] = [];
      for (const binding of bindings) {
        const matches = this.matchPattern(patterns[i]!, binding);
        nextBindings.push(...matches);
      }
      bindings = nextBindings;
    }

    return bindings;
  }

  private matchPattern(
    pattern: RuleCondition,
    existingBindings: Map<string, string | number | boolean>,
  ): Map<string, string | number | boolean>[] {
    const results: Map<string, string | number | boolean>[] = [];

    // Resolve pattern fields (substitute bound variables)
    const subj = this.resolveField(pattern.subject, existingBindings);
    const pred = pattern.predicate; // predicates are never variables
    const obj = this.resolveField(pattern.object, existingBindings);

    const isSubjVar = pattern.subject.startsWith('?') && subj === undefined;
    const isObjVar = pattern.object.startsWith('?') && obj === undefined;

    const candidates = this.query({
      subject: isSubjVar ? undefined : (subj as string),
      predicate: pred,
      object: isObjVar ? undefined : obj,
    });

    for (const triple of candidates) {
      const newBindings = new Map(existingBindings);
      let valid = true;

      if (isSubjVar) {
        newBindings.set(pattern.subject, triple.subject);
      } else if (subj !== undefined && triple.subject !== subj) {
        valid = false;
      }

      if (isObjVar) {
        newBindings.set(pattern.object, triple.object);
      } else if (obj !== undefined && triple.object !== obj) {
        valid = false;
      }

      if (valid) results.push(newBindings);
    }

    return results;
  }

  private resolveField(
    field: string,
    bindings: Map<string, string | number | boolean>,
  ): string | number | boolean | undefined {
    if (field.startsWith('?')) {
      return bindings.get(field);
    }
    // Try parsing as number
    const num = Number(field);
    if (!isNaN(num)) return num;
    // Boolean
    if (field === 'true') return true;
    if (field === 'false') return false;
    return field;
  }

  // ── Transitive closure ────────────────────────────────────────

  /**
   * Follow a transitive predicate chain from a starting subject.
   * E.g. all entities upstream: transitiveFollow("bldg:node-5", "ipc:isUpstreamOf")
   */
  transitiveFollow(start: string, predicate: string, maxDepth = 50): string[] {
    const visited = new Set<string>();
    const queue = [start];
    const result: string[] = [];

    while (queue.length > 0 && result.length < maxDepth) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (current !== start) result.push(current);

      const matches = this.query({ subject: current, predicate });
      for (const t of matches) {
        if (typeof t.object === 'string') queue.push(t.object);
      }
    }

    return result;
  }

  // ── Rule engine ───────────────────────────────────────────────

  /** Register a compliance rule template. */
  registerRule(rule: RuleTemplate): void {
    this.rules.push(rule);
  }

  registerRules(rules: RuleTemplate[]): void {
    for (const r of rules) this.registerRule(r);
  }

  /** Get all registered rules. */
  getRules(): RuleTemplate[] {
    return [...this.rules];
  }

  /** Get rule by ID. */
  getRule(id: string): RuleTemplate | undefined {
    return this.rules.find((r) => r.id === id);
  }

  // ── Stats ─────────────────────────────────────────────────────

  get tripleCount(): number { return this.triples.length; }
  get ruleCount(): number { return this.rules.length; }

  clear(): void {
    this.triples = [];
    this.rules = [];
    this.bySubject.clear();
    this.byPredicate.clear();
    this.byObject.clear();
  }

  // ── Index management ──────────────────────────────────────────

  private indexTriple(t: Triple): void {
    if (!this.bySubject.has(t.subject)) this.bySubject.set(t.subject, []);
    this.bySubject.get(t.subject)!.push(t);

    if (!this.byPredicate.has(t.predicate)) this.byPredicate.set(t.predicate, []);
    this.byPredicate.get(t.predicate)!.push(t);

    if (typeof t.object === 'string') {
      if (!this.byObject.has(t.object)) this.byObject.set(t.object, []);
      this.byObject.get(t.object)!.push(t);
    }
  }

  private rebuildIndex(): void {
    this.bySubject.clear();
    this.byPredicate.clear();
    this.byObject.clear();
    for (const t of this.triples) this.indexTriple(t);
  }
}
