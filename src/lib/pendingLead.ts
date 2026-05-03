/**
 * Pending-lead queue. Survives network failures, page refreshes, and
 * tab closes by persisting to localStorage. When the network comes
 * back online, the queued lead is retried automatically.
 *
 * Flow:
 *   1. User submits form. We try to deliver immediately (backend POST
 *      → mailto fallback). If BOTH fail, we enqueue the payload.
 *   2. The hook in MobileLeadCapture listens to `online` events and
 *      drains the queue when connectivity returns.
 *   3. On a successful retry, the entry is removed.
 *   4. Entries older than 7 days are dropped (stale leads aren't
 *      worth bothering the user about — they probably already
 *      called us by then).
 *
 * Versioned envelope so the schema can evolve.
 */

import { generateConfirmationId } from './analytics';

const STORAGE_KEY = 'beit:pending-leads:v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PendingLead {
  /** User-facing receipt — generated when the lead first attempts. */
  confirmationId: string;
  /** When this attempt was first made. Used for staleness checks. */
  enqueuedAt: number;
  /** Retry count — used to back off / give up after N attempts. */
  attempts: number;
  /** The form payload to deliver. */
  payload: {
    name: string;
    phone: string;
    zip: string;
  };
}

interface Stored {
  v: 1;
  leads: PendingLead[];
}

function safeRead(): PendingLead[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.leads)) return [];
    // Drop stale entries (>7d old) on every read so they don't pile up
    return parsed.leads.filter((l) => Date.now() - l.enqueuedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function safeWrite(leads: PendingLead[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (leads.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      const stored: Stored = { v: 1, leads };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    /* quota exceeded / private mode — silently skip */
  }
}

export function enqueueLead(payload: PendingLead['payload'], confirmationId?: string): PendingLead {
  const lead: PendingLead = {
    confirmationId: confirmationId ?? generateConfirmationId(),
    enqueuedAt: Date.now(),
    attempts: 0,
    payload,
  };
  const list = safeRead();
  // De-dupe — if a lead with the same name+phone already exists, refresh
  // its enqueuedAt rather than creating a duplicate (user double-clicked
  // submit while offline).
  const existing = list.findIndex(
    (l) => l.payload.name === payload.name && l.payload.phone === payload.phone
  );
  if (existing >= 0) {
    list[existing].enqueuedAt = Date.now();
    safeWrite(list);
    return list[existing];
  }
  list.push(lead);
  safeWrite(list);
  return lead;
}

export function getPendingLeads(): PendingLead[] {
  return safeRead();
}

export function removePendingLead(confirmationId: string): void {
  const list = safeRead().filter((l) => l.confirmationId !== confirmationId);
  safeWrite(list);
}

export function bumpAttempt(confirmationId: string): void {
  const list = safeRead();
  const lead = list.find((l) => l.confirmationId === confirmationId);
  if (lead) {
    lead.attempts += 1;
    safeWrite(list);
  }
}
