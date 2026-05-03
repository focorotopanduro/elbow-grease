import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LICENSES,
  DBPR_URL,
  QUALIFIER,
  COMPANY,
  formatLastVerified,
  verifyLicense,
  type License,
} from './dbprData';
import { trackCta } from '../lib/interactions';

interface Props {
  variant?: 'footer' | 'contact' | 'inline';
  heading?: string;
}

export default function TrustInline({ variant = 'inline', heading }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  const verified = useMemo(() => formatLastVerified(), []);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const onVerify = useCallback(
    async (lic: License) => {
      trackCta('verify_license', `trust_inline:${variant}:${lic.number}`)();
      const ok = await verifyLicense(lic);
      if (ok) {
        setCopied(lic.number);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(null), 2200);
      }
    },
    [variant],
  );

  const headerText = heading ?? 'Florida State Licensed';

  return (
    <div
      className={`ti ti--${variant}`}
      data-trust-verify-zone={variant}
      data-trust-licenses={LICENSES.map((lic) => lic.number).join(' ')}
    >
      <div className="ti__head">
        <span className="ti__seal" aria-hidden="true">
          <svg viewBox="0 0 56 56" width="44" height="44">
            <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" strokeWidth="1.2" />
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * Math.PI) / 6;
              const x1 = (28 + Math.cos(a) * 24).toFixed(1);
              const y1 = (28 + Math.sin(a) * 24).toFixed(1);
              const x2 = (28 + Math.cos(a) * (i % 3 === 0 ? 21 : 22)).toFixed(1);
              const y2 = (28 + Math.sin(a) * (i % 3 === 0 ? 21 : 22)).toFixed(1);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={i % 3 === 0 ? 1.2 : 0.6}
                  opacity={i % 3 === 0 ? 1 : 0.55}
                />
              );
            })}
            <circle cx="28" cy="28" r="20" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.55" />
            <path
              d="M28 11 L40 15 L40 26 C 40 33 35 39 28 41 C 21 39 16 33 16 26 L 16 15 Z"
              fill="rgba(107, 29, 29, 0.18)"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M22 26 L26 30 L34 21"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="ti__head-text">
          <h4 className="ti__title">{headerText}</h4>
          <p className="ti__sub">
            <strong>{COMPANY}</strong>
            <br />Qualifier: {QUALIFIER}
          </p>
        </div>
      </div>

      <ul className="ti__licenses">
        {LICENSES.map((lic) => (
          <li key={lic.number}>
            <button
              type="button"
              className={`ti__license ${copied === lic.number ? 'is-copied' : ''}`}
              onClick={() => onVerify(lic)}
              aria-label={`Copy ${lic.number} and open Florida DBPR verification`}
              title={`Copy ${lic.number} and open Florida DBPR public verification`}
            >
              <span className="ti__license-row">
                <span className="ti__license-number">{lic.number}</span>
                <span className="ti__license-action">
                  {copied === lic.number ? 'Opened on DBPR' : 'Verify on DBPR ->'}
                </span>
              </span>
              <span className="ti__license-type">{lic.type}</span>
              <span className="ti__license-scope">{lic.scope}</span>
              <span className="ti__license-meta">
                <span className="ti__active-dot" aria-hidden="true" />
                {lic.status} through {lic.expires}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="ti__foot">
        <p className="ti__foot-line">
          <span className="ti__active-dot" aria-hidden="true" />
          Last verified: <strong>{verified.relative}</strong>
          <span aria-hidden="true">-</span>
          <a
            href={DBPR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ti__direct-link"
            data-cta-source={`trust_inline_${variant}_dbpr_direct`}
            onClick={trackCta('open_dbpr_lookup', `trust_inline:${variant}:direct`)}
          >
            myfloridalicense.com
          </a>
        </p>
        <p className="ti__hint">
          <span className="ti__hint-key">Tip</span>
          Set <em>License Category</em> to{' '}
          <strong>Construction Industry</strong> on DBPR, or just paste the number alone.
        </p>
      </div>
    </div>
  );
}
