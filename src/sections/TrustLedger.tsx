import {
  LICENSES,
  formatLastVerified,
  verifyLicense,
  type License,
} from '../components/dbprData';
import { trackCta } from '../lib/interactions';
import './TrustLedger.css';

const LEDGER_ITEMS = [
  {
    label: '01',
    kicker: 'Public Source',
    title: 'DBPR records',
    body: 'Click either license to copy the number and open Florida\'s public license lookup.',
  },
  {
    label: '02',
    kicker: 'Scope Control',
    title: 'Written path',
    body: 'Repair, replacement, optional work, and safe-to-wait items should be separated before approval.',
  },
  {
    label: '03',
    kicker: 'Field Clarity',
    title: 'EN/ES follow-up',
    body: 'Bilingual communication helps the household and field crew stay aligned before work begins.',
  },
] as const;

const TRUST_ROUTE = ['Verify license', 'Define scope', 'Approve next step'] as const;

export default function TrustLedger() {
  const verified = formatLastVerified();

  const handleVerify = (license: License) => {
    trackCta('verify_license', `trust_ledger:${license.number}`)();
    void verifyLicense(license);
  };

  return (
    <section className="trust-ledger" aria-label="Trust and process summary">
      <div className="container trust-ledger__inner">
        <header className="trust-ledger__head reveal">
          <p className="eyebrow">Trust Ledger</p>
          <h2>
            Minimal claims. <em>Maximum proof.</em>
          </h2>
          <p>
            Before you invite a contractor onto the property, the essentials
            should be easy to confirm: state license status, written scope,
            and a clear next step.
          </p>
          <ol className="trust-ledger__route" aria-label="Verification path">
            {TRUST_ROUTE.map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {step}
              </li>
            ))}
          </ol>
        </header>

        <div className="trust-ledger__panel reveal reveal--from-right">
          <div className="trust-ledger__source">
            <span>Official Lookup</span>
            <strong>Florida DBPR public license search</strong>
            <p>License numbers copy before the state portal opens, so the record is easier to confirm.</p>
          </div>

          <div className="trust-ledger__licenses" aria-label="DBPR license records">
            {LICENSES.map((license) => (
              <button
                key={license.number}
                type="button"
                className="trust-ledger__license"
                data-cta-source={`trust_ledger_${license.number}`}
                onClick={() => handleVerify(license)}
                aria-label={`Copy ${license.number} and open Florida DBPR verification`}
              >
                <span>{license.number}</span>
                <strong>{license.type}</strong>
                <em>{license.status} through {license.expires}</em>
                <small>Copy + open DBPR -&gt;</small>
              </button>
            ))}
          </div>

          <ul className="trust-ledger__items">
            {LEDGER_ITEMS.map((item) => (
              <li key={item.title}>
                <span>{item.label}</span>
                <small>{item.kicker}</small>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>

          <div className="trust-ledger__foot">
            <span className="trust-ledger__pulse" aria-hidden="true" />
            Last verified: {verified.relative}
          </div>
        </div>
      </div>
    </section>
  );
}
