import type { CascadeResult } from '../../physics/cascade';
import type { InstallProfile } from '../../physics/resistance';

interface Props {
  cascade: CascadeResult;
  profile: InstallProfile;
  /** URL or hash to route the inspection CTA to */
  ctaHref?: string;
}

export default function CTASection({ cascade, profile, ctaHref = '/#contact' }: Props) {
  const isOlder = profile.id === 'code_min';
  const isAtRisk =
    isOlder && cascade.windSpeed > 100 && cascade.highestStageReached;

  return (
    <aside className="ct">
      {isAtRisk && (
        <div className="ct__alert">
          <p className="ct__alert-eyebrow">FBC 708.7 trigger</p>
          <p className="ct__alert-title">
            Most pre-2002 Orlando homes still have the original construction.
          </p>
          <p className="ct__alert-body">
            FBC 708.7 requires sheathing reattachment and a secondary water
            barrier whenever you reroof. If your roof has not been replaced
            since 2002, your deck is likely still attached with 6d smooth box
            nails — the same fasteners that failed across Central Florida
            during Charley.
          </p>
        </div>
      )}

      <div className="ct__main">
        <p className="ct__eyebrow">Free inspection</p>
        <h3 className="ct__title">
          Find out exactly what's holding your roof down.
        </h3>
        <p className="ct__lead">
          A Beit Building Contractors inspector will measure your shingle
          class, confirm the fastener type used on your sheathing, and tell
          you whether your roof meets the current FBC standard. 30 minutes,
          no obligation.
        </p>
        <div className="ct__row">
          <a
            href={`${ctaHref}?utm_source=visualizer&utm_medium=tool&utm_campaign=wind_uplift`}
            className="btn btn--primary ct__btn"
          >
            Schedule free inspection <span aria-hidden="true">→</span>
          </a>
          <a href="tel:+14079426459" className="ct__phone">
            or call <strong>(407) 942-6459</strong>
          </a>
        </div>
      </div>

      <p className="ct__legal">
        This tool is educational. Specific damage predictions about any
        individual structure require evaluation by a Florida-licensed
        Professional Engineer (PE). License: <strong>CGC&nbsp;_______</strong>
      </p>
    </aside>
  );
}
