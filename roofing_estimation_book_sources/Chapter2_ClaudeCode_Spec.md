# Chapter 2 — Implementation Specification for Claude Code

> **Target agent:** Claude Code (Opus 4.7)
> **Target codebase:** existing Python + Flutter roofing estimator
> **Scope:** Chapter 2 — Roof Sheathing, Decking & Loading
> **Source of truth:** `Roofing_Estimating_Study_Packet.md` (Ch. 2 + Appendix A)
> **Priority:** enterprise-grade reliability, FL / HVHZ-aware
> **Spec version:** 1.0
> **Generated:** 2026-04-23

---

## 0. Operating Instructions for Claude Code

Before writing any code, read this entire document once. Then work through it top-to-bottom. The order matters — later sections depend on types and constants defined earlier.

**Ground rules:**

1. **Audit first, implement second.** Run the tasks in §1 (Discovery) before touching new code.
2. **Preserve existing public APIs** unless §12 (Migration) explicitly authorizes a breaking change.
3. **Tests first.** For every algorithm (ALG-XXX), write its tests before its implementation. Every test in §10 must pass before marking an algorithm complete.
4. **No magic numbers.** Every numeric threshold is a named constant in `src/rules/constants.py` (§4). If you need a new one, add it there and cite the source section.
5. **Cite the source.** Every rule carries a `# per Ch. 2 §2X` comment in code.
6. **Fail loudly.** Raise a typed exception (§5) rather than silently defaulting when the book specifies behavior.
7. **Warn, don't block** for non-safety concerns. Use structured `WarningFlag` objects (§3).
8. **Never hardcode rates or prices.** All $ values and labor rates come from a `RateSet` object (§9.2). The book's historical values are test fixtures, not defaults.
9. **Version every rule set.** Each `BidOutput` records which `rate_set_version` priced it.
10. **Deliverables:** §11 lists what must exist at the end of this work.

**When this document is ambiguous:** raise it in the migration report (§13) rather than guessing. The Florida overrides in §9.4 take precedence over the book for FL jobs.

---

## Table of Contents

1. [Discovery Phase (do this first)](#1-discovery-phase)
2. [Suggested Module Organization](#2-suggested-module-organization)
3. [Type Definitions](#3-type-definitions)
4. [Constants Module](#4-constants-module)
5. [Error Types](#5-error-types)
6. [Algorithm Specifications (ALG-001 to ALG-020)](#6-algorithm-specifications)
7. [Validation Gates](#7-validation-gates)
8. [Cost Engine Integration](#8-cost-engine-integration)
9. [RateSet & Configuration](#9-rateset--configuration)
10. [Edge Case Matrix](#10-edge-case-matrix)
11. [Definition of Done (Acceptance Criteria)](#11-definition-of-done)
12. [Migration Rules (existing code)](#12-migration-rules)
13. [Migration Report Format](#13-migration-report-format)

---

## 1. Discovery Phase

Before implementing, run these audits and record findings in the migration report (§13).

**D-1.** Locate all existing functions/classes that decide sheathing type, panel thickness, fastener spacing, dead/live loads, or sheathing cost. List them with file paths.

**D-2.** Identify any hardcoded numeric thresholds (e.g., `24`, `30`, `0.5`, `0.026`) in the sheathing/deck/load code path. Plan to replace with named constants from §4.

**D-3.** Identify the current input schema for a bid (the Flutter form → Python payload). Determine delta vs. the `JobInputs` type in §3.

**D-4.** Identify the current output/bid schema. Determine delta vs. `BidOutput` in §3.

**D-5.** Check whether the codebase already uses rate versioning. If not, plan for adding `RateSet` (§9).

**D-6.** List any tests that currently exist for sheathing logic. They may codify rules we need to preserve — or contradict the book.

**D-7.** Identify the existing error/exception hierarchy. New errors in §5 should extend it if possible.

---

## 2. Suggested Module Organization

Adapt to existing layout, but aim for this separation of concerns:

```
src/
├── rules/
│   ├── __init__.py
│   ├── constants.py                # §4 — all Ch. 2 numbers
│   ├── types.py                    # §3 — enums, dataclasses
│   ├── errors.py                   # §5 — exceptions
│   ├── sheathing/
│   │   ├── __init__.py
│   │   ├── decisions.py            # ALG-001
│   │   ├── panels.py               # ALG-002, ALG-003
│   │   ├── board.py                # ALG-004
│   │   ├── spaced.py               # ALG-005
│   │   ├── low_slope.py            # ALG-006
│   │   ├── edge_support.py         # ALG-007
│   │   ├── fasteners.py            # ALG-008, ALG-009
│   │   ├── expansion_gaps.py       # ALG-010
│   │   ├── solid_zones.py          # ALG-011
│   │   ├── loads.py                # ALG-012
│   │   ├── osb.py                  # ALG-013
│   │   └── staging.py              # ALG-014, ALG-015
│   ├── framing.py                  # ALG-016
│   └── ventilation.py              # ALG-017
├── estimating/
│   ├── material_cost.py            # ALG-018
│   ├── labor_cost.py               # ALG-019
│   └── cost_engine.py              # ALG-020
├── validation/
│   └── ch2_gates.py                # §7
└── tests/
    └── ch2/
        ├── conftest.py             # fixtures: make_job_inputs(), make_rate_set()
        ├── test_alg_001_decisions.py
        ├── test_alg_002_panel_select.py
        ├── ...
        └── test_edge_matrix.py     # §10 — the critical file
```

---

## 3. Type Definitions

Generate `src/rules/types.py` with exactly these types. Do not rename fields; the cost engine depends on these names.

```python
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Optional, Literal
from datetime import date

# =========================================================================
# ENUMS
# =========================================================================

class CoveringType(Enum):
    ASPHALT_SHINGLE        = auto()
    FIBERGLASS_SHINGLE     = auto()
    METAL_SHINGLE          = auto()
    MINERAL_SURFACED_ROLL  = auto()
    BUILT_UP               = auto()
    TILE_CLAY              = auto()
    TILE_CONCRETE          = auto()
    SLATE                  = auto()
    METAL_CORRUGATED       = auto()   # the single spaced-allowed metal
    METAL_SHEET            = auto()
    WOOD_SHINGLE           = auto()
    WOOD_SHAKE             = auto()


# Frozen sets for O(1) membership tests
SOLID_REQUIRED_COVERINGS = frozenset({
    CoveringType.ASPHALT_SHINGLE,
    CoveringType.FIBERGLASS_SHINGLE,
    CoveringType.METAL_SHINGLE,
    CoveringType.MINERAL_SURFACED_ROLL,
    CoveringType.BUILT_UP,
    CoveringType.TILE_CLAY,
    CoveringType.TILE_CONCRETE,
    CoveringType.SLATE,
    CoveringType.METAL_SHEET,
})

WOOD_COVERINGS = frozenset({
    CoveringType.WOOD_SHINGLE,
    CoveringType.WOOD_SHAKE,
})

BRITTLE_COVERINGS = frozenset({
    CoveringType.TILE_CLAY,
    CoveringType.TILE_CONCRETE,
    CoveringType.SLATE,
})


class SheathingType(Enum):
    SOLID                      = auto()
    SPACED_WITH_SOLID_ZONES    = auto()
    SPACED_OVER_SOLID_HYBRID   = auto()   # <4:12 wood shingle/shake build-up


class SheathingMaterial(Enum):
    BOARD        = auto()
    PLYWOOD      = auto()
    OSB          = auto()
    WAFERBOARD   = auto()
    ROOF_DECKING = auto()   # exposed-ceiling decking


class BoardEdgeProfile(Enum):
    SQUARE_EDGED     = auto()
    SHIPLAP          = auto()
    TONGUE_AND_GROOVE = auto()


class ClimateHumidity(Enum):
    LOW    = auto()
    NORMAL = auto()
    HIGH   = auto()   # FL default


class RoofShape(Enum):
    GABLE   = auto()
    HIP     = auto()
    SHED    = auto()
    COMPLEX = auto()   # mansard, mixed, etc.


class FrameType(Enum):
    CONVENTIONAL_STICK = auto()
    TRUSS              = auto()


class EdgeSupportMethod(Enum):
    TONGUE_AND_GROOVE = auto()
    PANEL_EDGE_CLIPS  = auto()
    BLOCKING_2X4      = auto()


class NailType(Enum):
    COMMON_6D             = auto()
    COMMON_8D             = auto()
    RING_SHANK_8D         = auto()
    ANNULAR_THREADED_8D   = auto()


class FastenerMode(Enum):
    NAIL   = auto()
    STAPLE = auto()


# =========================================================================
# DATACLASSES — Inputs
# =========================================================================

@dataclass(frozen=True)
class Climate:
    humidity: ClimateHumidity
    cold_design_temp_f: int
    january_mean_temp_f: int
    ice_risk_at_eaves: bool
    wind_driven_rain_zone: bool
    seismic_zone: bool


@dataclass(frozen=True)
class Frame:
    frame_type: FrameType
    rafter_spacing_in: int
    has_open_cornice_gable: bool
    has_vented_attic: bool


@dataclass(frozen=True)
class CoveringSpec:
    covering_type: CoveringType
    weight_psf: float                      # specific product weight
    life_expectancy_years: Optional[int] = None


@dataclass(frozen=True)
class ReroofContext:
    is_reroof_over_existing: bool
    existing_covering_weight_psf: Optional[float] = None
    existing_deck_has_pitch_or_loose_knots: bool = False


@dataclass(frozen=True)
class JobInputs:
    # Roof geometry
    roof_area_sf: float
    roof_shape: RoofShape
    slope_rise_per_12: float

    # Frame
    frame: Frame

    # New covering
    covering: CoveringSpec

    # Reroof context
    reroof: ReroofContext

    # Climate
    climate: Climate

    # Material prefs (optional; algorithm may override)
    sheathing_material_pref: Optional[SheathingMaterial] = None

    # Estimating inputs
    waste_factor: float = 0.10                    # 10% default
    rate_set_version: str = ""                    # required; non-empty


# =========================================================================
# DATACLASSES — Outputs
# =========================================================================

@dataclass(frozen=True)
class PanelSpec:
    material: SheathingMaterial
    thickness_in: float
    span_rating: Optional[str]   # e.g. "32/16", None for boards
    grade: Optional[str]         # e.g. "C-D Ext Glue", None for boards


@dataclass(frozen=True)
class FastenerSpec:
    mode: FastenerMode
    nail_type: Optional[NailType]       # populated when mode == NAIL
    staple_gauge: Optional[int]         # populated when mode == STAPLE
    staple_crown_in: Optional[float]
    staple_length_in: Optional[float]
    edge_oc_in: float
    field_oc_in: float


@dataclass(frozen=True)
class ExpansionGaps:
    end_gap_in: float
    side_gap_in: float


@dataclass(frozen=True)
class SolidZones:
    eave_solid_in: int                  # 12–24; 36 if low slope
    ridge_solid_each_side_in: int       # 18
    gable_overhang_solid: bool          # true if open cornice
    eave_protection_membrane_min_in: int  # 36


@dataclass(frozen=True)
class SheathingSpec:
    sheathing_type: SheathingType
    panel: Optional[PanelSpec]              # None if sheathing is BOARD
    board_width_nominal_in: Optional[int]   # populated for BOARD
    board_profile: Optional[BoardEdgeProfile]
    edge_support: Optional[EdgeSupportMethod]
    fasteners: FastenerSpec
    gaps: Optional[ExpansionGaps]           # None for BOARD
    solid_zones: Optional[SolidZones]       # populated for SPACED variants


@dataclass(frozen=True)
class CostLine:
    description: str
    quantity: float
    unit: str                # "SF", "LF", "EA", "MH", etc.
    unit_cost_usd: float
    extended_usd: float


@dataclass(frozen=True)
class WarningFlag:
    code: str                                 # snake_case identifier
    severity: Literal["info", "warning", "error"]
    message: str
    remediation: Optional[str] = None


@dataclass(frozen=True)
class BidOutput:
    sheathing_spec: SheathingSpec
    materials: list[CostLine]
    labor: list[CostLine]
    adders: list[CostLine]
    subtotal_usd: float
    total_usd: float
    flags: list[WarningFlag]
    staging_instruction: str
    rate_set_version: str
    priced_on: date
```

---

## 4. Constants Module

Generate `src/rules/constants.py` with exactly these values. Every constant cites a book section.

```python
"""
Chapter 2 constants. One source of truth for every numeric threshold.
Modifying a value requires updating:
  (a) the citation in this file
  (b) the corresponding test in tests/ch2/
  (c) the study packet source section
"""
from typing import Final

# =========================================================================
# LOAD RULES — §2E
# =========================================================================

DEAD_LOAD_BASELINE_PSF: Final[float] = 10.0
LIVE_LOAD_CODE_MIN_PSF: Final[float] = 30.0
DEFLECTION_RATIO: Final[int] = 240    # max deflection = span / 240

WEIGHT_PSF: Final[dict[str, float]] = {
    "wood_deck":          3.0,
    "felt_15lb":          0.15,
    "felt_30lb":          0.30,
    "roll_roofing_90lb":  0.9,
    "asphalt_shingle":    2.0,
    "fiberglass_shingle": 2.0,
    "tile_clay":          16.0,
    "tile_concrete":      10.0,    # verify per product
    "slate":              10.0,    # verify per product
    "metal_panel":        1.5,     # verify per product
    "wood_shake":         3.0,
}

# =========================================================================
# PANEL SPECS — §2D
# =========================================================================

MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN: Final[float] = 0.5
MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN: Final[int] = 24

MIN_PANEL_SPAN_RATING_UNSANDED: Final[str] = "32/16"
MIN_PANEL_SPAN_RATING_SANDED:   Final[str] = "Group 1"

# Expansion gaps (§2D)
PANEL_END_GAP_STANDARD_IN:   Final[float] = 1/16
PANEL_SIDE_GAP_STANDARD_IN:  Final[float] = 1/8
HIGH_HUMIDITY_GAP_MULTIPLIER: Final[float] = 2.0      # doubles gaps in humid climates

# =========================================================================
# FASTENER SPECS — §2D
# =========================================================================

NAIL_EDGE_OC_IN:  Final[float] = 6.0
NAIL_FIELD_OC_IN: Final[float] = 12.0

STAPLE_CROWN_MIN_IN:     Final[float] = 3/8
STAPLE_LENGTH_OVER_PANEL_THICKNESS_IN: Final[float] = 1.0   # = thickness + 1"
STAPLE_GAUGE:            Final[int]   = 16

STAPLE_EDGE_OC_IN_LIGHT:  Final[float] = 4.0   # ≤ ½" panels
STAPLE_FIELD_OC_IN_LIGHT: Final[float] = 8.0
STAPLE_EDGE_OC_IN_HEAVY:  Final[float] = 2.0   # > ½"
STAPLE_FIELD_OC_IN_HEAVY: Final[float] = 5.0

PANEL_THICKNESS_FASTENER_BREAKPOINT_IN: Final[float] = 0.5   # ≤ vs > threshold

# =========================================================================
# BOARD SHEATHING — §2C
# =========================================================================

BOARD_NAILS_PER_RAFTER_UP_TO_1X8:  Final[int] = 2
BOARD_NAILS_PER_RAFTER_OVER_1X8:   Final[int] = 3
MAX_BOARD_NOMINAL_WIDTH_RECOMMENDED_IN: Final[int] = 6   # book prefers 1×6 max
MIN_END_JOINT_GAP_IN: Final[float] = 1/8

BOARD_FACE_NAIL_SIZE = "8d common"   # §2C

# =========================================================================
# OSB / WAFERBOARD — §2G
# =========================================================================

OSB_MIN_THICKNESS_IN: Final[float] = 15/32

WAFERBOARD_MAX_SPAN_IN: Final[dict[str, int]] = {
    "3/8":  16,
    "7/16": 24,
    "1/2":  24,
}

# =========================================================================
# WOOD SHINGLE / SHAKE RULES — §2B, §2I, §2K
# =========================================================================

WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12: Final[float] = 4.0   # §2K

# Cold-climate triggers that force solid under wood — §2B
WOOD_SHINGLE_COLD_DESIGN_TEMP_F_MAX: Final[int] = 0     # ≤ → force solid
WOOD_SHINGLE_JAN_MEAN_TEMP_F_MAX:    Final[int] = 25    # ≤ → force solid

# Shake spaced-sheathing hard cap (§2I)
SHAKE_SPACING_MAX_IN: Final[float] = 2.5   # prevents interlayment sag

# =========================================================================
# SOLID ZONES ON SPACED-SHEATHING ROOFS — §2J
# =========================================================================

EAVE_SOLID_MIN_IN:           Final[int] = 12    # past interior wall face
EAVE_SOLID_MAX_IN:           Final[int] = 24
EAVE_SOLID_LOW_SLOPE_IN:     Final[int] = 36    # slope < 4:12
RIDGE_SOLID_EACH_SIDE_IN:    Final[int] = 18    # author rec
EAVE_PROTECTION_MIN_IN:      Final[int] = 36

# =========================================================================
# LABOR RATES — §2N
# =========================================================================

DEFAULT_LABOR_RATE_MH_PER_SF: Final[dict[str, float]] = {
    "board_sheathing":   0.026,
    "plywood_sheathing": 0.013,
    # OSB & decking: add when field-verified
}

BOOK_HISTORICAL_CREW_MH_RATE_USD: Final[float] = 33.85   # reference only; NEVER use as runtime default

# =========================================================================
# TILE LOADING — §2M
# =========================================================================

TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT: Final[float] = 1.0
GABLE_STACK_SIZE_EVERY_4TH_COURSE:     Final[int]   = 8
GABLE_STACK_SIZE_AT_RIDGE:             Final[int]   = 4
GABLE_COURSE_INTERVAL_FOR_STACKS:      Final[int]   = 4
```

---

## 5. Error Types

Generate `src/rules/errors.py`:

```python
class Ch2Error(Exception):
    """Base exception for Chapter 2 rule violations."""

class SheathingSpecViolation(Ch2Error):
    """Hard rule from the book violated by the chosen spec."""

class LoadCapacityExceeded(Ch2Error):
    """Dead load exceeds what the frame/panel can support."""

class MissingRequiredInput(Ch2Error):
    """A required input is missing (rate, SKU, dimension, etc.)."""

class UnknownCoveringType(Ch2Error):
    """Covering is not in the enum — caller bug."""

class InvalidGeometry(Ch2Error):
    """Impossible geometry (slope < 0, area ≤ 0, negative spacing, etc.)."""

class HumidityGapMismatch(Ch2Error):
    """High-humidity climate declared but standard gaps applied."""

class RateSetMissing(Ch2Error):
    """No RateSet was provided or the version is stale."""

class PanelSelectionFailed(Ch2Error):
    """No APA panel in Table 21 satisfies the load + spacing constraint."""
```

---

## 6. Algorithm Specifications

Each algorithm is numbered. Implement in order. Write tests first for each.

### ALG-001 — Sheathing Type Decision

**Module:** `src/rules/sheathing/decisions.py`

**Source:** §2A, §2B, §2I, §2K

**Signature:**
```python
def determine_sheathing_type(
    inputs: JobInputs,
    flags: list[WarningFlag],   # appended to, not mutated externally
) -> SheathingType:
```

**Logic (order-sensitive — early returns):**

1. Geometry validation: if `inputs.slope_rise_per_12 < 0` or `inputs.roof_area_sf <= 0` → raise `InvalidGeometry`.
2. If `inputs.climate.seismic_zone` is True → return `SheathingType.SOLID` *(§2A override)*.
3. If `inputs.covering.covering_type in SOLID_REQUIRED_COVERINGS` → return `SheathingType.SOLID`.
4. If `inputs.covering.covering_type == CoveringType.METAL_CORRUGATED`:
   - Default to `SOLID` per §2A.
   - Append flag `metal_corrugated_spaced_allowed_by_local_code` (info).
   - Return `SOLID`.
5. If `inputs.covering.covering_type in WOOD_COVERINGS`:
   - **Cold triggers (§2B):** if `climate.cold_design_temp_f <= WOOD_SHINGLE_COLD_DESIGN_TEMP_F_MAX` OR `climate.january_mean_temp_f <= WOOD_SHINGLE_JAN_MEAN_TEMP_F_MAX` OR `climate.ice_risk_at_eaves` → return `SOLID`.
   - **Low slope (§2K):** if `inputs.slope_rise_per_12 < WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12` → return `SPACED_OVER_SOLID_HYBRID`.
   - **FL override (§2A):** if `climate.wind_driven_rain_zone` → append flag `wind_rain_zone_solid_recommended` (warning). Still return `SPACED_WITH_SOLID_ZONES` per strict book logic; let UI surface the flag.
   - Otherwise → return `SPACED_WITH_SOLID_ZONES`.
6. Unreachable → raise `UnknownCoveringType(f"covering={inputs.covering.covering_type}")`.

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | `ASPHALT_SHINGLE`, any climate | `SOLID` |
| 2 | `WOOD_SHAKE`, slope = 4.0 (boundary) | `SPACED_WITH_SOLID_ZONES` (4 is NOT less than 4) |
| 3 | `WOOD_SHAKE`, slope = 3.99 | `SPACED_OVER_SOLID_HYBRID` |
| 4 | `WOOD_SHAKE`, `cold_design_temp_f = 0` (boundary, ≤) | `SOLID` |
| 5 | `WOOD_SHAKE`, `cold_design_temp_f = 1` | evaluate next rule |
| 6 | `WOOD_SHAKE`, FL wind-rain, slope 6:12 | `SPACED_WITH_SOLID_ZONES` + flag |
| 7 | `METAL_CORRUGATED` | `SOLID` + info flag |
| 8 | seismic = True, `WOOD_SHAKE`, cold | `SOLID` (seismic wins; short-circuit early) |
| 9 | slope = 0.0 (flat), `ASPHALT_SHINGLE` | `SOLID` + flag `flat_slope_review_ch10` |
| 10 | slope = -1 | raise `InvalidGeometry` |
| 11 | Unknown enum value (future addition) | raise `UnknownCoveringType` |

**Tests (minimum — write these in `test_alg_001_decisions.py`):**

```python
def test_seismic_forces_solid_over_wood_shake_with_cold():
    inp = make_inputs(covering=WOOD_SHAKE, slope=6,
                      seismic=True, cold_temp=-10)
    flags = []
    assert determine_sheathing_type(inp, flags) == SheathingType.SOLID

def test_wood_shake_at_exactly_4_12_not_hybrid():
    inp = make_inputs(covering=WOOD_SHAKE, slope=4.0)
    assert determine_sheathing_type(inp, []) == SheathingType.SPACED_WITH_SOLID_ZONES

def test_wood_shake_at_399_12_is_hybrid():
    inp = make_inputs(covering=WOOD_SHAKE, slope=3.99)
    assert determine_sheathing_type(inp, []) == SheathingType.SPACED_OVER_SOLID_HYBRID

def test_wood_shake_fl_wind_rain_gets_flag():
    inp = make_inputs(covering=WOOD_SHAKE, slope=6, wind_rain=True)
    flags = []
    result = determine_sheathing_type(inp, flags)
    assert result == SheathingType.SPACED_WITH_SOLID_ZONES
    assert any(f.code == "wind_rain_zone_solid_recommended" for f in flags)

def test_negative_slope_raises():
    inp = make_inputs(slope=-1)
    with pytest.raises(InvalidGeometry):
        determine_sheathing_type(inp, [])
```

---

### ALG-002 — Dead Load & Effective Live Load

**Module:** `src/rules/sheathing/loads.py`

**Source:** §2E

**Signature:**
```python
def compute_effective_live_load_psf(
    total_dead_load_psf: float
) -> float:
```

**Logic:**

1. `excess_dead = max(0, total_dead_load_psf - DEAD_LOAD_BASELINE_PSF)`
2. Return `LIVE_LOAD_CODE_MIN_PSF + excess_dead`

**Helper also required:**
```python
def compute_total_dead_load_psf(
    deck_type: str,              # key into WEIGHT_PSF
    underlayment_type: str,      # key into WEIGHT_PSF
    covering_weight_psf: float,  # from CoveringSpec
) -> float:
    return (WEIGHT_PSF[deck_type]
            + WEIGHT_PSF[underlayment_type]
            + covering_weight_psf)
```

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | dead = 5 psf | effective live = 30 |
| 2 | dead = 10 psf (boundary) | effective live = 30 |
| 3 | dead = 10.01 psf | effective live = 30.01 |
| 4 | dead = 20 psf (tile example) | effective live = 40 |
| 5 | dead = 0 | effective live = 30 |
| 6 | dead = -1 | no assert, but this should not happen — log a warning |
| 7 | Unknown deck_type key | raise `KeyError` (caller bug) |

---

### ALG-003 — APA Panel Selection (Table 21)

**Module:** `src/rules/sheathing/panels.py`

**Source:** §2D, §2F (Table 21)

**Signature:**
```python
def select_apa_panel(
    rafter_spacing_in: int,
    effective_live_load_psf: float,
    covering: CoveringType,
    with_edge_support: bool,
) -> PanelSpec:
```

**Data required:** the full Table 21 as a lookup structure. Generate it as `APA_TABLE_21` in `src/rules/sheathing/panel_data.py`. Rows are (span_rating, min_thickness_in, max_span_with_edge_support_in, max_span_without_edge_support_in, live_loads_psf_by_spacing).

```python
APA_TABLE_21 = [
    # (span_rating, min_thick_in, max_w_edge, max_wo_edge, {12: lb, 16: lb, ...})
    ("12/0",  5/16,  12, 12, {12: 30}),
    ("16/0",  5/16,  16, 16, {12: 70,  16: 30}),
    ("20/0",  5/16,  20, 20, {12: 120, 16: 50,  20: 30}),
    ("24/0",  3/8,   24, 20, {12: 190, 16: 100, 20: 60,  24: 30}),
    ("24/16", 7/16,  24, 24, {12: 190, 16: 100, 20: 65,  24: 40}),
    ("32/16", 15/32, 32, 28, {12: 325, 16: 180, 20: 120, 24: 70,  32: 30}),
    ("40/20", 19/32, 40, 32, {16: 305, 20: 205, 24: 130, 32: 60,  40: 30}),
    ("48/24", 23/32, 48, 36, {20: 280, 24: 175, 32: 95,  40: 45,  48: 35}),
    ("60/32", 7/8,   60, 48, {24: 305, 32: 165, 40: 100, 48: 70,  60: 35}),
]
```

**Logic:**

1. Iterate rows in order (smallest to largest).
2. For each row, check:
   - Is `rafter_spacing_in` ≤ `max_w_edge` (if `with_edge_support`) else `max_wo_edge`?
   - Does `live_loads[rafter_spacing_in]` (if key exists) ≥ `effective_live_load_psf`?
3. First row that satisfies both → return `PanelSpec(PLYWOOD, min_thick_in, span_rating, "C-D Ext Glue")`.
4. **Covering-specific minimums (§2D):**
   - If `covering == BUILT_UP`: enforce `min_thickness >= MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN`.
   - If `covering == BUILT_UP and rafter_spacing_in > 24`: raise `SheathingSpecViolation("built-up roof with ½\" plywood requires rafter spacing ≤ 24\"")`.
5. If no row satisfies → raise `PanelSelectionFailed(f"no panel supports {rafter_spacing_in}\" spacing at {effective_live_load_psf} psf")`.

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | 24" spacing, 30 psf, with edge support | `32/16` (15/32") |
| 2 | 24" spacing, 40 psf, with edge support | `24/16` (7/16") — boundary, 40 psf matches exactly |
| 3 | 24" spacing, 41 psf, with edge support | `32/16` (next higher) |
| 4 | 48" spacing, 35 psf | `60/32` (7/8") |
| 5 | 48" spacing, 100 psf | fails — no row supports this |
| 6 | 16" spacing, 180 psf, with edge support | `32/16` |
| 7 | BUILT_UP covering, 24" spacing | thickness must be ≥ ½" |
| 8 | BUILT_UP covering, 28" spacing | raise `SheathingSpecViolation` |
| 9 | spacing of 19.2" (truss common spacing) | round up to 24" bin OR interpolate — **flag for clarification** |

> ⚠️ **Edge case 9 is UNDECIDED.** Claude Code: add a `TODO` comment and use "round up to next tabulated spacing" for now. Flag this in the migration report for Carlos to confirm.

---

### ALG-004 — Board Sheathing Fastener Count

**Module:** `src/rules/sheathing/board.py`

**Source:** §2C

**Signature:**
```python
def nails_per_rafter_for_board(board_width_nominal_in: int) -> int:
```

**Logic:** Return 2 if `board_width_nominal_in <= 8` else 3.

**Edge cases:**
| # | Input | Output |
|---|---|---|
| 1 | 4 | 2 |
| 2 | 6 | 2 |
| 3 | 8 (boundary) | 2 |
| 4 | 10 | 3 |
| 5 | 12 | 3 |
| 6 | 0 or negative | raise `InvalidGeometry` |

---

### ALG-005 — Spaced Sheathing Spacing (Wood Shingles/Shakes)

**Module:** `src/rules/sheathing/spaced.py`

**Source:** §2I

**Signature:**
```python
def spaced_sheathing_spacing(
    covering: CoveringType,
    weather_exposure_in: float,
    method: Literal["1x4_one_per_course", "1x6_two_per_course"] = "1x4_one_per_course",
) -> tuple[int, float]:   # returns (board_nominal_width, center_spacing_in)
```

**Logic:**

1. If `covering == WOOD_SHAKE`:
   - Board: 6 (nominal 1×6).
   - Center spacing: `weather_exposure_in`.
   - **Hard cap: if `weather_exposure_in > SHAKE_SPACING_MAX_IN` raise `SheathingSpecViolation("shake spacing exceeds 2.5\" max — interlayment will sag")`**.
2. If `covering == WOOD_SHINGLE`:
   - Method 1 (`1x4_one_per_course`): board = 4, spacing = `weather_exposure_in`.
   - Method 2 (`1x6_two_per_course`): board = 6. If `weather_exposure_in <= 5.5`: spacing convention = "two courses per board". If `weather_exposure_in > 5.5` (e.g. 7.5): spacing = `weather_exposure_in`. Represent "two courses per board" with a sentinel OR return two separate fields — **recommend:** widen the return type to `dataclass SpacedBoardLayout`.
3. Otherwise → raise `SheathingSpecViolation("spaced sheathing only applies to wood coverings")`.

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | Shake, exposure 2.5 (boundary) | board=6, spacing=2.5 ✅ |
| 2 | Shake, exposure 2.6 | raise `SheathingSpecViolation` |
| 3 | Shingle Method 1, exposure 5.5 | board=4, spacing=5.5 |
| 4 | Shingle Method 2, exposure 5.5 | board=6, two-per-course |
| 5 | Shingle Method 2, exposure 7.5 | board=6, spacing=7.5 (one per) |
| 6 | Covering = ASPHALT_SHINGLE | raise `SheathingSpecViolation` |

---

### ALG-006 — Low-Slope Wood Build-up Layers

**Module:** `src/rules/sheathing/low_slope.py`

**Source:** §2K

**Signature:**
```python
def low_slope_wood_layer_stack(slope_rise_per_12: float) -> list[str]:
```

**Logic:** Only applies when `slope_rise_per_12 < WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12`. Otherwise return empty list or raise — **decision: raise `SheathingSpecViolation("low-slope build-up not applicable at ≥4:12")`**. Returns the 10-layer stack from §2K bottom-up:

```python
return [
    "solid_sheathing",
    "36in_felt_underlay",
    "hot_mop_built_up",
    "15in_shake_starter_course",
    "18in_felt_overlay_between_courses",
    "2x4_spacers_at_24in_oc",
    "1x4_or_1x6_nailing_strips",
    "4in_felt_overlap_between_courses",
    "24in_handsplit_resawn_shakes_at_10in_exposure",
    "2_nails_per_shake",
]
```

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | slope = 3:12 | returns 10-layer list |
| 2 | slope = 4:12 (boundary) | raise `SheathingSpecViolation` |
| 3 | slope = 0:12 | returns list + flag `extreme_low_slope_review_ch10_builtup` |

---

### ALG-007 — Edge Support Requirement

**Module:** `src/rules/sheathing/edge_support.py`

**Source:** §2D

**Signature:**
```python
def edge_support_required(
    panel: PanelSpec,
    rafter_spacing_in: int,
    board_profile_in_use: Optional[BoardEdgeProfile],
) -> Optional[EdgeSupportMethod]:
```

**Logic:**

1. If the panel has T&G edges (check panel SKU metadata): return `EdgeSupportMethod.TONGUE_AND_GROOVE` (built-in, no additional component needed — but the panel cost reflects T&G upcharge).
2. If the panel will span more than its `max_span_without_edge_support` at `rafter_spacing_in`: edge support IS required. Default recommendation: `EdgeSupportMethod.PANEL_EDGE_CLIPS` (cheapest, fastest labor).
3. If edge support is required and the covering is BUILT_UP at 48" o.c. spacing: two clips per span required, not one (§2D / Table 21 footnote a).
4. Alternative is `EdgeSupportMethod.BLOCKING_2X4` — use when the owner specifies it or when clips are not available.
5. Returns `None` only if T&G or if panel fits within `max_span_without_edge_support`.

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | 15/32 panel, 24" spacing | T&G or clips (24 > 28? no — 24 ≤ 28, no edge support strictly required). Return None unless covering is BUILT_UP in humid climate (add flag). |
| 2 | 15/32 panel, 32" spacing | clips required (24" without edge support < 32) — wait, 15/32 max without edge is 28 per table; 32 > 28 → clips required |
| 3 | 23/32 panel, 48" spacing (low slope) | clips with 2 per span |

---

### ALG-008 — Nail Schedule for Panel Sheathing

**Module:** `src/rules/sheathing/fasteners.py`

**Source:** §2D

**Signature:**
```python
def nail_schedule_for_panel(
    thickness_in: float,
    prefer_ring_shank: bool = True,
) -> FastenerSpec:
```

**Logic:**

1. If `thickness_in <= PANEL_THICKNESS_FASTENER_BREAKPOINT_IN`:
   - nail = `NailType.COMMON_6D` (or `RING_SHANK_8D` if `prefer_ring_shank` — note: ring shank is 8d, so upgrade to 8d size when switching)
2. Else (thickness > ½"):
   - nail = `NailType.RING_SHANK_8D` if `prefer_ring_shank` else `NailType.COMMON_8D`
3. Return `FastenerSpec(mode=NAIL, nail_type=..., edge_oc_in=NAIL_EDGE_OC_IN, field_oc_in=NAIL_FIELD_OC_IN, ...)`.

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | thickness = 0.5, prefer_ring = False | `COMMON_6D`, 6"/12" |
| 2 | thickness = 0.5, prefer_ring = True | `RING_SHANK_8D`, 6"/12" (upgrade size) |
| 3 | thickness = 15/32 (0.46875) | `COMMON_6D` (≤ 0.5 path) |
| 4 | thickness = 0.5001 | `COMMON_8D` or ring-shank 8d |

---

### ALG-009 — Staple Schedule for Panel Sheathing

**Module:** `src/rules/sheathing/fasteners.py`

**Source:** §2D

**Signature:**
```python
def staple_schedule_for_panel(thickness_in: float) -> FastenerSpec:
```

**Logic:**

1. If `thickness_in <= PANEL_THICKNESS_FASTENER_BREAKPOINT_IN`:
   - edge = `STAPLE_EDGE_OC_IN_LIGHT` (4"), field = `STAPLE_FIELD_OC_IN_LIGHT` (8")
2. Else:
   - edge = `STAPLE_EDGE_OC_IN_HEAVY` (2"), field = `STAPLE_FIELD_OC_IN_HEAVY` (5")
3. `staple_crown_in = STAPLE_CROWN_MIN_IN` (3/8")
4. `staple_length_in = thickness_in + STAPLE_LENGTH_OVER_PANEL_THICKNESS_IN` (thickness + 1")
5. `staple_gauge = STAPLE_GAUGE` (16)

---

### ALG-010 — Panel Expansion Gaps

**Module:** `src/rules/sheathing/expansion_gaps.py`

**Source:** §2D (humidity doubling rule)

**Signature:**
```python
def panel_expansion_gaps(humidity: ClimateHumidity) -> ExpansionGaps:
```

**Logic:**

1. `end_gap = PANEL_END_GAP_STANDARD_IN` (1/16")
2. `side_gap = PANEL_SIDE_GAP_STANDARD_IN` (1/8")
3. If `humidity == ClimateHumidity.HIGH`:
   - `end_gap *= HIGH_HUMIDITY_GAP_MULTIPLIER` → 1/8"
   - `side_gap *= HIGH_HUMIDITY_GAP_MULTIPLIER` → 1/4"

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | LOW humidity | 1/16, 1/8 |
| 2 | NORMAL humidity | 1/16, 1/8 |
| 3 | HIGH humidity (FL) | 1/8, 1/4 |

---

### ALG-011 — Solid Zones on Spaced-Sheathing Roofs

**Module:** `src/rules/sheathing/solid_zones.py`

**Source:** §2J

**Signature:**
```python
def solid_zones_for_spaced_roof(
    slope_rise_per_12: float,
    has_open_cornice_gable: bool,
) -> SolidZones:
```

**Logic:**

1. `eave_solid_in` = range midpoint 12–24" → use 18" (configurable).
   - **If `slope_rise_per_12 < 4`:** `eave_solid_in = EAVE_SOLID_LOW_SLOPE_IN` (36)
2. `ridge_solid_each_side_in = RIDGE_SOLID_EACH_SIDE_IN` (18)
3. `gable_overhang_solid = has_open_cornice_gable`
4. `eave_protection_membrane_min_in = EAVE_PROTECTION_MIN_IN` (36)

**Note:** Only populate for `SPACED_WITH_SOLID_ZONES` or `SPACED_OVER_SOLID_HYBRID`. `SOLID` sheathing doesn't need this structure.

---

### ALG-012 — Humidity Gap Validation Gate

**Module:** `src/rules/sheathing/expansion_gaps.py`

**Purpose:** After panel install specs are computed, verify gaps match humidity.

**Signature:**
```python
def validate_gaps_match_humidity(
    gaps: ExpansionGaps,
    humidity: ClimateHumidity,
) -> None:
```

**Logic:**

1. Compute expected via `panel_expansion_gaps(humidity)`.
2. If `gaps != expected` → raise `HumidityGapMismatch(f"humidity={humidity}, gaps={gaps}, expected={expected}")`.

This runs in the validation phase (§7) before cost calc.

---

### ALG-013 — OSB / Waferboard Span Check

**Module:** `src/rules/sheathing/osb.py`

**Source:** §2G

**Signature:**
```python
def osb_max_span_for_thickness(thickness_str: str) -> int:
    """thickness_str is one of '3/8', '7/16', '1/2'"""
```

Direct lookup in `WAFERBOARD_MAX_SPAN_IN`. Raise `KeyError`-based error wrapped in `SheathingSpecViolation` for unknown thicknesses.

Also validate: OSB minimum thickness 15/32 (`OSB_MIN_THICKNESS_IN`) regardless of span.

---

### ALG-014 — Tile Loading Pattern (Gable)

**Module:** `src/rules/sheathing/staging.py`

**Source:** §2M

**Signature:**
```python
def gable_tile_loading_pattern(slope_courses: int) -> list[dict]:
    """
    Returns list of {course: int, stack_size: int, horizontal_gap_ft: 1.0}
    for work-order output.
    """
```

**Logic:**

- Top course (`course == slope_courses`, i.e., at ridge): `stack_size = GABLE_STACK_SIZE_AT_RIDGE` (4)
- Every 4th course (`course % GABLE_COURSE_INTERVAL_FOR_STACKS == 0`) below ridge: `stack_size = GABLE_STACK_SIZE_EVERY_4TH_COURSE` (8)
- Other courses: not loaded (absent from the output list)
- `horizontal_gap_ft = TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT` (1.0)

**Edge cases:**

| # | Scenario | Expected |
|---|---|---|
| 1 | slope_courses = 10 | stacks at courses 4, 8, and 10 (ridge). 4 & 8 = size 8; 10 = size 4 |
| 2 | slope_courses = 3 (tiny roof) | ridge stack only (course 3, size 4) |
| 3 | slope_courses = 0 | raise `InvalidGeometry` |

---

### ALG-015 — Hip Tile Loading Pattern

**Module:** `src/rules/sheathing/staging.py`

**Source:** §2M (Figure 2-18)

**Status:** **Partial — scale by course length.** Claude Code: implement a stub that returns a flag `hip_tile_loading_review_needed` and the general rules (1 ft gap, multiple pallets, pre-load on reroof). Full course-length-scaled stack sizes will be added when more specific tile SKU data is available.

---

### ALG-016 — Frame Load Capacity Flag

**Module:** `src/rules/framing.py`

**Source:** §1B, §2E

**Signature:**
```python
def flag_frame_load_check_needed(
    new_weight_psf: float,
    existing_weight_psf: Optional[float],
    is_reroof: bool,
) -> Optional[WarningFlag]:
```

**Logic:**

If `is_reroof` AND (`existing_weight_psf is None` OR `new_weight_psf > existing_weight_psf`) → return `WarningFlag(code="frame_load_check_required", severity="warning", ...)`.
Otherwise return `None`.

---

### ALG-017 — Attic Ventilation Gate

**Module:** `src/rules/ventilation.py`

**Source:** §2H

**Signature:**
```python
def check_attic_ventilation(
    sheathing_type: SheathingType,
    has_vented_attic: bool,
) -> Optional[WarningFlag]:
```

**Logic:**

If `sheathing_type == SOLID` AND `not has_vented_attic` → return warning flag with remediation "add vent corrective work to bid".

---

### ALG-018 — Material Cost Line

**Module:** `src/estimating/material_cost.py`

**Source:** §2N

**Signature:**
```python
def material_cost_line(
    roof_area_sf: float,
    waste_factor: float,
    material_cost_per_sf_usd: float,
    description: str,
) -> CostLine:
```

**Logic:**

1. Validate: `roof_area_sf > 0`, `0 <= waste_factor < 1`, `material_cost_per_sf_usd >= 0`.
2. `quantity = roof_area_sf * (1 + waste_factor)`
3. `extended = quantity * material_cost_per_sf_usd`
4. Return `CostLine(description, quantity, "SF", material_cost_per_sf_usd, extended)`.

---

### ALG-019 — Labor Cost Line

**Module:** `src/estimating/labor_cost.py`

**Source:** §2N

**Signature:**
```python
def labor_cost_line(
    roof_area_sf: float,
    sheathing_material: SheathingMaterial,
    crew_manhour_rate_usd: float,
    rate_override_mh_per_sf: Optional[float] = None,
) -> CostLine:
```

**Logic:**

1. Validate: `roof_area_sf > 0`, `crew_manhour_rate_usd > 0`.
2. Look up rate:
   ```
   if rate_override_mh_per_sf is not None: rate = rate_override_mh_per_sf
   elif material == BOARD:   rate = DEFAULT_LABOR_RATE_MH_PER_SF["board_sheathing"]
   elif material == PLYWOOD: rate = DEFAULT_LABOR_RATE_MH_PER_SF["plywood_sheathing"]
   else: raise MissingRequiredInput(f"no labor rate for {material}")
   ```
3. `manhours = roof_area_sf * rate`
4. `extended = manhours * crew_manhour_rate_usd`
5. Return `CostLine("Sheathing install labor", manhours, "MH", crew_manhour_rate_usd, extended)`.

---

### ALG-020 — Cost Engine (Top-Level Entry Point)

**Module:** `src/estimating/cost_engine.py`

**Source:** §2N + all of above

**Signature:**
```python
def price_sheathing_bid(
    inputs: JobInputs,
    rate_set: RateSet,   # see §9.1
) -> BidOutput:
```

**Logic (high-level orchestration):**

1. Run validation gates (§7). Collect any flags.
2. `sheathing_type = determine_sheathing_type(inputs, flags)` (ALG-001)
3. Compute dead load (ALG-002 helper) and effective live load.
4. Pick panel/board per sheathing type:
   - `SOLID` or `SPACED_OVER_SOLID_HYBRID` → ALG-003 (plywood) or ALG-013 (OSB) or ALG-004 lookup (board)
   - `SPACED_WITH_SOLID_ZONES` → ALG-005 (board spacing) + ALG-011 (solid zones)
5. Compute fasteners (ALG-008 / ALG-009) and gaps (ALG-010).
6. Validate gaps vs humidity (ALG-012).
7. Check framing load flag (ALG-016) and attic ventilation (ALG-017).
8. Compute material line (ALG-018) and labor line (ALG-019).
9. Compute adders (eave membrane, edge clips, blocking, sheet metal patches if pitch/knots exist).
10. Sum to `subtotal_usd`, apply tax if `rate_set.tax_rate`, produce `total_usd`.
11. Generate staging instruction string (§2M).
12. Assemble and return `BidOutput(..., rate_set_version=rate_set.version, priced_on=date.today())`.

---

## 7. Validation Gates

Run ALL gates before calling the cost engine. Each gate returns `None` (pass) or raises the typed error.

Module: `src/validation/ch2_gates.py`

```python
def validate_job_inputs(inputs: JobInputs) -> None:
    # Geometry
    if inputs.roof_area_sf <= 0:
        raise InvalidGeometry("roof_area_sf must be > 0")
    if inputs.slope_rise_per_12 < 0:
        raise InvalidGeometry("slope cannot be negative")
    if inputs.frame.rafter_spacing_in <= 0:
        raise InvalidGeometry("rafter_spacing_in must be > 0")

    # Costing inputs
    if not inputs.rate_set_version:
        raise MissingRequiredInput("rate_set_version is required for audit trail")
    if not (0 <= inputs.waste_factor < 1):
        raise InvalidGeometry(f"waste_factor must be [0, 1), got {inputs.waste_factor}")

    # Covering enum
    if inputs.covering.covering_type not in CoveringType:
        raise UnknownCoveringType(str(inputs.covering.covering_type))

    # Reroof consistency
    if inputs.reroof.is_reroof_over_existing and inputs.reroof.existing_covering_weight_psf is None:
        raise MissingRequiredInput("reroof requires existing_covering_weight_psf")
```

Also enforce the covering-specific rules (e.g., BUILT_UP + spacing > 24" with ½" plywood → `SheathingSpecViolation` in ALG-003).

---

## 8. Cost Engine Integration

The `BidOutput` shape is the contract between Python backend and Flutter frontend. Do not change field names without a coordinated FE update.

**Serialization:** the Flutter app will JSON-serialize/deserialize `BidOutput`. Use `dataclasses.asdict()` on the Python side; enums serialize to their `.name` strings.

**Required output fields:**
- `sheathing_spec` (structured, for work-order generation)
- `materials`, `labor`, `adders` (itemized cost lines)
- `flags` (renderable warnings/info)
- `staging_instruction` (string for work order)
- `rate_set_version`, `priced_on` (audit trail)
- `subtotal_usd`, `total_usd`

---

## 9. RateSet & Configuration

### 9.1 RateSet class

```python
@dataclass(frozen=True)
class RateSet:
    version: str                              # e.g. "FL-2026-Q2-v1"
    source: str                               # "NCE 2025", "in-house 2024 data"
    crew_manhour_rate_usd: float
    labor_rates_mh_per_sf: dict[str, float]   # keys: "board_sheathing", ...
    material_skus_usd_per_sf: dict[str, float] # keys: material SKU codes
    tax_rate: float                           # 0.0–1.0
    last_verified_date: date
```

### 9.2 RateSet loading rules

- Load from a versioned config source (YAML, DB table, etc.). Never hardcode.
- Each bid stores its `RateSet.version`. Re-pricing a bid under a new RateSet requires an explicit migration action; it never happens silently.
- Stale RateSet detection: warn if `last_verified_date` > 1 year old.

### 9.3 Book values for seeding

Use these as initial seed data ONLY — mark them as historical in the DB:

| Field | Value | Note |
|---|---|---|
| `crew_manhour_rate_usd` | 33.85 | §2N historical; will be overridden |
| `labor_rates_mh_per_sf["board_sheathing"]` | 0.026 | §2N |
| `labor_rates_mh_per_sf["plywood_sheathing"]` | 0.013 | §2N |

### 9.4 Florida Overrides

Pack these into a separate module `src/rules/fl_overrides.py`. They apply when `inputs.climate.wind_driven_rain_zone` is True.

1. Default sheathing preference: SOLID (even where SPACED would satisfy national code).
2. Default nail: `NailType.RING_SHANK_8D` (not COMMON_8D).
3. Expansion gaps: doubled (already handled by ALG-010 with HIGH humidity).
4. HVHZ rider flag: if location is Miami-Dade or Broward, flag `hvhz_fastener_schedule_verify` for nail-schedule verification against FBC (panel edge spacing may be tighter than APA 6"/12"). Claude Code: **do not alter the base rule** — only add the flag.

---

## 10. Edge Case Matrix

These are the scenarios `tests/ch2/test_edge_matrix.py` must cover. Each row is a single test function named `test_edge_NNN_<slug>`.

| # | Scenario | Expected behavior |
|---|---|---|
| E-001 | ASPHALT_SHINGLE, 24" rafters, 30 psf live, FL humid | SOLID, 15/32 plywood 32/16, 6d common (8d ring if prefer), gaps 1/8"/1/4" |
| E-002 | TILE_CLAY, 24" rafters | SOLID, dead load ~20 psf, need 24/16 min (40 psf live allowed) |
| E-003 | TILE_CLAY, 28" rafters, BUILT_UP | raise `SheathingSpecViolation` (built-up + ½" + >24") |
| E-004 | WOOD_SHAKE, 4:12 slope, normal climate | SPACED_WITH_SOLID_ZONES |
| E-005 | WOOD_SHAKE, 3.99:12 slope | SPACED_OVER_SOLID_HYBRID, 10-layer stack |
| E-006 | WOOD_SHAKE, shake exposure 2.5" | spacing OK, board = 1×6 |
| E-007 | WOOD_SHAKE, shake exposure 2.6" | raise `SheathingSpecViolation` (interlayment sag) |
| E-008 | Seismic zone + WOOD_SHAKE + 6:12 + warm | SOLID (seismic wins) |
| E-009 | FL wind_driven_rain + WOOD_SHAKE + 6:12 | SPACED_WITH_SOLID_ZONES + flag `wind_rain_zone_solid_recommended` |
| E-010 | slope = 0 | SOLID + flag `flat_slope_review_ch10` |
| E-011 | slope = -1 | raise `InvalidGeometry` |
| E-012 | roof_area_sf = 0 | raise `InvalidGeometry` |
| E-013 | rafter_spacing = 0 | raise `InvalidGeometry` |
| E-014 | rafter_spacing = 19.2 (truss) | rounded up to 24" bin + TODO flag |
| E-015 | Dead load = exactly 10 psf | effective live = 30 psf (no deduction) |
| E-016 | Dead load = 20 psf, 24" spacing | effective live = 40 psf, pick 24/16 |
| E-017 | Reroof over existing, heavier new covering | flag `frame_load_check_required` |
| E-018 | Attic not vented, SOLID | flag `ventilation_insufficient` |
| E-019 | Attic not vented, SPACED (wood shingles, breathes) | no flag (spaced breathes naturally) |
| E-020 | 48" rafter spacing, BUILT_UP, low slope | 60/32 panel, 2 clips per span per Table 22 |
| E-021 | 48" rafter spacing, 100 psf live required | raise `PanelSelectionFailed` |
| E-022 | Board sheathing, 1×8 | 2 nails per rafter |
| E-023 | Board sheathing, 1×10 | 3 nails per rafter |
| E-024 | HIGH humidity (FL) + standard gaps | raise `HumidityGapMismatch` on validate |
| E-025 | crew_manhour_rate = 0 | raise `MissingRequiredInput` |
| E-026 | rate_set_version = "" | raise `MissingRequiredInput` |
| E-027 | RateSet.last_verified_date > 1 year ago | flag `rate_set_stale` |
| E-028 | Open cornice + SPACED | solid_zones.gable_overhang_solid = True |
| E-029 | Existing deck has pitch/loose knots | adders includes "sheet_metal_patches" line |
| E-030 | covering life 50+ years, organic felt | flag `underlayment_outlast_risk` (Ch 3 — Appendix B; skip for Ch 2 work) |
| E-031 | METAL_CORRUGATED, default | SOLID + info flag `metal_corrugated_spaced_allowed_by_local_code` |
| E-032 | BUILT_UP, ½" plywood, 24" spacing (boundary) | PASS, edge support required (tab 22 — 1 clip) |
| E-033 | Asphalt shingle steep slope 10:12, FL | SOLID (strict per rules; underlayment decision deferred to Ch 3) |
| E-034 | Panel thickness = exactly 0.5 with ring shank preference | 8d ring-shank (upgraded size) at 6"/12" |
| E-035 | Panel thickness = 0.5001 | 8d at 6"/12" |
| E-036 | Staple fastening, ½" panel | 16-ga, 3/8 crown, 1.5" long, 4"/8" o.c. |
| E-037 | Staple fastening, 5/8" panel | 16-ga, 3/8 crown, 1.625" long, 2"/5" o.c. |
| E-038 | Slope courses = 0 for gable tile loading | raise `InvalidGeometry` |
| E-039 | Slope courses = 3 for gable tile loading | single stack of 4 at ridge |
| E-040 | HIP roof tile loading | flag `hip_tile_loading_review_needed` (stub ALG-015) |

---

## 11. Definition of Done

The following list must be checkable (`true`/`false`) before this work is considered complete.

### 11.1 Code

- [ ] All enums, dataclasses, constants, and errors (§3–§5) exist in their suggested modules.
- [ ] All 20 algorithms (ALG-001 through ALG-020) are implemented with their exact signatures.
- [ ] Every numeric threshold in Ch. 2 is referenced via a constant from `src/rules/constants.py`. No magic numbers anywhere in the sheathing code path.
- [ ] Every rule function includes a `# per Ch. 2 §2X` source comment.
- [ ] `RateSet` class exists with loader and version-tagging.
- [ ] FL overrides module exists with clear separation.

### 11.2 Tests

- [ ] Each algorithm has a dedicated test file in `tests/ch2/`.
- [ ] All 40 rows of the edge case matrix (§10) are implemented as tests.
- [ ] Boundary-value tests exist for: 10 psf dead load, 4:12 slope, 24" spacing, 2.5" shake spacing, 0.5" panel thickness.
- [ ] `pytest -m ch2` runs all Chapter 2 tests green.
- [ ] Coverage for `src/rules/sheathing/` and `src/estimating/` is ≥ 90%.

### 11.3 Integration

- [ ] End-to-end test: a representative FL asphalt-shingle bid runs from `JobInputs` to `BidOutput` without errors.
- [ ] End-to-end test: a tile upgrade scenario produces the expected frame-load-check flag.
- [ ] JSON serialization round-trip test: `BidOutput → asdict → json → parse → reconstruct` yields structurally equal object.
- [ ] Flutter frontend (if testable in this pass) receives the new fields without crashes.

### 11.4 Documentation

- [ ] Each module has a docstring citing the book sections it implements.
- [ ] `CHANGELOG_CH2.md` is generated listing every file added/modified.
- [ ] The migration report (§13) is produced.

---

## 12. Migration Rules (Existing Code)

**Do not silently replace** existing logic that disagrees with this spec. Instead:

1. Keep the old function callable under its original name.
2. Add the new function with suffix `_v2` or in the new module.
3. Add a deprecation warning to the old function pointing to the new one.
4. Migrate call sites in a follow-up PR, not this one.
5. Log every disagreement between old and new behavior in the migration report.

**Do not change the frontend API contract** without explicit approval. If the new `BidOutput` shape has additional fields, that is additive (safe). If a field is renamed, it requires a frontend-side migration.

---

## 13. Migration Report Format

At the end of the work, Claude Code produces `CH2_MIGRATION_REPORT.md` with:

```markdown
# Chapter 2 Migration Report

## Discovery Findings (§1)
- D-1: <list of existing functions found>
- D-2: <hardcoded numbers replaced with constants>
- D-3: <JobInputs delta vs existing schema>
- D-4: <BidOutput delta vs existing schema>
- D-5: <RateSet existence / plan>
- D-6: <existing tests; kept/modified/removed>
- D-7: <error hierarchy integration>

## Algorithms Implemented
| ID | Module | Status | Tests | Notes |
|---|---|---|---|---|

## Behavior Changes Detected
- <any case where new logic disagrees with old>

## Open Questions for Carlos
- <any ambiguity flagged during implementation>
- <e.g., E-014 truss rafter spacing 19.2" rounding policy>
- <e.g., ALG-015 hip tile loading scaling>

## Known Pending Work
- ALG-015 hip tile loading (stub)
- HVHZ nail-schedule verification (code rider, not in this spec)

## Rate Set Seeding
- Seeded `RateSet` for dev/test with book historical values
- Production RateSet loader: <path>

## Test Summary
- Total: <n>
- Passing: <n>
- Pending: <n>
- Coverage: <pct>
```

---

## End of Spec

Claude Code: when this spec is fully implemented and §11 boxes are all checked, open a pull request titled `feat(ch2): implement sheathing rule set per book Ch. 2 + FL overrides` and attach `CH2_MIGRATION_REPORT.md`.
