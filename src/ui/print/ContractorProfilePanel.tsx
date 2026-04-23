/**
 * ContractorProfilePanel — editor for the contractor's identity info
 * that appears in proposal title blocks.
 *
 * Triggered by Ctrl+Shift+I ("Identity"). Modal, focus-trapped.
 * Every edit persists to localStorage via contractorProfileStore.
 *
 * The logo is uploaded as a FileReader-produced data URL so no file
 * path needs to be re-resolved at print time — just embedded in the
 * store. Keeps the printing path self-contained.
 */

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import {
  useContractorProfileStore,
  PLACEHOLDER_COMPANY,
  DEFAULT_CONTRACTOR_PROFILE,
} from '@store/contractorProfileStore';

export function ContractorProfilePanel() {
  const profile = useContractorProfileStore((s) => s.profile);
  const update = useContractorProfileStore((s) => s.update);
  const setProfile = useContractorProfileStore((s) => s.setProfile);

  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      alert('Logo file is larger than 512KB — please use a smaller image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') update({ logoDataUrl: result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contractor-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="contractor-title" style={styles.title}>Contractor Profile</span>
          <button
            type="button"
            aria-label="Close contractor profile"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.hint}>
            This info appears in the title block of every PDF proposal.
            Fill it in once; it persists across sessions.
          </div>

          <Field label="Company name" required>
            <input
              type="text"
              value={profile.companyName === PLACEHOLDER_COMPANY ? '' : profile.companyName}
              placeholder="Beit Building Contractors LLC"
              onChange={(e) => update({ companyName: e.target.value || PLACEHOLDER_COMPANY })}
              style={styles.input}
            />
          </Field>

          <Field label="Contact name">
            <input
              type="text"
              value={profile.contactName}
              placeholder="Estimator / Owner name"
              onChange={(e) => update({ contactName: e.target.value })}
              style={styles.input}
            />
          </Field>

          <div style={styles.twoCol}>
            <Field label="License #">
              <input
                type="text"
                value={profile.licenseNumber}
                placeholder="CFC1428384"
                onChange={(e) => update({ licenseNumber: e.target.value })}
                style={styles.input}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={profile.phone}
                placeholder="(407) 555-0100"
                onChange={(e) => update({ phone: e.target.value })}
                style={styles.input}
              />
            </Field>
          </div>

          <Field label="Email">
            <input
              type="email"
              value={profile.email}
              placeholder="estimates@company.com"
              onChange={(e) => update({ email: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Address">
            <input
              type="text"
              value={profile.addressLine1}
              placeholder="123 Main St, Suite 200"
              onChange={(e) => update({ addressLine1: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Address line 2 (optional)">
            <input
              type="text"
              value={profile.addressLine2 ?? ''}
              onChange={(e) => update({ addressLine2: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="City, State ZIP">
            <input
              type="text"
              value={profile.cityStateZip}
              placeholder="Orlando, FL 32801"
              onChange={(e) => update({ cityStateZip: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Logo (optional)" hint="PNG/JPG, max 512KB. Embedded as a data URL.">
            <div style={styles.logoRow}>
              {profile.logoDataUrl && (
                <img src={profile.logoDataUrl} alt="Logo preview" style={styles.logoPreview} />
              )}
              <div style={styles.logoActions}>
                <button
                  type="button"
                  style={styles.smallBtn}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {profile.logoDataUrl ? 'Replace logo' : 'Upload logo'}
                </button>
                {profile.logoDataUrl && (
                  <button
                    type="button"
                    style={styles.smallBtn}
                    onClick={() => update({ logoDataUrl: undefined })}
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleLogoUpload}
                />
              </div>
            </div>
          </Field>

          <Field label="Proposal terms" hint="Standard terms printed on every proposal footer.">
            <textarea
              value={profile.proposalTerms ?? ''}
              onChange={(e) => update({ proposalTerms: e.target.value })}
              rows={5}
              style={styles.textarea}
            />
          </Field>
        </div>

        <footer style={styles.footer}>
          <button
            type="button"
            style={styles.resetBtn}
            onClick={() => {
              if (confirm('Reset all contractor fields to empty placeholder? Your logo and terms will be lost.')) {
                setProfile({ ...DEFAULT_CONTRACTOR_PROFILE });
              }
            }}
          >
            Clear profile
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.doneBtn} onClick={() => setOpen(false)}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>
        {label}
        {required && <span style={styles.requiredMark}> *</span>}
        {hint && <span style={styles.fieldHint}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(600px, 92vw)',
    maxHeight: '88vh',
    background: 'rgba(10, 14, 22, 0.98)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 229, 255, 0.06)',
    color: '#e0e6ef',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#00e5ff', letterSpacing: 1, flex: 1 },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  hint: {
    fontSize: 11, color: '#7a8592',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 12, fontWeight: 600, color: '#cfd8e3',
  },
  requiredMark: { color: '#ff6f6f', marginLeft: 2 },
  fieldHint: { fontSize: 10, color: '#7a8592', fontWeight: 400, marginLeft: 8 },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  input: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '6px 8px', outline: 'none',
  },
  textarea: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 11, lineHeight: 1.4,
    padding: 8, resize: 'vertical',
  },
  logoRow: { display: 'flex', gap: 12, alignItems: 'center' },
  logoPreview: {
    maxWidth: 80, maxHeight: 80, objectFit: 'contain',
    background: '#fff', borderRadius: 4, padding: 4,
    border: '1px solid #2a3a54',
  },
  logoActions: { display: 'flex', gap: 6 },
  smallBtn: {
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 4,
    color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11,
    cursor: 'pointer',
  },
  footer: {
    display: 'flex', gap: 8,
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#7a8592',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  doneBtn: {
    padding: '6px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
};
