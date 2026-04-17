/**
 * FixtureDiagnostics — live rule checks on staged fixture params.
 *
 * Runs on every param change while the visual editor is open.
 * Emits warnings and errors visible in the editor's diagnostic panel:
 *
 *   - error   → fix required before apply (red, blocks)
 *   - warn    → advisory (amber, informational)
 *   - info    → informational tip (cyan)
 *
 * Rules mix plumbing code minimums (IPC) and best practices.
 */

import type { FixtureSubtype } from '../../engine/graph/GraphNode';

export type Severity = 'error' | 'warn' | 'info';

export interface Diagnostic {
  id: string;
  severity: Severity;
  message: string;
  hint?: string;
}

export function diagnoseFixture(
  subtype: FixtureSubtype,
  p: Record<string, unknown>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const num = (k: string, def = 0): number => {
    const v = p[k];
    return typeof v === 'number' ? v : Number(v) || def;
  };

  // Shared rules
  const drain = num('drainRoughIn');
  const cold  = num('coldRoughIn');
  const hot   = num('hotRoughIn');

  if (cold > 0 && hot > 0 && Math.abs(cold - hot) > 2) {
    out.push({
      id: 'supply_height_mismatch',
      severity: 'warn',
      message: `Cold (${cold}″) and hot (${hot}″) supply heights differ by ${Math.abs(cold - hot).toFixed(1)}″`,
      hint: 'Typical rough-in keeps cold and hot supplies at the same CL.',
    });
  }

  if (drain > cold && cold > 0) {
    out.push({
      id: 'drain_above_supply',
      severity: 'warn',
      message: 'Drain rough-in is higher than the cold supply',
      hint: 'Drain usually sits below supplies; verify elevations.',
    });
  }

  // Subtype-specific
  switch (subtype) {
    case 'water_closet': {
      const seat = num('seatHeight', 16.5);
      const ada = p.wallMounted || num('seatHeight') >= 17 && num('seatHeight') <= 19;
      if (seat < 14 || seat > 19.5) {
        out.push({ id: 'wc_seat_range', severity: 'warn', message: `Seat height ${seat}″ is unusual`, hint: '15″ = standard, 17-19″ = ADA "comfort height".' });
      }
      if (seat >= 17 && seat <= 19) {
        out.push({ id: 'wc_ada', severity: 'info', message: `Seat height ${seat}″ meets ADA comfort height`, hint: 'Label fixture as ADA in plans.' });
      }
      const rough = String(p.roughInDistance ?? '12');
      if (rough === '10') {
        out.push({ id: 'wc_10in_tight', severity: 'info', message: '10″ rough-in — confirm compact model availability' });
      }
      if (rough === '14') {
        out.push({ id: 'wc_14in_wide', severity: 'info', message: '14″ rough-in — confirm deep-carry model availability' });
      }
      if (ada) void 0;
      break;
    }
    case 'bathtub': {
      const L = num('length', 60);
      const W = num('width', 32);
      if (L < 48) {
        out.push({ id: 'tub_short', severity: 'warn', message: `Tub length ${L}″ is shorter than typical 54-60″` });
      }
      if (W < 28) {
        out.push({ id: 'tub_narrow', severity: 'error', message: `Tub width ${W}″ below minimum 28″`, hint: 'Increase width or check catalog.' });
      }
      if (L > 72 && p.tubStyle !== 'freestand') {
        out.push({ id: 'tub_long_alcove', severity: 'warn', message: `Tub length ${L}″ exceeds typical alcove framing`, hint: 'Consider tubStyle=freestand.' });
      }
      if (p.whirlpool === true) {
        const jets = num('jetCount', 0);
        if (jets < 4) {
          out.push({ id: 'tub_whirlpool_jets', severity: 'warn', message: `Whirlpool with only ${jets} jets`, hint: 'Most whirlpool tubs have 6+ jets.' });
        }
        out.push({ id: 'tub_gfci', severity: 'info', message: 'Whirlpool requires GFCI electrical circuit per NEC 680.71' });
      }
      if (!p.overflow) {
        out.push({ id: 'tub_no_overflow', severity: 'warn', message: 'No overflow drain', hint: 'Code requires overflow on most residential tubs.' });
      }
      break;
    }
    case 'kitchen_sink': {
      const bowls = num('bowlCount', 2);
      if (p.garbageDisposal && p.dishwasherConnected && !p.airGap) {
        out.push({ id: 'ks_air_gap', severity: 'error', message: 'Dishwasher drain through disposal requires air gap', hint: 'Enable Air Gap or disconnect DW tie-in.' });
      }
      if (bowls === 3) {
        out.push({ id: 'ks_3bowl_space', severity: 'info', message: 'Triple-bowl sinks typically need 42-48″ cabinet', hint: 'Verify cabinet run.' });
      }
      if (p.potFiller && cold === 0) {
        out.push({ id: 'ks_potfiller_cold', severity: 'error', message: 'Pot filler requires dedicated cold supply' });
      }
      break;
    }
    case 'shower': {
      const panSize = String(p.panSize ?? '36x36');
      const [w, d] = panSize.split('x').map((s) => parseInt(s, 10) || 0);
      if ((w ?? 0) < 32 || (d ?? 0) < 32) {
        out.push({ id: 'sh_min_32', severity: 'error', message: `Pan ${panSize} is below 32″ minimum dimension`, hint: 'IPC 417.4 requires ≥30×30 interior; most plans use 32-36".' });
      }
      if (p.drainType === 'linear' && p.valveType !== 'thermostatic' && p.rainHead) {
        out.push({ id: 'sh_linear_tb', severity: 'info', message: 'Luxury shower (rain + linear) typically pairs with thermostatic valve' });
      }
      if (p.steamUnit && !p.handheld) {
        out.push({ id: 'sh_steam_handheld', severity: 'info', message: 'Steam showers commonly include a handheld for rinse-down' });
      }
      break;
    }
    case 'dishwasher': {
      if (p.tieIn === 'disposal' && !p.airGap) {
        out.push({ id: 'dw_air_gap', severity: 'warn', message: 'Disposal tie-in without air gap — confirm local code allows high-loop only' });
      }
      break;
    }
    case 'urinal': {
      if (p.waterless && (hot > 0 || cold > 0)) {
        out.push({ id: 'ur_waterless_supply', severity: 'warn', message: 'Waterless urinal has supply rough-in defined', hint: 'Set cold/hot rough-in to 0.' });
      }
      break;
    }
    case 'hose_bibb': {
      if (!p.vacuumBreaker) {
        out.push({ id: 'hb_vb', severity: 'error', message: 'Hose bibb must have vacuum breaker (backflow prevention)', hint: 'Enable Vacuum Breaker.' });
      }
      if (!p.frostFree && cold < 12) {
        out.push({ id: 'hb_frost', severity: 'warn', message: 'Non-frost-free bibb in low position — risk of freezing', hint: 'Consider frost-free or install stop-and-waste.' });
      }
      break;
    }
  }

  return out;
}

export function highestSeverity(diags: Diagnostic[]): Severity | null {
  if (diags.some((d) => d.severity === 'error')) return 'error';
  if (diags.some((d) => d.severity === 'warn')) return 'warn';
  if (diags.some((d) => d.severity === 'info')) return 'info';
  return null;
}
