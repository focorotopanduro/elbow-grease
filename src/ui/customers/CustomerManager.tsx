/**
 * CustomerManager — full-screen modal for managing customer records.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Header: title + search + new + close                    │
 *   ├─────────────────┬────────────────────────────────────────┤
 *   │  List           │  Detail                                │
 *   │  (filterable)   │  ├─ Identity (name, tag, type, status) │
 *   │  [◉ Active]     │  ├─ Contact (person, company, phone…)  │
 *   │  Lennar         │  ├─ Site address                       │
 *   │  BigTen Homes   │  ├─ Schedule (UG/RI/TR)                │
 *   │  123 Oak St     │  ├─ Crew + notes                       │
 *   │                 │  └─ [Set Active] [Duplicate] [Delete]  │
 *   └─────────────────┴────────────────────────────────────────┘
 *
 * Opened by Ctrl+Shift+C or by clicking the CustomerBadge.
 */

import { useEffect, useMemo, useState } from 'react';
import { useCustomerStore, type CustomerProfile } from '@store/customerStore';
import {
  PROJECT_TYPE_META, PROJECT_STATUS_META,
  type ProjectType, type ProjectStatus,
} from '@core/customers/CustomerTypes';
import { CustomerPhaseSchedule } from './CustomerPhaseSchedule';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CustomerManager({ open, onClose }: Props) {
  const profiles = useCustomerStore((s) => s.profiles);
  const activeId = useCustomerStore((s) => s.activeCustomerId);
  const createProfile = useCustomerStore((s) => s.createProfile);
  const duplicateProfile = useCustomerStore((s) => s.duplicateProfile);
  const deleteProfile = useCustomerStore((s) => s.deleteProfile);
  const setActiveCustomer = useCustomerStore((s) => s.setActiveCustomer);
  const updateProfile = useCustomerStore((s) => s.updateProfile);
  const searchProfiles = useCustomerStore((s) => s.searchProfiles);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(activeId);

  const filtered = useMemo(() => {
    const list = searchProfiles(query);
    // Stable sort: active first, then status active > on_hold > lead > quoted > completed > archived > lost, then name
    const statusOrder: ProjectStatus[] = ['active', 'on_hold', 'lead', 'quoted', 'completed', 'archived', 'lost'];
    return [...list].sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      const sa = (a.status ?? 'lead') as ProjectStatus;
      const sb = (b.status ?? 'lead') as ProjectStatus;
      const d = statusOrder.indexOf(sa) - statusOrder.indexOf(sb);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
  }, [profiles, query, searchProfiles, activeId]);

  // Keep selection valid
  useEffect(() => {
    if (selectedId && !profiles[selectedId]) setSelectedId(null);
    if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
  }, [profiles, filtered, selectedId]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === 'Escape') onClose();
      if (e.key.toLowerCase() === 'n' && e.ctrlKey) {
        e.preventDefault();
        const id = createProfile('New Customer');
        setSelectedId(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, createProfile]);

  if (!open) return null;

  const selected = selectedId ? profiles[selectedId] ?? null : null;

  return (
    <div style={modalStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ flex: 1 }}>
          <div style={titleStyle}>👥 CUSTOMER MANAGER</div>
          <div style={subtitleStyle}>
            {Object.keys(profiles).length} profile{Object.keys(profiles).length === 1 ? '' : 's'} · Ctrl+N = new · Esc = close
          </div>
        </div>
        <input
          type="search"
          placeholder="Search name, address, tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={searchInputStyle}
        />
        <button
          onClick={() => {
            const id = createProfile('New Customer');
            setSelectedId(id);
          }}
          style={primaryBtn}
          title="Create new customer (Ctrl+N)"
        >
          ＋ New
        </button>
        <button onClick={onClose} style={cancelBtn}>✕ Close</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* List */}
        <div style={{
          width: 280,
          borderRight: '1px solid rgba(255,213,79,0.18)',
          background: 'rgba(6,12,20,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#7fb8d0', fontSize: 11 }}>
                No customers match your search.
              </div>
            )}
            {filtered.map((p) => (
              <CustomerListRow
                key={p.id}
                profile={p}
                selected={p.id === selectedId}
                active={p.id === activeId}
                onClick={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        </div>

        {/* Detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 12px 0' }}>
          {selected ? (
            <CustomerDetail
              profile={selected}
              active={selected.id === activeId}
              setActive={() => setActiveCustomer(selected.id)}
              onUpdate={(patch) => updateProfile(selected.id, patch)}
              onDuplicate={() => {
                const newId = duplicateProfile(selected.id);
                if (newId) setSelectedId(newId);
              }}
              onDelete={() => {
                if (selected.id === 'default') return;
                if (confirm(`Delete "${selected.name}"? This cannot be undone.`)) {
                  deleteProfile(selected.id);
                  setSelectedId(null);
                }
              }}
            />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#7fb8d0' }}>
              Select a customer on the left, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── List row ───────────────────────────────────────────────────

function CustomerListRow({ profile, selected, active, onClick }: {
  profile: CustomerProfile; selected: boolean; active: boolean; onClick: () => void;
}) {
  const statusMeta = PROJECT_STATUS_META[(profile.status ?? 'lead') as ProjectStatus];
  const typeMeta = profile.projectType ? PROJECT_TYPE_META[profile.projectType] : null;
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid rgba(120,180,220,0.08)',
        borderLeft: `3px solid ${selected ? '#ffd54f' : active ? '#66bb6a' : 'transparent'}`,
        background: selected ? 'rgba(255,213,79,0.1)' : active ? 'rgba(102,187,106,0.06)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 100ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {active && <span title="Active customer" style={{ color: '#66bb6a', fontSize: 11 }}>◉</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: selected ? '#ffd54f' : '#e0ecf3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.name}
        </span>
        <span title={statusMeta.label} style={{ fontSize: 11, color: statusMeta.color }}>
          {statusMeta.icon}
        </span>
      </div>
      {profile.contact?.personName && (
        <div style={{ fontSize: 10, color: '#b8cbd7', marginTop: 2 }}>
          {profile.contact.personName}{profile.contact.companyName ? ` · ${profile.contact.companyName}` : ''}
        </div>
      )}
      {profile.siteAddress?.street && (
        <div style={{ fontSize: 10, color: '#7fb8d0', fontFamily: 'Consolas, monospace', marginTop: 2 }}>
          {profile.siteAddress.street}, {profile.siteAddress.city}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {typeMeta && (
          <span style={pillStyle(typeMeta.color)}>
            {typeMeta.icon} {typeMeta.label.split(' — ').pop()}
          </span>
        )}
        {profile.estimateAmount ? (
          <span style={pillStyle('#26c6da')}>${profile.estimateAmount.toLocaleString()}</span>
        ) : null}
      </div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────

function CustomerDetail({ profile, active, setActive, onUpdate, onDuplicate, onDelete }: {
  profile: CustomerProfile;
  active: boolean;
  setActive: () => void;
  onUpdate: (patch: Partial<CustomerProfile>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ padding: '14px 20px' }}>
      {/* Identity section */}
      <SectionHdr>Identity</SectionHdr>
      <Row label="Name">
        <input
          value={profile.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={textInput}
        />
      </Row>
      <Row label="Project type">
        <select
          value={profile.projectType ?? ''}
          onChange={(e) => onUpdate({ projectType: (e.target.value || undefined) as ProjectType | undefined })}
          style={selectInput}
        >
          <option value="">—</option>
          {Object.entries(PROJECT_TYPE_META).map(([id, meta]) => (
            <option key={id} value={id}>{meta.icon} {meta.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Status">
        <select
          value={profile.status ?? 'lead'}
          onChange={(e) => onUpdate({ status: e.target.value as ProjectStatus })}
          style={selectInput}
        >
          {Object.entries(PROJECT_STATUS_META).map(([id, meta]) => (
            <option key={id} value={id}>{meta.icon} {meta.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Estimate $">
        <input
          type="number"
          value={profile.estimateAmount ?? ''}
          onChange={(e) => onUpdate({ estimateAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
          style={textInput}
          placeholder="—"
        />
      </Row>
      <Row label="Tags">
        <input
          value={(profile.tags ?? []).join(', ')}
          onChange={(e) => onUpdate({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder="repeat-client, gc:bobsbuild"
          style={textInput}
        />
      </Row>

      {/* Contact section */}
      <SectionHdr>Contact</SectionHdr>
      <Row label="Person">
        <input
          value={profile.contact?.personName ?? ''}
          onChange={(e) => onUpdate({ contact: { ...(profile.contact ?? { personName: '' }), personName: e.target.value } })}
          style={textInput}
        />
      </Row>
      <Row label="Company">
        <input
          value={profile.contact?.companyName ?? ''}
          onChange={(e) => onUpdate({ contact: { ...(profile.contact ?? { personName: '' }), companyName: e.target.value } })}
          style={textInput}
        />
      </Row>
      <Row label="Phone">
        <input
          type="tel"
          value={profile.contact?.phone ?? ''}
          onChange={(e) => onUpdate({ contact: { ...(profile.contact ?? { personName: '' }), phone: e.target.value } })}
          style={textInput}
        />
      </Row>
      <Row label="Email">
        <input
          type="email"
          value={profile.contact?.email ?? ''}
          onChange={(e) => onUpdate({ contact: { ...(profile.contact ?? { personName: '' }), email: e.target.value } })}
          style={textInput}
        />
      </Row>

      {/* Site Address */}
      <SectionHdr>Site Address</SectionHdr>
      <Row label="Street">
        <input
          value={profile.siteAddress?.street ?? ''}
          onChange={(e) => onUpdate({ siteAddress: { ...(profile.siteAddress ?? { street: '', city: '', state: '', zip: '' }), street: e.target.value } })}
          style={textInput}
        />
      </Row>
      <Row label="City / State / ZIP">
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={profile.siteAddress?.city ?? ''}
            onChange={(e) => onUpdate({ siteAddress: { ...(profile.siteAddress ?? { street: '', city: '', state: '', zip: '' }), city: e.target.value } })}
            placeholder="City"
            style={{ ...textInput, flex: 2 }}
          />
          <input
            value={profile.siteAddress?.state ?? ''}
            onChange={(e) => onUpdate({ siteAddress: { ...(profile.siteAddress ?? { street: '', city: '', state: '', zip: '' }), state: e.target.value } })}
            placeholder="ST"
            maxLength={2}
            style={{ ...textInput, flex: '0 0 42px' }}
          />
          <input
            value={profile.siteAddress?.zip ?? ''}
            onChange={(e) => onUpdate({ siteAddress: { ...(profile.siteAddress ?? { street: '', city: '', state: '', zip: '' }), zip: e.target.value } })}
            placeholder="ZIP"
            style={{ ...textInput, flex: '0 0 78px' }}
          />
        </div>
      </Row>
      <Row label="County">
        <input
          value={profile.siteAddress?.county ?? ''}
          onChange={(e) => onUpdate({ siteAddress: { ...(profile.siteAddress ?? { street: '', city: '', state: '', zip: '' }), county: e.target.value } })}
          placeholder="for permit jurisdiction"
          style={textInput}
        />
      </Row>

      {/* Schedule */}
      <SectionHdr>Phase Schedule</SectionHdr>
      <Row label="Start / Target">
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="date"
            value={profile.startDate ?? ''}
            onChange={(e) => onUpdate({ startDate: e.target.value || undefined })}
            style={{ ...textInput, flex: 1 }}
          />
          <input
            type="date"
            value={profile.targetCompleteDate ?? ''}
            onChange={(e) => onUpdate({ targetCompleteDate: e.target.value || undefined })}
            style={{ ...textInput, flex: 1 }}
          />
        </div>
      </Row>
      <div style={{ marginTop: 8 }}>
        <CustomerPhaseSchedule customerId={profile.id} />
      </div>

      {/* Crew + notes */}
      <SectionHdr>Crew &amp; Notes</SectionHdr>
      <Row label="Crew lead">
        <input
          value={profile.crewLead ?? ''}
          onChange={(e) => onUpdate({ crewLead: e.target.value })}
          style={textInput}
        />
      </Row>
      <Row label="Notes">
        <textarea
          value={profile.notes ?? ''}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          rows={3}
          style={{ ...textInput, resize: 'vertical', fontFamily: '"Segoe UI", system-ui, sans-serif' }}
        />
      </Row>

      {/* Action footer */}
      <div style={{
        marginTop: 16,
        paddingTop: 10,
        borderTop: '1px solid rgba(120,180,220,0.2)',
        display: 'flex',
        gap: 8,
      }}>
        <button onClick={setActive} disabled={active} style={active ? activeBtnDone : activeBtn}>
          {active ? '◉ Active' : '○ Set Active'}
        </button>
        <button onClick={onDuplicate} style={secondaryBtn}>⎘ Duplicate</button>
        <div style={{ flex: 1 }} />
        <button onClick={onDelete} style={deleteBtn} disabled={profile.id === 'default'}>
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ── Small atoms ────────────────────────────────────────────────

function SectionHdr({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: '#ffd54f',
      padding: '12px 0 6px',
      borderBottom: '1px solid rgba(255,213,79,0.2)',
      marginBottom: 6,
      fontFamily: 'Consolas, monospace',
    }}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <label style={{ fontSize: 11, color: '#b8cbd7' }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 105,
  background: 'rgba(4,8,14,0.92)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  color: '#e0ecf3',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '1px solid rgba(255,213,79,0.3)',
  background: 'linear-gradient(90deg, rgba(255,213,79,0.15) 0%, rgba(102,187,106,0.08) 100%)',
};

const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#ffd54f', letterSpacing: 1 };
const subtitleStyle: React.CSSProperties = { fontSize: 10, color: '#7fb8d0', fontFamily: 'Consolas, monospace' };

const searchInputStyle: React.CSSProperties = {
  flex: '0 0 260px',
  padding: '6px 10px',
  background: 'rgba(8,14,22,0.85)',
  border: '1px solid rgba(120,180,220,0.3)',
  color: '#e0ecf3',
  borderRadius: 4,
  fontSize: 11,
  outline: 'none',
};

const textInput: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  background: 'rgba(8,14,22,0.85)',
  border: '1px solid rgba(120,180,220,0.25)',
  color: '#e0ecf3',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'Consolas, monospace',
  boxSizing: 'border-box',
  outline: 'none',
};

const selectInput: React.CSSProperties = { ...textInput, padding: '4px 6px' };

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  background: 'linear-gradient(135deg, #66bb6a, #43a047)',
  border: '1px solid #81c784',
  borderRadius: 4,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  boxShadow: '0 0 8px rgba(102,187,106,0.4)',
};

const cancelBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  background: 'transparent',
  border: '1px solid rgba(255,100,100,0.4)',
  borderRadius: 4,
  color: '#ff8080',
  cursor: 'pointer',
  fontWeight: 600,
};

const activeBtn: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 11,
  background: 'linear-gradient(135deg, #26c6da, #00acc1)',
  border: '1px solid #4dd0e1',
  borderRadius: 4,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const activeBtnDone: React.CSSProperties = {
  ...activeBtn,
  background: 'rgba(102,187,106,0.2)',
  border: '1px solid #81c784',
  color: '#66bb6a',
  cursor: 'default',
};

const secondaryBtn: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 11,
  background: 'rgba(30,45,60,0.8)',
  border: '1px solid rgba(120,180,220,0.3)',
  borderRadius: 4,
  color: '#7fb8d0',
  cursor: 'pointer',
  fontWeight: 500,
};

const deleteBtn: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 11,
  background: 'rgba(239,83,80,0.12)',
  border: '1px solid rgba(239,83,80,0.5)',
  borderRadius: 4,
  color: '#ef5350',
  cursor: 'pointer',
  fontWeight: 500,
};

function pillStyle(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    padding: '1px 6px',
    background: `${color}22`,
    border: `1px solid ${color}55`,
    color,
    borderRadius: 3,
    fontFamily: 'Consolas, monospace',
  };
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}
