# ADR 021 — Customer-Linked Bundles (v2) (Phase 11.B)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 11.B
- **Extends:** ADR 020 (Project Bundle Format v1). v1 bundles remain readable via the new v1→v2 migrator.

## Context

Phase 11.A (ADR 020) shipped a functional `.elbow` save/load. The schema was conspicuously anonymous — a bundle had no way to say "this is the Jones Residence project." Every bundle looked the same from outside; the user had to rely on filenames for organization.

At the same time, ELBOW GREASE already had a rich `customerStore` with profiles keyed on contact, site address, project type, and crew lead. Tying those two things together is the obvious next step and it also exercises the migration pattern we scaffolded in v1 — proving the design works before a bigger schema change needs it.

## Decision

Bump the bundle schema to **v2**, adding an optional `project` field that binds a bundle to a customer.

### Schema additions (v2)

```ts
interface BundleV2 {
  version: 2;
  meta: BundleMeta;                 // unchanged
  data: BundleData;                 // unchanged
  project?: BundleProject;          // ← new, optional
}

interface BundleProject {
  customerId?: string;
  customerSnapshot?: {
    name: string;
    contactPerson?: string;
    siteStreet?: string;
    siteCity?: string;
    siteState?: string;
    notes?: string;
  };
}
```

`project` is **optional** — a bundle can omit it entirely (no customer selected) without breaking anything. The snapshot carries the handful of human-readable fields that make the bundle meaningful even without access to the originating `customerStore` (e.g. a user mailing a .elbow file to a colleague on a different installation).

### Migrator (v1 → v2)

```ts
export function migrateV1ToV2(v1: BundleV1): BundleV2 {
  return {
    version: 2,
    meta: v1.meta,
    data: v1.data,
    // project intentionally omitted — v1 had no customer context.
  };
}
```

Pure function. The v1 input is not mutated. `migrateBundle` calls this when it sees `version: 1` and then falls through to `validateV2` as if the bundle had always been v2.

**Invariant:** future migrators are append-only. `migrateV1ToV2` is frozen now — a v3 bump in 2028 must not rewrite it. A v1 bundle saved today must open in any future build that still supports v2 as a legacy floor.

### Capture wiring

`captureBundle()` now reads `useCustomerStore.getState()`:

- If `activeCustomerId` is `null` or the auto-seeded `'default'` profile, `project` is omitted. The default profile represents "no customer chosen yet" and has no meaningful business identity worth recording.
- Otherwise, we populate `customerId` + a `customerSnapshot` of the non-templated fields (`name`, `contact.personName`, `siteAddress.{street,city,state}`, `notes`).

Intentionally **not** captured: templates, default materials, phase schedules. Those belong in the customer store itself — duplicating them into every bundle would bloat files and desync quickly when a user updates the customer profile.

### Apply wiring

`applyBundle()` now returns a `project` field on `ApplyResult`:

```ts
project?: {
  customerId?: string;
  customerName?: string;
  customerResolved: boolean;
}
```

- **`customerResolved: true`** — the bundle referenced a customer ID we found locally; we flipped `activeCustomerId` to it. The UI toast says `"Loaded for {name}"`.
- **`customerResolved: false`** — bundle references an unknown ID (common when moving files between machines); we leave active customer untouched and the toast says `"Loaded (original customer {name} not found locally)"`. The user can manually create the customer later and re-link.

### Toast wiring

`useBundleHotkeys` reads the result and emits a `EV.CUE` with contextual copy. Save: `"Saved for {name} · N pipes, M fixtures"`. Load: `"Loaded for {name} · N pipes, M fixtures"` or `"Loaded (original customer {name} not found locally) · …"`.

## Consequences

**Good:**
- Bundles now carry provenance. `Jones-Residence-2026-04-18.elbow` on disk is unambiguous — even if the filename is renamed or the bundle is sent to a colleague.
- The migration pattern is no longer hypothetical. A concrete pure v1→v2 function exists, tested, and demonstrates the append-only migrator design for future bumps.
- Users who move bundles between machines get a clear message when the customer isn't known locally, rather than silently losing context.

**Accepted costs:**
- `Bundle` type alias changed (now points to `BundleV2` instead of `BundleV1`). Test fixtures that hard-code `version: 1` had to either be updated to `version: 2` or re-typed as `BundleV1` — an expected ripple from a major schema bump. Future code should always use `type Bundle` rather than `type BundleV1` directly.
- Capture reads `useCustomerStore` synchronously inside the bundle module — a direct dep from `core/bundle/` to `store/customerStore`. Acceptable because customer context is inherently a document-level concept.
- Snapshot fields are duplicative with customerStore. Intentional — the snapshot is a "business card" that survives the bundle being detached from its originating store. Templates + schedules stay in the store.

**Non-consequences:**
- No new UI. The Recent Projects panel / customer grouping library is deliberately deferred to a future phase (the useful business value of "which customer is this" lands in the toast, which was already wired).
- Migration is lossless — a user who opens a v1 bundle, migrates, and re-saves gets a v2 bundle with no project field (same as a new blank document with no customer). No data is invented.

## Alternatives considered

**Required project field.** Would force every bundle to have a customer. Rejected — a user sketching a quick test scene shouldn't have to create a Customer first. Optional is correct.

**Full customer profile in the bundle.** Include templates, default materials, codes, phase schedules. Rejected — these are mutable "settings" that belong in a live store, not in a document file. A bundle saved two weeks ago with a then-current template would overwrite a newer template on load, causing silent regressions.

**Per-bundle `projectId` separate from `customerId`.** Model a "project" as its own entity (customer + address + date + design). Rejected for v2 — we don't currently have a projectStore, and overloading customerStore to cover projects would be a larger refactor. A v3 schema can split these if needed.

**Customer ID with no snapshot.** Lighter payload. Rejected because detached bundles (e.g. emailed to a colleague) would read as `"customer abc-123 not found locally"` with zero other context.

## Validation

- `Vitest`: `src/core/bundle/__tests__/Bundle.spec.ts` — 11 new tests for Phase 11.B cover capture-with-default-customer (omission), capture-with-real-customer (population), apply-with-known-id (resolution), apply-with-unknown-id (snapshot-only), v2-with-no-project, three malformed-project validation paths, migrateBundle-v1-produces-v2, migrateV1ToV2-purity, and v1-apply-sets-migrated-true. Total bundle suite: **28 tests**, all green.
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual: activated a non-default customer ("Jones Residence"), drew a pipe, pressed Ctrl+S. File downloaded with `"project"` field populated. Cleared scene, pressed Ctrl+O, opened the file — toast read `"Loaded for Jones Residence"` and `activeCustomerId` flipped.
