import { INSTALL_PROFILES, type InstallProfileId } from '../../physics/resistance';

interface Props {
  value: InstallProfileId;
  onChange: (id: InstallProfileId) => void;
}

const ORDER: InstallProfileId[] = ['code_min', 'fbc_wbdr'];

export default function InstallToggle({ value, onChange }: Props) {
  return (
    <fieldset className="it">
      <legend className="it__legend">Roof install profile</legend>
      <div className="it__options" role="radiogroup">
        {ORDER.map((id) => {
          const p = INSTALL_PROFILES[id];
          const active = value === id;
          return (
            <label
              key={id}
              className={`it__opt ${active ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="install-profile"
                value={id}
                checked={active}
                onChange={() => onChange(id)}
              />
              <span className="it__era">{p.era}</span>
              <span className="it__name">{p.label}</span>
              <ul className="it__specs">
                <li>
                  <span>Shingles</span>
                  <strong>Class {p.shingleClassId}</strong>
                </li>
                <li>
                  <span>Deck nails</span>
                  <strong>{p.fastenerId.replace('_', ' ')}</strong>
                </li>
                <li>
                  <span>Pattern</span>
                  <strong>{p.patternId.replace('_', '/')}</strong>
                </li>
                <li>
                  <span>SWB</span>
                  <strong>{p.hasSWB ? 'Yes' : 'No'}</strong>
                </li>
              </ul>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
