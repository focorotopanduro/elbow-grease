/**
 * ALG-007 — `edge_support_required` tests.
 *
 * Covers spec §6 ALG-007 edge-case rows + the new
 * `EdgeSupportRequirement` discriminated decision-path return.
 */

import { describe, it, expect } from 'vitest';
import { edge_support_required } from '../algorithms/edgeSupport';
import { select_apa_panel } from '../algorithms/panels';
import type { PanelSpec } from '../types';

describe('ALG-007 edge_support_required — panels via ALG-003 (spacing fits)', () => {
  // Row 1 — 15/32 panel @ 24" rafter spacing (APA 32/16 max_wo = 28)
  it('15/32 APA 32/16 panel @ 24" rafters, asphalt → method=null (24 ≤ 28)', () => {
    const panel = select_apa_panel(24, 30, 'asphalt_shingle', true);
    // Verify the selected panel carries max_wo after the ALG-003 update
    expect(panel.max_span_without_edge_support_in).toBeDefined();
    const req = edge_support_required(panel, 24, 'asphalt_shingle');
    expect(req.method).toBeNull();
    expect(req.clips_per_span).toBe(0);
    expect(req.reason).toBe('within_max_wo_edge');
  });
});

describe('ALG-007 edge_support_required — spacing exceeds max_wo (hand-built)', () => {
  // Hand-built to bypass ALG-003's rounding that would otherwise
  // select a thicker panel at tabulated spacing bins. The test
  // pins the clip-firing behaviour for the PanelSpec → spacing
  // pair directly.
  const panel_32_16: PanelSpec = {
    material: 'plywood',
    thickness_in: 15 / 32,
    span_rating: '32/16',
    grade: 'C-D Ext Glue',
    max_span_without_edge_support_in: 28,
  };

  it('32/16 panel (max_wo=28) @ 30" rafters, asphalt → panel_edge_clips × 1', () => {
    const req = edge_support_required(panel_32_16, 30, 'asphalt_shingle');
    expect(req.method).toBe('panel_edge_clips');
    expect(req.clips_per_span).toBe(1);
    expect(req.reason).toBe('spacing_exceeds_wo_edge');
  });

  // Row 3 (ALG-007 spec) — 23/32 (48/24) panel, BUILT_UP @ 48" → clips × 2.
  // Can't go through select_apa_panel here because ALG-003's §2D
  // guard rejects BUILT_UP + >24" spacing. The clip-doubling rule
  // exists in the abstract (§2D Table 22 footnote a) — it fires
  // whenever ALG-007 is called with BUILT_UP @ ≥48", regardless
  // of how the panel was chosen.
  const panel_48_24: PanelSpec = {
    material: 'plywood',
    thickness_in: 23 / 32,
    span_rating: '48/24',
    grade: 'C-D Ext Glue',
    max_span_without_edge_support_in: 36,
  };

  it('48/24 panel (max_wo=36) @ 48" BUILT_UP → panel_edge_clips × 2 (Tbl 22 ftn a)', () => {
    const req = edge_support_required(panel_48_24, 48, 'built_up');
    expect(req.method).toBe('panel_edge_clips');
    expect(req.clips_per_span).toBe(2);
    expect(req.reason).toBe('built_up_48in_double_clips');
  });
});

describe('ALG-007 — T&G short-circuit', () => {
  it('panel with has_tongue_and_groove_edges=true → method=tongue_and_groove × 0', () => {
    const tg_panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 23 / 32,
      span_rating: '48/24',
      grade: 'C-D Ext T&G',
      max_span_without_edge_support_in: 36,
      has_tongue_and_groove_edges: true,
    };
    // Even at 48" spacing where clips would normally fire,
    // T&G panel short-circuits.
    const req = edge_support_required(tg_panel, 48, 'built_up');
    expect(req.method).toBe('tongue_and_groove');
    expect(req.clips_per_span).toBe(0);
    expect(req.reason).toBe('panel_tongue_and_groove');
  });

  it('board_profile_in_use=tongue_and_groove → also short-circuits to T&G', () => {
    const plain_panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 15 / 32,
      span_rating: '32/16',
      grade: 'C-D Ext Glue',
      max_span_without_edge_support_in: 28,
    };
    // T&G boards beneath the panel carry the edge support — even
    // with a non-T&G panel and excess spacing.
    const req = edge_support_required(plain_panel, 32, 'asphalt_shingle', 'tongue_and_groove');
    expect(req.method).toBe('tongue_and_groove');
    expect(req.clips_per_span).toBe(0);
  });
});

describe('ALG-007 — conservative fallback for unknown max_wo', () => {
  // Spec edge row 5
  it('panel without max_span_without_edge_support_in → require clips (conservative)', () => {
    const custom_panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 0.5,
      span_rating: '32/16',
      grade: 'custom',
      // No max_span_without_edge_support_in field
    };
    const req = edge_support_required(custom_panel, 24, 'asphalt_shingle');
    expect(req.method).toBe('panel_edge_clips');
    expect(req.clips_per_span).toBe(1);
    expect(req.reason).toBe('spacing_exceeds_wo_edge');
  });
});

describe('ALG-007 — BUILT_UP doubled-clip rule', () => {
  it('BUILT_UP @ exactly 48" → 2 clips (rule fires AT 48 inclusive)', () => {
    const panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 23 / 32,
      span_rating: '48/24',
      grade: 'C-D',
      max_span_without_edge_support_in: 36,
    };
    const req = edge_support_required(panel, 48, 'built_up');
    expect(req.clips_per_span).toBe(2);
  });

  it('BUILT_UP @ 47" → 1 clip (below 48 threshold)', () => {
    const panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 23 / 32,
      span_rating: '48/24',
      grade: 'C-D',
      max_span_without_edge_support_in: 36,
    };
    const req = edge_support_required(panel, 47, 'built_up');
    expect(req.clips_per_span).toBe(1);
    expect(req.reason).toBe('spacing_exceeds_wo_edge');
  });

  it('Asphalt @ 48" → 1 clip (doubling is BUILT_UP-specific)', () => {
    const panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 23 / 32,
      span_rating: '48/24',
      grade: 'C-D',
      max_span_without_edge_support_in: 36,
    };
    const req = edge_support_required(panel, 48, 'asphalt_shingle');
    expect(req.clips_per_span).toBe(1);
  });

  it('BUILT_UP @ 60" → still 2 clips (rule is ≥48, not exact 48)', () => {
    const panel: PanelSpec = {
      material: 'plywood',
      thickness_in: 7 / 8,
      span_rating: '60/32',
      grade: 'C-D',
      max_span_without_edge_support_in: 48,
    };
    const req = edge_support_required(panel, 60, 'built_up');
    expect(req.clips_per_span).toBe(2);
  });
});
