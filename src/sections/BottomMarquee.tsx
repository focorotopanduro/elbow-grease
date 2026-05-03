import './Banner.css';

const ITEMS = [
  'Roofing Specialists',
  'General Construction',
  'Deck & Fence Installation',
  'Painting & Siding',
  'DBPR Licensed',
  'Free Estimates',
  'Orlando FL',
  'Storm Damage Repair',
];

export default function BottomMarquee() {
  const reel = Array.from({ length: 4 }, () => ITEMS).flat();
  return (
    <div className="marquee marquee--bottom" role="region" aria-label="Service highlights">
      <div className="marquee__track">
        {reel.map((text, i) => (
          <span key={i} className="marquee__item">
            <span className="marquee__dot" aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
      <div className="marquee__track marquee__track--clone" aria-hidden="true">
        {reel.map((text, i) => (
          <span key={i} className="marquee__item">
            <span className="marquee__dot" aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
