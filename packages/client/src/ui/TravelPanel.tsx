import { t } from '../i18n';
import { getProfile } from '../state/store';
import { MAPS, MONSTERS } from '@loce/shared';

/** World Map warp (D-027): button-based travel replaces walk-into-gate hotspots. */
export function TravelPanel({ onClose, onTravel }: { onClose: () => void; onTravel: (mapId: string) => void }) {
  const current = getProfile()?.state.current_map;

  const levelRange = (mapId: string): string => {
    const levels = Object.values(MONSTERS).filter(m => m.map === mapId).map(m => m.level);
    if (!levels.length) return '';
    return `${t('ui.travel.lv')}.${Math.min(...levels)}–${Math.max(...levels)}`;
  };

  return (
    <div className="panel center" style={{ maxWidth: 340 }}>
      <h3>🗺 {t('ui.travel.title')}</h3>
      {Object.values(MAPS).map(m => {
        const here = m.id === current;
        return (
          <div className="row" key={m.id} style={{
            alignItems: 'center', padding: '8px 10px', borderRadius: 8, marginBottom: 6,
            background: here ? 'rgba(109,224,138,.12)' : 'rgba(0,0,0,.25)',
            border: here ? '1px solid #4c9e64' : '1px solid #3a4664',
          }}>
            <span style={{ textAlign: 'left' }}>
              {m.kind === 'town' ? '🏘' : '🌲'} <b>{t(m.nameKey)}</b>
              <div style={{ fontSize: 11, opacity: .7 }}>
                {m.kind === 'town' ? t('ui.travel.town.desc') : levelRange(m.id)}
              </div>
            </span>
            {here
              ? <span style={{ fontSize: 12, color: '#8de29a' }}>📍 {t('ui.travel.here')}</span>
              : <button className="small" onClick={() => onTravel(m.id)}>{t('ui.travel.go')}</button>}
          </div>
        );
      })}
      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}
