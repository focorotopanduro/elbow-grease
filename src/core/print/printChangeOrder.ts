/**
 * printChangeOrder — Phase 14.G
 *
 * Print a CHANGE ORDER document — the difference between two saved
 * revisions of the same proposal, rendered as a signable PDF.
 *
 * The flow mirrors `printProposal`:
 *   1. Compose ChangeOrderPrintData from two SavedRevisions + diff.
 *   2. Stage it in usePrintStore.
 *   3. body.classList.add('printing') → 2 frames → window.print().
 *   4. Teardown.
 *
 * The PrintableChangeOrder component (already mounted) subscribes
 * to usePrintStore.changeOrder and renders the CSS/print layout.
 */

import { logger } from '@core/logger/Logger';
import { usePrintStore } from './printProposal';
import {
  diffProposals,
  summarizeChangeOrder,
  type ProposalDiff,
  type SavedRevision,
} from './proposalRevision';

const log = logger('PrintChangeOrder');
const PRINTING_CLASS = 'printing';

// ── Print-data type ──────────────────────────────────────────

export interface ChangeOrderPrintData {
  /** The "P-YYMMDD-XXXX" shared by both revisions. */
  baseNumber: string;
  /** Revision labels on each side ("R1", "R2", ...). */
  fromRevision: SavedRevision;
  toRevision: SavedRevision;
  /** The computed diff. */
  diff: ProposalDiff;
  /** Pre-formatted English summary lines. */
  summary: string[];
  /** ISO timestamp when the change order was generated. */
  generatedAtIso: string;
  /** Human-readable date ("April 18, 2026") for the title block. */
  dateDisplay: string;
}

// ── Controller ────────────────────────────────────────────────

export interface PrintChangeOrderOptions {
  /** The earlier revision — what the customer previously agreed to. */
  from: SavedRevision;
  /** The later revision — what's being proposed now. */
  to: SavedRevision;
}

export async function printChangeOrder(opts: PrintChangeOrderOptions): Promise<void> {
  if (opts.from.baseNumber !== opts.to.baseNumber) {
    throw new Error(
      `Cannot compare revisions from different proposals (${opts.from.baseNumber} vs ${opts.to.baseNumber})`,
    );
  }
  if (opts.from.revisionIndex >= opts.to.revisionIndex) {
    throw new Error(
      `Change order requires earlier → later; got ${opts.from.revisionNumber} → ${opts.to.revisionNumber}`,
    );
  }

  const diff = diffProposals(opts.from.data, opts.to.data);
  const summary = summarizeChangeOrder(diff);
  const now = new Date();

  const changeOrder: ChangeOrderPrintData = {
    baseNumber: opts.from.baseNumber,
    fromRevision: opts.from,
    toRevision: opts.to,
    diff,
    summary,
    generatedAtIso: now.toISOString(),
    dateDisplay: formatDateDisplay(now),
  };

  usePrintStore.setState({ changeOrder });
  document.body.classList.add(PRINTING_CLASS);
  await nextFrame();
  await nextFrame();

  try {
    window.print();
  } catch (err) {
    log.error('window.print() threw', err);
  }

  await sleep(50);
  document.body.classList.remove(PRINTING_CLASS);
  usePrintStore.setState({ changeOrder: null });

  log.info('change order printed', {
    base: opts.from.baseNumber,
    from: opts.from.revisionNumber,
    to: opts.to.revisionNumber,
    netBidDelta: diff.summary.netBidDelta,
  });
}

// ── Tiny helpers (same style as printProposal) ───────────────

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateDisplay(d: Date): string {
  try {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
