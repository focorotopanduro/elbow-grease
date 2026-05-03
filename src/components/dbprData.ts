/**
 * Shared DBPR licensing data + clipboard helper.
 *
 * Single source of truth for both `<TrustBadge>` (floating top-right pill)
 * and `<TrustInline>` (in-flow horizontal block in Footer / Contact). Edit
 * one number here → propagates everywhere.
 */

export interface License {
  number: string;
  type: string;
  scope: string;
  /** mm/dd/yyyy expiration on the DBPR public record */
  expires: string;
  /** Status word ("Current, Active") — shown as a green pulsing dot */
  status: string;
  /** DBA (organization) name as it appears on the DBPR record */
  dbaName: string;
  /** Primary qualifier name as it appears on the DBPR record */
  primaryName: string;
  /** Main address as it appears on the DBPR record */
  address: string;
}

/**
 * Verified license records — observed directly on the official Florida
 * DBPR public-licensee-search portal (myfloridalicense.com). Updated
 * manually whenever the site owner re-confirms or renews.
 *
 * NOTE: we couldn't auto-prefetch from DBPR at build time — Cloudflare's
 * bot management (the `__cf_bm` cookie) blocks server-side requests with
 * a generic "cannot be processed" page. See scripts/verify-licenses.mjs
 * for the failed approaches + future-fix paths.
 *
 * All fields below match what visitors see when they click "Verify on
 * DBPR" — visitors can confirm the data themselves with one click.
 */
export const LICENSES: License[] = [
  {
    number: 'CCC1337413',
    type: 'Certified Roofing Contractor',
    scope: 'Roof systems · reroofing · FBC §1518',
    expires: '08/31/2026',
    status: 'Current, Active',
    dbaName: 'BEIT BUILDING CONTRACTORS LLC',
    primaryName: 'VASQUEZ, SANDRA CAROLINE',
    address: '2703 Dobbin Drive, Orlando, FL 32817',
  },
  {
    number: 'CGC1534077',
    type: 'Certified General Contractor',
    scope: 'Whole-structure new build & renovation',
    expires: '08/31/2026',
    status: 'Current, Active',
    dbaName: 'BEIT BUILDING CONTRACTORS LLC',
    primaryName: 'VASQUEZ, SANDRA CAROLINE',
    address: '2703 Dobbin Drive, Orlando, FL 32817',
  },
];

/**
 * Last date the site owner re-confirmed all licenses against the live
 * DBPR portal. Update this string when you re-verify (yyyy-mm-dd).
 * Shown to visitors as "Last verified [date]" so they know the cache age.
 */
export const LAST_VERIFIED = '2026-04-30';

export function formatLastVerified(now: Date = new Date()): { relative: string; absolute: string } {
  const verified = new Date(LAST_VERIFIED + 'T12:00:00Z');
  const days = Math.floor((now.getTime() - verified.getTime()) / 86_400_000);
  const [yyyy, mm, dd] = LAST_VERIFIED.split('-');
  const absolute = `${mm}/${dd}/${yyyy}`;
  let relative: string;
  if (days <= 0) relative = 'today';
  else if (days === 1) relative = 'yesterday';
  else if (days < 7) relative = `${days} days ago`;
  else if (days < 14) relative = '1 week ago';
  else if (days < 30) relative = `${Math.floor(days / 7)} weeks ago`;
  else if (days < 60) relative = '1 month ago';
  else if (days < 365) relative = `${Math.floor(days / 30)} months ago`;
  else relative = `${Math.floor(days / 365)}+ years ago`;
  return { relative, absolute };
}

/**
 * DBPR public-license search portal — direct link to the License Number
 * entry form (the page with the actual `LicNbr` text input).
 *
 * Routing inside DBPR's wl11.asp:
 *   mode=0                → search-type radio buttons (Name/LicNbr/etc.)
 *   mode=1&search=LicNbr  → ✅ the License Number entry form (what we want)
 *   mode=2                → results page action handler (empty without a
 *                            submitted form → returns "no records found")
 *
 * Visitors land on the entry form with all category/type filters cleared,
 * paste the license number we just copied to clipboard, click Search,
 * and see the live state record.
 */
export const DBPR_URL =
  'https://www.myfloridalicense.com/wl11.asp?mode=1&search=LicNbr';
export const QUALIFIER = 'Sandra Caroline Vasquez';
export const COMPANY = 'Beit Building Contractors LLC';
export const ADDRESS = '2703 Dobbin Dr · Orlando, FL 32817';

/** Robust clipboard copy with fallback for HTTP / old browsers. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Verify on DBPR" action — copies the license number to clipboard AND
 * opens the official Florida DBPR public-licensee-search page in a new tab.
 *
 * NOTE on auto-submit:
 *   We tested programmatically POSTing the search form from JS. DBPR's
 *   wl11.asp rejects cross-origin POSTs without a server-established
 *   session cookie ("request cannot be processed at this time"). True
 *   one-click verification requires a server-side proxy or build-time
 *   data prefetch. See the comment block at the bottom of this file
 *   for those options.
 *
 * Returns whether the clipboard copy succeeded so the caller can show
 * an appropriate confirmation.
 */
/** Custom DOM event emitted whenever a license is verified — drives the
 *  global VerifyToast so a paste-reminder toast shows on our page after
 *  the visitor opens the DBPR tab. */
export const VERIFY_EVENT = 'beit:verify-license-clicked';
export interface VerifyEventDetail {
  licenseNumber: string;
  copied: boolean;
}

export async function verifyLicense(license: License): Promise<boolean> {
  const ok = await copyToClipboard(license.number);
  window.open(DBPR_URL, '_blank', 'noopener,noreferrer');
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent<VerifyEventDetail>(VERIFY_EVENT, {
        detail: { licenseNumber: license.number, copied: ok },
      }),
    );
  }
  return ok;
}

/* ─────────────────────────────────────────────────────────────────────────
 * TRUE ZERO-FRICTION VERIFICATION — future options
 *
 * Option A: Build-time prefetch (no backend needed)
 *   - Add a Node script to scripts/verify-licenses.mjs that:
 *     1. Hits DBPR with cookie jar (preserves session)
 *     2. Parses the HTML to extract status + expiration + name + address
 *     3. Writes src/data/dbpr-cache.json
 *   - Wire to package.json: "prebuild": "node scripts/verify-licenses.mjs"
 *   - Frontend imports the JSON, displays inline ("✓ Verified active on
 *     DBPR · Last verified MM/DD/YYYY · Active through 08/31/2026")
 *   - Visitors see authoritative data immediately, no DBPR redirect
 *   - Stays accurate as long as we rebuild + redeploy when licenses renew
 *
 * Option B: Server-side proxy (Cloudflare Worker / Vercel Function)
 *   - On verify click, frontend calls /api/verify/CCC1337413
 *   - Worker hits DBPR server-side (no CORS), parses, returns JSON
 *   - Frontend renders verified data in an inline modal
 *   - Always-fresh, but requires backend deployment + maintenance
 *
 * Option C: Iframe-prime + form-POST trick (UNRELIABLE)
 *   - Hidden iframe loads DBPR mode=2 to set session cookie
 *   - After iframe load, submit form POST in new tab with cookie included
 *   - Modern browsers' third-party cookie blocking (Safari ITP, Chrome 2024+)
 *     defeats this in a growing share of sessions
 *   - NOT RECOMMENDED — the failure mode is silent + confusing
 * ───────────────────────────────────────────────────────────────────────── */
