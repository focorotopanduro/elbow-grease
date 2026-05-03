import './About.css';

const PILLARS = [
  {
    n: '01',
    title: 'License Before Flash',
    body: 'The proof starts with active Florida credentials, then moves into the work. Trust should be verifiable before it becomes emotional.',
  },
  {
    n: '02',
    title: 'Water-Path Thinking',
    body: 'Roofing, siding, fascia, and finish decisions are read as one exterior system, especially after Florida rain exposes weak points.',
  },
  {
    n: '03',
    title: 'Plain Scope Notes',
    body: 'The estimate should make the next move obvious: what matters now, what is optional, and what should be documented.',
  },
  {
    n: '04',
    title: 'Clean Closeout',
    body: 'The job ends with cleanup, walkthrough, and enough context for the owner to understand what changed.',
  },
];

export default function About() {
  return (
    <section id="about" className="about section">
      <div className="container">
        <div className="about__grid">
          <header className="about__head reveal">
            <p className="eyebrow">Operating Standard</p>
            <h2 className="about__title">
              Less sales theater. <em>More site judgment.</em>
            </h2>
          </header>

          <div className="about__body reveal reveal--from-right">
            <p className="about__lead">
              Beit Building works best for owners who want the project looked at
              like a real property problem, not a prewritten package.
            </p>
            <p className="about__support">
              The crew reads the roof, shell, access, weather, finish conditions,
              and cleanup path before turning the work into a scope you can act on.
            </p>
            <a href="#contact" className="about__link">
              Request a free estimate <span aria-hidden="true">-&gt;</span>
            </a>
          </div>
        </div>

        <ul className="about__pillars">
          {PILLARS.map((p) => (
            <li key={p.title} className="pillar reveal">
              <span className="pillar__n">{p.n}</span>
              <div className="pillar__line" aria-hidden="true" />
              <h3 className="pillar__title">{p.title}</h3>
              <p className="pillar__body">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
