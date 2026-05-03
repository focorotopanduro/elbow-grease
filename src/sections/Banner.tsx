import './Banner.css';

export default function Banner() {
  return (
    <div className="topbar" role="region" aria-label="Service announcement">
      <div className="topbar__inner container">
        <span className="topbar__status">
          <span className="topbar__dot" aria-hidden="true" />
          Free estimates available
        </span>
        <span className="topbar__message">
          Licensed roofing and construction across Orlando and Central Florida
        </span>
        <a className="topbar__link" href="tel:+14079426459">
          Call (407) 942-6459
        </a>
      </div>
    </div>
  );
}
