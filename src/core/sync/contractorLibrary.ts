/**
 * contractorLibrary — Phase 14.J
 *
 * Shareable bundle format for every contractor-level setting that
 * today lives in localStorage. Lets a contractor:
 *
 *   • Export their full "setup" to a single .elbowlib.json file
 *   • Move to a new machine and import → same rates, templates,
 *     history, identity
 *   • Email a colleague a templates-only bundle to share standard
 *     assemblies without exposing pricing
 *
 * Four sections, each independently exportable/importable:
 *
 *   contractorProfile  (company name, license #, logo, terms)
 *   pricingProfile     (rate, overhead, margin, sales tax rules)
 *   templates          (every saved AssemblyTemplate + order)
 *   revisions          (every SavedRevision across every proposal)
 *
 * The format is JSON-serializable + versioned. Merging is deterministic:
 * the caller supplies a MergeStrategy per-section that controls whether
 * existing items are overwritten, skipped, or "both kept" (rename the
 * incoming copy).
 *
 * This module is pure — no Zustand, no React, no file I/O. It works
 * on plain data. The UI wrapper (LibraryExportImportPanel) handles
 * reading from / writing to the stores + actual file download/upload.
 */

import type { ContractorProfile } from '@core/print/proposalData';
import type { PricingProfile } from '../../engine/export/computeBid';
import type { AssemblyTemplate } from '@core/templates/assemblyTemplate';
import type { SavedRevision } from '@core/print/proposalRevision';

// ── Library format (on-disk schema) ────────────────────────────

export const LIBRARY_SCHEMA_VERSION = 1;
export const LIBRARY_FILE_MAGIC = 'elbow-grease-library';

export interface ContractorLibrary {
  /** Magic + version. Readers must reject unknown values. */
  magic: typeof LIBRARY_FILE_MAGIC;
  version: number;
  /** ISO timestamp the library was exported. */
  exportedAt: string;
  /** Free-form label the user can attach at export time (e.g. "pre-2026
   *  rate bump"). */
  label?: string;

  // Each section is optional — a "templates only" export for sharing
  // with a colleague just omits pricing + revisions + contractor.
  contractorProfile?: ContractorProfile;
  pricingProfile?: PricingProfile;
  templates?: {
    order: string[];
    byId: Record<string, AssemblyTemplate>;
  };
  revisions?: {
    byBase: Record<string, SavedRevision[]>;
  };
}

export type LibrarySection = 'contractorProfile' | 'pricingProfile' | 'templates' | 'revisions';

export type MergeStrategy =
  /** Replace existing values with the incoming copy on conflict. */
  | 'replace'
  /** Keep existing values on conflict; drop the incoming copy. */
  | 'skip'
  /** Keep both — the incoming copy gets a suffix like " (imported)". */
  | 'keep-both';

// ── Export ────────────────────────────────────────────────────

export interface ExportInputs {
  contractorProfile?: ContractorProfile;
  pricingProfile?: PricingProfile;
  templates?: {
    order: string[];
    byId: Record<string, AssemblyTemplate>;
  };
  revisions?: {
    byBase: Record<string, SavedRevision[]>;
  };
  label?: string;
  /** Injectable for tests; defaults to `new Date().toISOString()`. */
  exportedAt?: string;
}

export function buildLibrary(input: ExportInputs): ContractorLibrary {
  const lib: ContractorLibrary = {
    magic: LIBRARY_FILE_MAGIC,
    version: LIBRARY_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
  };
  if (input.label !== undefined && input.label.length > 0) lib.label = input.label;
  if (input.contractorProfile) lib.contractorProfile = input.contractorProfile;
  if (input.pricingProfile) lib.pricingProfile = input.pricingProfile;
  if (input.templates) lib.templates = input.templates;
  if (input.revisions) lib.revisions = input.revisions;
  return lib;
}

export function serializeLibrary(lib: ContractorLibrary): string {
  return JSON.stringify(lib, null, 2);
}

// ── Import / parse ────────────────────────────────────────────

export type ParseResult =
  | { ok: true; library: ContractorLibrary }
  | { ok: false; error: string };

export function parseLibrary(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Library file must be a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.magic !== LIBRARY_FILE_MAGIC) {
    return { ok: false, error: `Not an ELBOW GREASE library file (magic = ${String(obj.magic)}).` };
  }
  const ver = obj.version;
  if (typeof ver !== 'number') {
    return { ok: false, error: 'Library version missing or not a number.' };
  }
  if (ver > LIBRARY_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Library version ${ver} is newer than this app supports (${LIBRARY_SCHEMA_VERSION}). Update the app, or re-export from a matching version.`,
    };
  }
  // Validate shape shallowly — we trust the v1 emitter.
  const lib = parsed as ContractorLibrary;
  if (typeof lib.exportedAt !== 'string') {
    return { ok: false, error: 'exportedAt must be an ISO string.' };
  }
  return { ok: true, library: lib };
}

// ── Summary (for the import-confirm dialog) ──────────────────

export interface LibrarySummary {
  hasContractorProfile: boolean;
  contractorCompanyName?: string;
  hasPricingProfile: boolean;
  pricingProfileName?: string;
  templateCount: number;
  revisionProposalCount: number;
  revisionTotalCount: number;
  exportedAt: string;
  label?: string;
}

export function summarizeLibrary(lib: ContractorLibrary): LibrarySummary {
  const templateCount = lib.templates
    ? Object.keys(lib.templates.byId).length
    : 0;
  let revisionProposalCount = 0;
  let revisionTotalCount = 0;
  if (lib.revisions) {
    for (const [, list] of Object.entries(lib.revisions.byBase)) {
      revisionProposalCount++;
      revisionTotalCount += list.length;
    }
  }
  const out: LibrarySummary = {
    hasContractorProfile: !!lib.contractorProfile,
    hasPricingProfile: !!lib.pricingProfile,
    templateCount,
    revisionProposalCount,
    revisionTotalCount,
    exportedAt: lib.exportedAt,
  };
  if (lib.contractorProfile?.companyName) out.contractorCompanyName = lib.contractorProfile.companyName;
  if (lib.pricingProfile?.name) out.pricingProfileName = lib.pricingProfile.name;
  if (lib.label) out.label = lib.label;
  return out;
}

// ── Merge ─────────────────────────────────────────────────────

export interface MergeState {
  contractorProfile?: ContractorProfile;
  pricingProfile?: PricingProfile;
  templates?: {
    order: string[];
    byId: Record<string, AssemblyTemplate>;
  };
  revisions?: {
    byBase: Record<string, SavedRevision[]>;
  };
}

export interface MergePlan {
  /** Which sections to pull from the incoming library. */
  sections: Partial<Record<LibrarySection, boolean>>;
  /** Per-section conflict strategy. */
  strategyByKind: Partial<Record<LibrarySection, MergeStrategy>>;
}

export interface MergeResult {
  next: MergeState;
  report: MergeReport;
}

export interface MergeReport {
  contractorProfileReplaced: boolean;
  pricingProfileReplaced: boolean;
  templates: {
    added: number;
    replaced: number;
    skipped: number;
    renamed: number;
  };
  revisions: {
    basesAdded: number;
    /** Count of (base, revision) pairs added or replaced. */
    snapshotsAdded: number;
    snapshotsReplaced: number;
    snapshotsSkipped: number;
  };
}

function emptyReport(): MergeReport {
  return {
    contractorProfileReplaced: false,
    pricingProfileReplaced: false,
    templates: { added: 0, replaced: 0, skipped: 0, renamed: 0 },
    revisions: { basesAdded: 0, snapshotsAdded: 0, snapshotsReplaced: 0, snapshotsSkipped: 0 },
  };
}

/**
 * Compute the post-merge state of all sections + a per-section report
 * of what changed. Pure — the caller applies the result to stores.
 */
export function mergeLibrary(
  current: MergeState,
  incoming: ContractorLibrary,
  plan: MergePlan,
): MergeResult {
  const report = emptyReport();
  const next: MergeState = {
    ...(current.contractorProfile !== undefined ? { contractorProfile: current.contractorProfile } : {}),
    ...(current.pricingProfile !== undefined ? { pricingProfile: current.pricingProfile } : {}),
    ...(current.templates !== undefined ? { templates: {
      order: [...current.templates.order],
      byId: { ...current.templates.byId },
    } } : {}),
    ...(current.revisions !== undefined ? { revisions: {
      byBase: Object.fromEntries(
        Object.entries(current.revisions.byBase).map(([k, v]) => [k, [...v]]),
      ),
    } } : {}),
  };

  // ── Contractor profile ──
  if (plan.sections.contractorProfile && incoming.contractorProfile) {
    const strat = plan.strategyByKind.contractorProfile ?? 'replace';
    if (!next.contractorProfile || strat === 'replace') {
      next.contractorProfile = incoming.contractorProfile;
      report.contractorProfileReplaced = true;
    }
    // 'skip' + 'keep-both' both leave the existing alone for profile
    // (there's no meaningful way to "keep both" contractor identities).
  }

  // ── Pricing profile ──
  if (plan.sections.pricingProfile && incoming.pricingProfile) {
    const strat = plan.strategyByKind.pricingProfile ?? 'replace';
    if (!next.pricingProfile || strat === 'replace') {
      next.pricingProfile = incoming.pricingProfile;
      report.pricingProfileReplaced = true;
    }
  }

  // ── Templates ──
  if (plan.sections.templates && incoming.templates) {
    const strat = plan.strategyByKind.templates ?? 'replace';
    const templates = next.templates ?? { order: [], byId: {} };
    for (const id of incoming.templates.order) {
      const inc = incoming.templates.byId[id];
      if (!inc) continue;
      const existing = templates.byId[id];
      if (!existing) {
        templates.byId[id] = inc;
        templates.order = [id, ...templates.order.filter((x) => x !== id)];
        report.templates.added++;
        continue;
      }
      if (strat === 'replace') {
        templates.byId[id] = inc;
        report.templates.replaced++;
      } else if (strat === 'skip') {
        report.templates.skipped++;
      } else {
        // keep-both: clone with a new ID + "(imported)" name suffix
        const newId = `${id}_imp_${Date.now().toString(36)}_${report.templates.renamed}`;
        templates.byId[newId] = {
          ...inc,
          id: newId,
          name: inc.name.endsWith(' (imported)') ? inc.name : `${inc.name} (imported)`,
        };
        templates.order = [newId, ...templates.order];
        report.templates.renamed++;
      }
    }
    next.templates = templates;
  }

  // ── Revisions ──
  if (plan.sections.revisions && incoming.revisions) {
    const strat = plan.strategyByKind.revisions ?? 'skip';
    const revisions = next.revisions ?? { byBase: {} };
    for (const [base, incList] of Object.entries(incoming.revisions.byBase)) {
      const existingList = revisions.byBase[base];
      if (!existingList) {
        revisions.byBase[base] = [...incList];
        report.revisions.basesAdded++;
        report.revisions.snapshotsAdded += incList.length;
        continue;
      }
      const existingByNum = new Map<string, SavedRevision>();
      for (const r of existingList) existingByNum.set(r.revisionNumber, r);
      const merged: SavedRevision[] = [...existingList];
      for (const inc of incList) {
        const hit = existingByNum.get(inc.revisionNumber);
        if (!hit) {
          merged.push(inc);
          report.revisions.snapshotsAdded++;
        } else if (strat === 'replace') {
          const idx = merged.findIndex((r) => r.revisionNumber === inc.revisionNumber);
          if (idx >= 0) merged[idx] = inc;
          report.revisions.snapshotsReplaced++;
        } else {
          // skip + keep-both both leave the existing revision alone —
          // a revision number is a claim on history, not a template
          // name. Duplicate revision numbers would be confusing.
          report.revisions.snapshotsSkipped++;
        }
      }
      merged.sort((a, b) => a.revisionIndex - b.revisionIndex);
      revisions.byBase[base] = merged;
    }
    next.revisions = revisions;
  }

  return { next, report };
}

// ── Filename helper ──────────────────────────────────────────

/**
 * Suggest a default filename for an export. Includes the date + an
 * optional tag so the user can keep multiple saved libraries organized.
 */
export function suggestExportFilename(tag?: string, nowIso?: string): string {
  const iso = nowIso ?? new Date().toISOString();
  const date = iso.slice(0, 10); // YYYY-MM-DD
  const clean = (tag ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const core = clean.length > 0 ? `${clean}-${date}` : `library-${date}`;
  return `${core}.elbowlib.json`;
}
