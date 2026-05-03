import './TrustSeal.css';

/**
 * Floating circular trust seal — rotating outer text + static center mark.
 * Sits in the hero corner. Pure SVG so it scales crisply.
 */
export default function TrustSeal() {
  return (
    <div className="seal" aria-label="Florida DBPR licensed contractor">
      <svg className="seal__svg" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <path
            id="seal-circle"
            d="M 100, 100 m -78, 0 a 78,78 0 1,1 156,0 a 78,78 0 1,1 -156,0"
          />
        </defs>

        <text className="seal__text">
          <textPath href="#seal-circle" startOffset="0%">
            FLORIDA DBPR LICENSED &middot; VERIFIED TODAY &middot; FREE ESTIMATES &middot;&nbsp;
          </textPath>
        </text>

        <circle cx="100" cy="100" r="56" className="seal__inner" />
        <text x="100" y="92" className="seal__label seal__label--top">DBPR</text>
        <text x="100" y="116" className="seal__label seal__label--num">CCC</text>
        <text x="100" y="138" className="seal__label seal__label--bottom">ORLANDO &middot; FL</text>
      </svg>
    </div>
  );
}
