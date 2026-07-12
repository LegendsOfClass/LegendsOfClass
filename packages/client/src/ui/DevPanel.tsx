/**
 * Rule 6 — Developer Panel.
 * Rendered ONLY in dev builds (import.meta.env.DEV guard in App.tsx) and the server
 * additionally refuses /dev/* unless DEV_MODE=true. Release builds tree-shake this UI out.
 */
import { useEffect, useState } from 'react';
import { api } from '../net/api';
import { t } from '../i18n';
import { refreshProfile } from '../state/store';
import { EventBus } from '../EventBus';
import { JOBS, MAPS } from '@loce/shared';

export function DevPanel({ onClose, showErr }: { onClose: () => void; showErr: (e: unknown) => void }) {
  const [exp, setExp] = useState(1000);
  const [gold, setGold] = useState(10000);
  const [god, setGod] = useState(false);
  const [monsters, setMonsters] = useState<string[]>([]);

  useEffect(() => { api<{ monsters: string[] }>('/dev/monsters').then(r => setMonsters(r.monsters)).catch(() => {}); }, []);

  async function run(path: string, body: unknown, after?: () => void) {
    try { await api(path, body); await refreshProfile(); after?.(); } catch (e) { showErr(e); }
  }

  return (
    <div className="panel center">
      <h3>🛠 {t('ui.dev.title')}</h3>
      <div className="row">
        <input type="number" value={exp} onChange={e => setExp(+e.target.value)} style={{ width: 110 }} />
        <button className="small" onClick={() => run('/dev/give-exp', { amount: exp })}>{t('ui.dev.giveExp')}</button>
      </div>
      <div className="row">
        <input type="number" value={gold} onChange={e => setGold(+e.target.value)} style={{ width: 110 }} />
        <button className="small" onClick={() => run('/dev/give-gold', { amount: gold })}>{t('ui.dev.giveGold')}</button>
      </div>
      <div className="row"><span>{t('ui.dev.unlockJob')}</span><span>
        {Object.keys(JOBS).map(j => <button className="small" key={j} onClick={() => run('/dev/unlock-job', { jobId: j })}>{j}</button>)}
      </span></div>
      <div className="row"><span>{t('ui.dev.teleport')}</span><span>
        {Object.keys(MAPS).map(m => <button className="small" key={m}
          onClick={() => run('/dev/teleport', { mapId: m }, () => EventBus.emit('goto-map', m))}>{m}</button>)}
      </span></div>
      <div className="row"><span>{t('ui.dev.spawn')}</span><span>
        {monsters.map(m => {
          const node = Object.values(MAPS).flatMap(mp => mp.nodes).find(n => n.monsterId === m);
          return node && <button className="small" key={m} onClick={() => EventBus.emit('request-battle', node.id)}>{m}</button>;
        })}
      </span></div>
      <div className="row"><span>{t('ui.dev.god')}</span>
        <button className="small" style={{ background: god ? '#2a7a2a' : undefined }}
          onClick={() => run('/dev/god', { on: !god }, () => setGod(!god))}>{god ? 'ON' : 'OFF'}</button>
      </div>
      <div className="row"><span>{t('ui.dev.reset')}</span>
        <button className="small" style={{ background: '#7a2a2a' }}
          onClick={() => run('/dev/reset', {}, () => { EventBus.emit('goto-map', 'town'); })}>RESET</button>
      </div>
      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}
