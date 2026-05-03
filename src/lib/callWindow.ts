/**
 * Returns a human-readable promise of when Beit Building will call
 * the lead back, based on the current local time + day of week.
 *
 * Office hours assumption: Mon-Fri 8am-6pm, Saturday 9am-2pm,
 * Sunday closed. The promise text is concrete enough to feel
 * specific ("by tomorrow morning") without being a hard SLA.
 *
 * Why this matters: research shows lead-form conversion improves
 * measurably when the success page tells the user EXACTLY when to
 * expect contact, instead of "within one business day". Cuts the
 * "did they get my submission?" anxiety.
 */
export function getCallWindowText(now = new Date()): string {
  const day = now.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const hour = now.getHours();

  // Sunday — next call is Monday morning
  if (day === 0) return 'first thing Monday morning';

  // Saturday after office closes (2pm)
  if (day === 6 && hour >= 14) return 'first thing Monday morning';

  // Saturday during office hours
  if (day === 6) return 'before we close at 2pm today';

  // Mon-Fri after hours (after 6pm) → next morning unless it's
  // Friday → next call is Monday
  if (hour >= 18) {
    if (day === 5) return 'first thing Monday morning';
    return 'first thing tomorrow morning';
  }

  // Mon-Fri before office opens (before 8am)
  if (hour < 8) return 'as soon as we open at 8am';

  // Mon-Fri during office hours, before 2pm — same-day call likely
  if (hour < 14) return 'within the next few hours, today';

  // Mon-Fri 2pm–6pm → end of day or first thing tomorrow
  if (day === 5) return 'before close today, or first thing Monday';
  return 'before close today, or first thing tomorrow';
}
