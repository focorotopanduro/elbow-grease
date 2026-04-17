/**
 * CustomerTypes — contractor client-management taxonomy.
 *
 * Built on top of customerStore's spec-profile concept. Adds real-world
 * contractor workflow fields: contact, site address, project type,
 * status pipeline, per-phase schedule with dates and status.
 *
 * Status pipeline models the typical sales → build → closeout flow:
 *
 *   lead → quoted → active → on_hold → completed → archived
 *        ↘ lost
 *
 * Phase status is separate and tracks on-site progress per construction
 * phase (underground / rough-in / trim):
 *
 *   not_started → scheduled → in_progress → inspection → passed / failed → completed
 *
 * Project type influences default markups, code overlays, and which
 * fixture templates are relevant.
 */

import type { ConstructionPhase } from '../phases/PhaseTypes';

// ── Contact and address ────────────────────────────────────────

export interface ClientContact {
  personName: string;
  companyName?: string;
  phone?: string;
  email?: string;
  preferredChannel?: 'phone' | 'email' | 'text';
}

export interface SiteAddress {
  street: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
}

// ── Project type & status ──────────────────────────────────────

export type ProjectType =
  | 'residential_new'
  | 'residential_remodel'
  | 'residential_addition'
  | 'commercial_new'
  | 'commercial_remodel'
  | 'commercial_tenant_fit'
  | 'service_call';

export const PROJECT_TYPE_META: Record<ProjectType, { label: string; icon: string; color: string }> = {
  residential_new:       { label: 'Residential — New',      icon: '🏠', color: '#66bb6a' },
  residential_remodel:   { label: 'Residential — Remodel',  icon: '🔨', color: '#ffa726' },
  residential_addition:  { label: 'Residential — Addition', icon: '➕', color: '#42a5f5' },
  commercial_new:        { label: 'Commercial — New',       icon: '🏢', color: '#26a69a' },
  commercial_remodel:    { label: 'Commercial — Remodel',   icon: '🛠',  color: '#ab47bc' },
  commercial_tenant_fit: { label: 'Commercial — TI',        icon: '🧱', color: '#7e57c2' },
  service_call:          { label: 'Service Call',           icon: '🔧', color: '#ef5350' },
};

export type ProjectStatus =
  | 'lead'
  | 'quoted'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'archived'
  | 'lost';

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; color: string; icon: string }> = {
  lead:      { label: 'Lead',        color: '#9e9e9e', icon: '○' },
  quoted:    { label: 'Quoted',      color: '#42a5f5', icon: '📝' },
  active:    { label: 'Active',      color: '#66bb6a', icon: '▶' },
  on_hold:   { label: 'On Hold',     color: '#ffa726', icon: '⏸' },
  completed: { label: 'Completed',   color: '#26c6da', icon: '✓' },
  archived:  { label: 'Archived',    color: '#607d8b', icon: '📦' },
  lost:      { label: 'Lost',        color: '#ef5350', icon: '✕' },
};

// ── Phase schedule ─────────────────────────────────────────────

export type PhaseStatus =
  | 'not_started'
  | 'scheduled'
  | 'in_progress'
  | 'inspection_pending'
  | 'passed'
  | 'failed'
  | 'completed';

export const PHASE_STATUS_META: Record<PhaseStatus, { label: string; color: string; icon: string }> = {
  not_started:        { label: 'Not Started',      color: '#607d8b', icon: '○' },
  scheduled:          { label: 'Scheduled',        color: '#42a5f5', icon: '📅' },
  in_progress:        { label: 'In Progress',      color: '#ffa726', icon: '⏳' },
  inspection_pending: { label: 'Inspection',       color: '#7e57c2', icon: '🔍' },
  passed:             { label: 'Passed',           color: '#66bb6a', icon: '✓' },
  failed:             { label: 'Failed — Redo',    color: '#ef5350', icon: '✕' },
  completed:          { label: 'Completed',        color: '#26c6da', icon: '★' },
};

export interface PhaseSchedule {
  status: PhaseStatus;
  /** ISO date strings. */
  scheduledDate?: string;
  startedDate?: string;
  completedDate?: string;
  /** Crew note or inspector name. */
  note?: string;
}

export type PhaseScheduleMap = Record<ConstructionPhase, PhaseSchedule>;

export function emptyPhaseSchedule(): PhaseScheduleMap {
  return {
    underground: { status: 'not_started' },
    rough_in:    { status: 'not_started' },
    trim:        { status: 'not_started' },
  };
}

// ── Customer extensions (augments existing CustomerProfile) ────

/**
 * Fields added to CustomerProfile beyond the existing spec-template
 * data. All optional so legacy profiles keep working.
 */
export interface CustomerFields {
  contact?: ClientContact;
  siteAddress?: SiteAddress;
  projectType?: ProjectType;
  status?: ProjectStatus;
  phaseSchedule?: PhaseScheduleMap;
  /** Dollar amount of the most recent estimate. */
  estimateAmount?: number;
  /** ISO date string for project start. */
  startDate?: string;
  /** ISO date string for target completion. */
  targetCompleteDate?: string;
  /** Searchable tags (e.g. ["repeat-client", "gc:bobsbuild"]). */
  tags?: string[];
  /** Assigned crew lead (internal text). */
  crewLead?: string;
}
