/**
 * CustomerBadge — persistent HUD chip showing the active customer,
 * project status, and one-click access to the CustomerManager.
 *
 * Bottom-left corner. Click body → opens manager. Click status → cycle
 * through active/on_hold/lead for quick status changes without opening
 * the full modal.
 *
 * Shows:
 *   👤 Active Customer Name
 *   [status pill] [phase summary: UG ✓  RI ▶  TR ○]
 *   "123 Oak St, Orlando FL"
 */

import { useState, useEffect } from 'react';
import { useCustomerStore } from '@store/customerStore';
import { CUSTOMER_MANAGER_EVENT } from './useCustomerShortcuts';
import {
  PROJECT_STATUS_META, PHASE_STATUS_META, emptyPhaseSchedule,
  type ProjectStatus, type PhaseStatus,
} from '@core/customers/CustomerTypes';
import { PHASE_META, PHASE_ORDER } from '@core/phases/PhaseTypes';
import { CustomerManager } from './CustomerManager';

export function CustomerBadge() {
  const profiles = useCustomerStore((s) => s.profiles);
  const activeId = useCustomerStore((s) => s.activeCustomerId);
  const setActiveCustomer = useCustomerStore((s) => s.setActiveCustomer);
  const updateProfile = useCustomerStore((s) => s.updateProfile);

  const profile = activeId ? profiles[activeId] : null;
  const [managerOpen, setManagerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    const handler = () => setManagerOpen((v) => !v);
    window.addEventListener(CUSTOMER_MANAGER_EVENT, handler);
    return () => window.removeEventListener(CUSTOMER_MANAGER_EVENT, handler);
  }, []);

  const statusMeta = PROJECT_STATUS_META[(profile?.status ?? 'lead') as ProjectStatus];
  const schedule = profile?.phaseSchedule ?? emptyPhaseSchedule();

  const cycleStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile) return;
    const order: ProjectStatus[] = ['lead', 'quoted', 'active', 'on_hold', 'completed'];
    const cur = (profile.status ?? 'lead') as ProjectStatus;
    const next = order[(order.indexOf(cur) + 1) % order.length]!;
    updateProfile(profile.id, { status: next });
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 12,
          left: 12,
          zIndex: 42,
          background: 'linear-gradient(180deg, rgba(6,12,20,0.95) 0%, rgba(14,22,34,0.9) 100%)',
          border: `1px solid ${statusMeta.color}55`,
          borderRadius: 10,
          padding: '8px 10px',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          color: '#e0ecf3',
          minWidth: 220,
          maxWidth: 320,
          boxShadow: `0 4px 12px rgba(0,0,0,0.45), 0 0 8px ${statusMeta.color}22`,
          cursor: 'pointer',
          pointerEvents: 'auto',
          backdropFilter: 'blur(6px)',
        }}
        onClick={() => setManagerOpen(true)}
        title="Click to manage customers (Ctrl+Shift+C)"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>👤</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#ffd54f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile?.name ?? 'No Customer'}
          </span>
          <span
            onClick={cycleStatus}
            title={`Status: ${statusMeta.label} (click to cycle)`}
            style={{
              fontSize: 9,
              padding: '1px 6px',
              background: `${statusMeta.color}22`,
              border: `1px solid ${statusMeta.color}66`,
              color: statusMeta.color,
              borderRadius: 3,
              fontFamily: 'Consolas, monospace',
              letterSpacing: 1,
              cursor: 'pointer',
            }}
          >
            {statusMeta.icon} {statusMeta.label.toUpperCase()}
          </span>
        </div>

        {profile?.siteAddress?.street && (
          <div style={{
            fontSize: 10,
            color: '#7fb8d0',
            fontFamily: 'Consolas, monospace',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            📍 {profile.siteAddress.street}, {profile.siteAddress.city}, {profile.siteAddress.state} {profile.siteAddress.zip}
          </div>
        )}

        {/* Phase summary dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          {PHASE_ORDER.map((phase) => {
            const s = schedule[phase];
            const statMeta = PHASE_STATUS_META[s.status];
            const meta = PHASE_META[phase];
            return (
              <div key={phase} title={`${meta.label}: ${statMeta.label}`}
                   style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: meta.color, fontFamily: 'Consolas, monospace' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: s.status === 'completed' || s.status === 'passed' ? meta.color : statMeta.color,
                  opacity: s.status === 'not_started' ? 0.35 : 1,
                }} />
                <span>{meta.shortLabel}</span>
              </div>
            );
          })}
          <div style={{ flex: 1 }} />
          <button
            onClick={(e) => { e.stopPropagation(); setSwitcherOpen((v) => !v); }}
            style={{
              fontSize: 10, padding: '1px 8px',
              background: 'rgba(30,45,60,0.8)',
              border: '1px solid rgba(120,180,220,0.3)',
              borderRadius: 3, color: '#7fb8d0',
              fontFamily: 'Consolas, monospace', cursor: 'pointer',
            }}
            title="Quick switch customer"
          >
            ▾
          </button>
        </div>
      </div>

      {/* Quick switcher popover */}
      {switcherOpen && (
        <div style={{
          position: 'fixed',
          bottom: 88,
          left: 12,
          zIndex: 43,
          background: 'rgba(6,12,20,0.97)',
          border: '1px solid rgba(255,213,79,0.4)',
          borderRadius: 8,
          padding: 6,
          minWidth: 220,
          maxHeight: 300,
          overflowY: 'auto',
          boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}
             onClick={(e) => e.stopPropagation()}
        >
          {Object.values(profiles).sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
            const sMeta = PROJECT_STATUS_META[(p.status ?? 'lead') as ProjectStatus];
            const isActive = p.id === activeId;
            return (
              <div
                key={p.id}
                onClick={() => { setActiveCustomer(p.id); setSwitcherOpen(false); }}
                style={{
                  padding: '5px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: isActive ? 'rgba(255,213,79,0.12)' : 'transparent',
                  color: isActive ? '#ffd54f' : '#e0ecf3',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ color: sMeta.color, fontSize: 10 }}>{sMeta.icon}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                {isActive && <span style={{ color: '#66bb6a', fontSize: 10 }}>◉</span>}
              </div>
            );
          })}
          <div style={{ borderTop: '1px solid rgba(120,180,220,0.2)', marginTop: 4, paddingTop: 4 }}>
            <div
              onClick={() => { setSwitcherOpen(false); setManagerOpen(true); }}
              style={{
                padding: '5px 8px',
                cursor: 'pointer',
                color: '#4dd0e1',
                fontSize: 10,
                letterSpacing: 1,
                fontFamily: 'Consolas, monospace',
              }}
            >
              ⚙ MANAGE ALL CUSTOMERS…
            </div>
          </div>
        </div>
      )}

      <CustomerManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </>
  );
}
