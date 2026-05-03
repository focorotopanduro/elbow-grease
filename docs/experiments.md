# A/B Experiment Registry

Every active experiment running on beitbuilding.com, plus the success metric, segmentation strategy, and minimum sample size before declaring a winner.

## How experiments work here

The framework is `src/lib/experiments.ts` — first-party, deterministic, sessionStorage-backed, with URL-param overrides for QA. See its docblock for full architecture.

**Variant assignment:**
- `?variant=<experiment_id>:<variant>` URL param wins (used for screenshots + QA)
- Stored variant from sessionStorage wins next (consistency within session)
- Fresh deterministic hash of `session_id + experiment_id` assigns a variant
- Each fresh assignment fires `cta_click('experiment_assigned', { placement: experiment_id, variant })` once per session

**Success measurement:**
- Use the analytics summary script (`npm run analytics:summary 30d`) once a queryable sink is wired
- Compare conversion rate per variant — the canonical metric is `lead_form_submit_success / page_view` segmented by variant
- Statistical-significance threshold: 95% confidence (chi-squared test)
- **Minimum sample**: 500 page_views per variant before reading the result. Beit's traffic is modest; smaller samples produce noisy conclusions

## Active experiments

### `hero_cta_copy_v1` — Hero CTA + sub copy

**Status:** Live since Tier 4
**Surfaces:** home page Hero
**Hypothesis:** Variant B (urgency framing) and Variant C (specificity framing) produce a higher click-through-to-form rate than Variant A (control: generic excellence positioning).

| Variant | Sub-paragraph | CTA button copy |
| --- | --- | --- |
| **A (control)** | "Orlando's most trusted roofing and construction specialists. Precision craftsmanship, transparent pricing, and a commitment to excellence that speaks for itself." | "Get a Free Quote" |
| **B (urgency)** | "Two state licenses. Bilingual crew. Most free roof inspections scheduled within 48 hours of your call." | "Book Free Inspection — Today" |
| **C (specificity)** | "Free 30-minute on-site inspection with drone documentation. Two active Florida licenses. Bilingual EN/ES crew." | "See My Roof's True Condition" |

**Traffic split:** Even (33/33/33) via deterministic hash.

**Primary metric:** `lead_form_submit_success / page_view` (home page only — city + blog don't render this Hero)

**Secondary metrics:**
- `cta_click(book_quote, hero_primary:<variant>) / page_view` — click-through rate
- `lead_form_start / cta_click(hero_primary)` — engagement-after-click (does the variant attract qualified clicks or curiosity clicks?)

**QA URL:** `https://www.beitbuilding.com/?variant=hero_cta_copy_v1:B` (replace B with C as needed)

**Read after:** 500+ page_views per variant, ~1,500 page_views total to home. At Beit's expected traffic (~3,000 home page_views/month after Tier 2 SEO ramp), expect ~3-4 weeks to reach significance.

**Decision rule:** If B or C beats A by ≥1.5 percentage points in `lead_form_submit_success / page_view` with 95% confidence, ship the winner as the new control. If neither does, keep A and design a new variant pair.

---

## Adding a new experiment

1. Add the experiment to `EXPERIMENTS` in `src/lib/experiments.ts`. Set `id` (kebab-snake-case + version suffix), `variants`, optional `weights`, and a 1-2 sentence `description`.
2. Apply via `useExperiment('your_id')` in the relevant component. Branch on the returned variant string.
3. Tag the variant into any related `track()` / `trackCta()` calls so the funnel can segment by cohort.
4. Add a section to this doc: hypothesis, surfaces, variants table, primary + secondary metrics, QA URL, read-after threshold, decision rule.
5. Spot-check via URL param before launching — `?variant=your_id:variant_name` should force the variant.

## Retiring an experiment

1. Pick the winner. Update the corresponding component to render that variant unconditionally (remove the `useExperiment()` call site).
2. Move this doc's experiment section to a "Concluded experiments" archive heading.
3. Remove the experiment entry from `EXPERIMENTS` after a 30-day grace window (so any visitor mid-session with a stored assignment doesn't see a flicker).

## Concluded experiments

(none yet — `hero_cta_copy_v1` is the first.)
