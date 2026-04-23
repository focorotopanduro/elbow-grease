/**
 * PricingProfilePanel — editor for the active pricing profile.
 *
 * Modal triggered by Ctrl+Shift+B ("Bid"). Lets the user set their
 * real labor rate, overhead, margin, sales tax, and per-component
 * tax flags. Changes are live — every keystroke persists to
 * localStorage via pricingStore.update().
 *
 * A live bid-preview strip at the bottom shows what a hypothetical
 * $1000 material + 10-hour scene would bid at with the current
 * profile — gives immediate feedback for "did my rate change
 * break anything."
 *
 * A11y: focus-trapped dialog, Escape closes, close button labeled,
 * number inputs with proper min/max.
 */

import { useEffect, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { usePricingStore } from '@store/pricingStore';
import { computeBid, FL_RESIDENTIAL_DEFAULT, type BidResult } from '../../engine/export/computeBid';

// A tiny synthetic BOM stand-in for the live preview. Represents
// "$1000 in materials and 10 hours of labor" — small enough to
// hand-verify, large enough to make percentage changes visible.
const PREVIEW_BOM = {
  items: [],
  subtotals: { pipe: 0, fitting: 0, fixture: 0, support: 0, misc: 0 },
  grandTotal: 1000,
  grandLaborHours: 10,
  cutList: {} as never,
  generatedAt: '',
};

// ── Component ─────────────────────────────────────────────────

export function PricingProfilePanel() {
  const profile = usePricingStore((s) => s.profile);
  const update = usePricingStore((s) => s.update);
  const resetToDefault = usePricingStore((s) => s.resetToDefault);

  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  // Ctrl+Shift+B toggles, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
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

  // Live-computed preview bid.
  let preview: BidResult | null = null;
  try { preview = computeBid(PREVIEW_BOM, profile); } catch { /* unreachable */ }

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="pricing-title" style={styles.title}>Pricing Profile</span>
          <button
            type="button"
            aria-label="Close pricing profile"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div style={styles.body}>
          <Field label="Profile name">
            <input
              type="text"
              value={profile.name}
              onChange={(e) => update({ name: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Field label="Labor rate" hint="Your burdened $/hr (payroll + WC + benefits, not take-home).">
            <CurrencyInput
              value={profile.laborRateUsdPerHr}
              min={0}
              step={1}
              onChange={(v) => update({ laborRateUsdPerHr: v })}
              suffix="/hr"
            />
          </Field>

          <Field label="Overhead markup" hint="Applied to both material and labor before tax.">
            <PercentInput
              value={profile.overheadMarkupPercent}
              onChange={(v) => update({ overheadMarkupPercent: v })}
            />
          </Field>

          <Field label="Profit margin" hint="Applied to the pre-margin total (after overhead + tax).">
            <PercentInput
              value={profile.profitMarginPercent}
              onChange={(v) => update({ profitMarginPercent: v })}
            />
          </Field>

          <Field label="Sales tax rate" hint="FL 6% + county surtax (Orange = 0.5%, so 6.5%).">
            <PercentInput
              value={profile.salesTaxPercent}
              onChange={(v) => update({ salesTaxPercent: v })}
            />
          </Field>

          <div style={styles.checkboxRow}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={profile.taxOnMaterial}
                onChange={(e) => update({ taxOnMaterial: e.target.checked })}
              />
              <span>Apply tax to material</span>
            </label>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={profile.taxOnLabor}
                onChange={(e) => update({ taxOnLabor: e.target.checked })}
              />
              <span>Apply tax to labor</span>
            </label>
          </div>

          <Field label="Notes" hint="Caveats about this profile (jurisdiction, effective date, etc.).">
            <textarea
              value={profile.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
              rows={3}
              style={styles.textarea}
            />
          </Field>

          {/* Live preview */}
          {preview && <PreviewStrip bid={preview} />}
        </div>

        <footer style={styles.footer}>
          <button
            type="button"
            style={styles.resetBtn}
            onClick={() => {
              if (confirm(`Reset to ${FL_RESIDENTIAL_DEFAULT.name}? Your current edits will be lost.`)) {
                resetToDefault();
              }
            }}
          >
            Reset to FL default
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
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>
        {label}
        {hint && <span style={styles.fieldHint}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function CurrencyInput({
  value, onChange, min, step, suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div style={styles.inputRow}>
      <span style={styles.prefix}>$</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={styles.input}
      />
      {suffix && <span style={styles.suffix}>{suffix}</span>}
    </div>
  );
}

function PercentInput({
  value, onChange,
}: {
  value: number; // decimal (0.15 = 15%)
  onChange: (v: number) => void;
}) {
  // Display as percent; store as decimal. 0.15 ↔ 15.00
  const displayed = (value * 100).toFixed(2);
  return (
    <div style={styles.inputRow}>
      <input
        type="number"
        value={displayed}
        min={0}
        max={100}
        step={0.25}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n / 100);
        }}
        style={styles.input}
      />
      <span style={styles.suffix}>%</span>
    </div>
  );
}

function PreviewStrip({ bid }: { bid: BidResult }) {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div style={styles.preview}>
      <div style={styles.previewTitle}>Sample bid — $1000 material + 10 labor-hours</div>
      <div style={styles.previewRow}>
        <span style={styles.previewLabel}>Raw:</span>
        <span>{usd(bid.rawMaterialCost)} mat + {bid.rawLaborHours}h × {usd(bid.profileSnapshot.laborRateUsdPerHr)} = {usd(bid.rawMaterialCost + bid.rawLaborCost)}</span>
      </div>
      <div style={styles.previewRow}>
        <span style={styles.previewLabel}>Overhead:</span>
        <span>+{usd(bid.overheadAmount)}</span>
      </div>
      <div style={styles.previewRow}>
        <span style={styles.previewLabel}>Tax:</span>
        <span>+{usd(bid.taxAmount)} on {usd(bid.taxableBase)}</span>
      </div>
      <div style={styles.previewRow}>
        <span style={styles.previewLabel}>Margin:</span>
        <span>+{usd(bid.marginAmount)}</span>
      </div>
      <div style={{ ...styles.previewRow, ...styles.previewTotal }}>
        <span style={styles.previewLabel}>BID TOTAL:</span>
        <span>{usd(bid.grandTotal)}</span>
      </div>
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
    width: 'min(560px, 92vw)',
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
  title: {
    fontSize: 16, fontWeight: 700, color: '#00e5ff',
    letterSpacing: 1, flex: 1,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 12, fontWeight: 600, color: '#cfd8e3',
  },
  fieldHint: {
    fontSize: 10, color: '#7a8592', fontWeight: 400, marginLeft: 8,
  },
  inputRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    padding: '4px 8px',
  },
  prefix: { color: '#7a8592', fontSize: 12 },
  suffix: { color: '#7a8592', fontSize: 12 },
  input: {
    flex: 1, background: 'transparent', border: 'none',
    color: '#e0e6ef', fontFamily: 'Consolas, monospace',
    fontSize: 13, outline: 'none',
  },
  textarea: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 12, padding: 6, resize: 'vertical',
  },
  checkboxRow: {
    display: 'flex', gap: 18,
    padding: '6px 0',
  },
  checkboxLabel: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 12, color: '#cfd8e3', cursor: 'pointer',
  },
  preview: {
    marginTop: 8,
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.2)',
    borderRadius: 4,
    padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  previewTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#00e5ff',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  previewRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, color: '#aebbc9',
    fontVariantNumeric: 'tabular-nums',
  },
  previewLabel: { color: '#7a8592' },
  previewTotal: {
    color: '#e0e6ef',
    fontWeight: 700, fontSize: 13,
    marginTop: 4, paddingTop: 6,
    borderTop: '1px solid rgba(0, 229, 255, 0.2)',
  },
  footer: {
    display: 'flex', gap: 8,
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 4,
    color: '#7a8592',
    fontFamily: 'inherit', fontSize: 11,
    cursor: 'pointer',
  },
  doneBtn: {
    padding: '6px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4,
    color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
};
