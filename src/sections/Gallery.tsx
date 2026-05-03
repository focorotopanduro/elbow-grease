import './Gallery.css';

const ITEMS = [
  { src: '/images/house-2.jpg', alt: 'Beautiful home roofing project by Beit Building Contractors', size: 'wide' },
  { src: '/images/house-3.jpg', alt: 'Custom construction project completed in Orlando', size: 'tall' },
  { src: '/images/house-4.jpg', alt: 'Beautiful deck and outdoor space by Beit Building', size: 'std' },
  { src: '/images/house-5.jpg', alt: 'Exterior painting and siding restoration', size: 'std' },
  { src: '/images/house-1.jpg', alt: 'Premium roofing installation Orlando', size: 'wide' },
];

export default function Gallery() {
  return (
    <section className="gallery section" aria-label="Recent project gallery">
      <div className="container">
        <header className="gallery__header reveal">
          <p className="eyebrow">Recent Work</p>
          <h2 className="gallery__title">
            Craft You Can <em>See.</em>
          </h2>
          <p className="gallery__lead">
            A selection of recent residential and commercial projects across Central Florida.
          </p>
        </header>

        <div className="gallery-row">
          {ITEMS.map((it) => (
            <figure
              key={it.src}
              className={`gallery__item gallery__item--${it.size} img-zoom reveal`}
            >
              <img src={it.src} alt={it.alt} loading="lazy" />
            </figure>
          ))}

          <figure className="gallery__item gallery__item--video img-zoom reveal">
            <video
              src="/videos/work-1.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/images/house-2.jpg"
              aria-label="Beit Building Contractors recent work timelapse"
            />
            <span className="gallery__live">
              <span className="gallery__live-dot" aria-hidden="true" /> On site
            </span>
          </figure>
        </div>
      </div>
    </section>
  );
}
