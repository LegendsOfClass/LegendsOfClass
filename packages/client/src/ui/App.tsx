import { useEffect, useState, useCallback } from 'react';
import { EventBus } from '../EventBus';
import { api, setToken, hasToken } from '../net/api';
import { t, setLang, getLang } from '../i18n';
import {
  refreshProfile, clearProfile, getProfile, activeJob, derivedForActive, expProgress, primaryStats,
  type Profile, type ItemRow,
} from '../state/store';
import { JOBS, ITEMS, GAME, type BattleResponse } from '@loce/shared';
import { DevPanel } from './DevPanel';

type PanelId = 'none' | 'jobs' | 'character' | 'bag' | 'dev' | 'loot';

export function App() {
  const [, force] = useState(0);
  const rerender = useCallback(() => force(n => n + 1), []);
  const [logged, setLogged] = useState(false);
  const [panel, setPanel] = useState<PanelId>('none');
  const [loot, setLoot] = useState<BattleResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ---- boot: token → profile → enter world ----
  useEffect(() => {
    const offs = [
      EventBus.on('profile', rerender),
      EventBus.on('open-panel', (p: PanelId) => setPanel(p)),
      EventBus.on('request-travel', (mapId: string) => travel(mapId)),
      EventBus.on('request-battle', (nodeId: string) => battle(nodeId)),
      EventBus.on('battle-finished', (resp: BattleResponse) => onBattleFinished(resp)),
    ];
    if (hasToken()) enterWorld().catch(() => { setToken(null); });
    return () => offs.forEach(off => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterWorld() {
    const p = await refreshProfile();
    (window as unknown as { __activeJob?: string }).__activeJob = p.state.current_job_id;
    setLogged(true);
    EventBus.emit('goto-map', p.state.current_map);
  }

  async function travel(mapId: string) {
    try {
      await api('/travel', { mapId });
      await refreshProfile();
      EventBus.emit('goto-map', mapId);
    } catch (e) { showErr(e); }
  }

  async function battle(nodeId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const resp = await api<BattleResponse>('/battle/start', { nodeId });
      EventBus.emit('start-battle-replay', resp);
    } catch (e) { showErr(e); }
    finally { setBusy(false); }
  }

  async function onBattleFinished(resp: BattleResponse) {
    await refreshProfile();
    setLoot(resp);
    setPanel('loot');
    if (resp.outcome !== 'victory') {
      // defeat → back to town (docs/01-combat: defeat returns you to town, M1 no revive scroll yet)
      await travel('town');
    } else {
      EventBus.emit('goto-map', getProfile()?.state.current_map ?? 'grassland');
    }
  }

  function showErr(e: unknown) {
    const key = (e as { messageKey?: string }).messageKey ?? 'error.network';
    setErr(t(key));
    setTimeout(() => setErr(''), 3500);
  }

  const profile = getProfile();

  if (!logged) return <Login onDone={() => enterWorld().catch(showErr)} showErr={showErr} err={err} />;

  const job = activeJob();
  const exp = expProgress();

  return (
    <>
      {/* ---- Top bar ---- */}
      <div className="topbar">
        <div>
          <b>{profile?.account.display_name}</b>{' · '}
          {t(JOBS[job?.job_id ?? 'novice'].nameKey)} Lv.{job?.level}
          <span style={{ marginLeft: 10, color: '#9fd' }}>
            EXP {exp.cur}/{exp.next}
          </span>
        </div>
        <div>
          🪙 {profile?.state.gold ?? 0} · 💎 {profile?.state.diamond ?? 0}
          <button className="small" style={{ marginLeft: 10 }} onClick={() => { setLang(getLang() === 'th' ? 'en' : 'th'); rerender(); }}>{t('ui.common.lang')}</button>
          <button className="small" onClick={() => { setToken(null); clearProfile(); location.reload(); }}>{t('ui.common.logout')}</button>
        </div>
      </div>

      {/* ---- Bottom HUD ---- */}
      <div className="hud">
        <button onClick={() => setPanel('character')}>{t('ui.hud.character')}</button>
        <button onClick={() => setPanel('bag')}>{t('ui.hud.bag')}</button>
        <button onClick={() => setPanel('jobs')}>{t('ui.hud.jobs')}</button>
        {profile?.state.current_map !== 'town' &&
          <button onClick={() => travel('town')}>{t('ui.field.return')}</button>}
        {import.meta.env.DEV && <button style={{ background: '#7a3a3a' }} onClick={() => setPanel('dev')}>{t('ui.hud.dev')}</button>}
      </div>

      {err && <div className="panel" style={{ top: 60, left: '50%', transform: 'translateX(-50%)' }}><span className="err">{err}</span></div>}

      {panel === 'character' && <CharacterPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'bag' && <BagPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'jobs' && <JobsPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'dev' && import.meta.env.DEV && <DevPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'loot' && loot && <LootPanel resp={loot} onClose={() => setPanel('none')} onRepeat={() => { setPanel('none'); }} />}
    </>
  );
}

/* ================= Login ================= */
function Login({ onDone, showErr, err }: { onDone: () => void; showErr: (e: unknown) => void; err: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const body = mode === 'login' ? { username: u, password: p } : { username: u, password: p, displayName: d };
      const r = await api<{ token: string }>(`/auth/${mode}`, body);
      setToken(r.token);
      onDone();
    } catch (e) { showErr(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel center">
      <h3>{t('ui.login.title')}</h3>
      <input placeholder={t('ui.login.username')} value={u} onChange={e => setU(e.target.value)} />
      <input placeholder={t('ui.login.password')} type="password" value={p} onChange={e => setP(e.target.value)} />
      {mode === 'register' && <input placeholder={t('ui.login.display')} value={d} onChange={e => setD(e.target.value)} />}
      {err && <div className="err">{err}</div>}
      <button disabled={busy} onClick={submit}>{t(mode === 'login' ? 'ui.login.login' : 'ui.login.register')}</button>
      <button className="small" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {t(mode === 'login' ? 'ui.login.toRegister' : 'ui.login.toLogin')}
      </button>
      <button className="small" onClick={() => { setLang(getLang() === 'th' ? 'en' : 'th'); setMode(m => m); setU(x => x); }}>{t('ui.common.lang')}</button>
    </div>
  );
}

/* ================= Character ================= */
function CharacterPanel({ onClose, showErr }: { onClose: () => void; showErr: (e: unknown) => void }) {
  const job = activeJob();
  const [alloc, setAlloc] = useState({ str: 0, dex: 0, con: 0, int: 0 });
  const [, force] = useState(0);
  if (!job) return null;
  const d = derivedForActive()!;
  const prim = primaryStats(job);
  const spent = alloc.str + alloc.dex + alloc.con + alloc.int;
  const left = job.unspent_points - spent;

  async function apply() {
    try {
      await api('/jobs/allocate', alloc);
      await refreshProfile();
      setAlloc({ str: 0, dex: 0, con: 0, int: 0 });
      force(n => n + 1);
    } catch (e) { showErr(e); }
  }

  const StatRow = ({ k }: { k: 'str' | 'dex' | 'con' | 'int' }) => (
    <div className="row">
      <span>{t(`stat.${k}`)}: <b>{prim[k] + alloc[k]}</b></span>
      <span>
        <button className="small" disabled={alloc[k] <= 0} onClick={() => setAlloc(a => ({ ...a, [k]: a[k] - 1 }))}>-</button>
        <button className="small" disabled={left <= 0} onClick={() => setAlloc(a => ({ ...a, [k]: a[k] + 1 }))}>+</button>
      </span>
    </div>
  );

  return (
    <div className="panel center">
      <h3>{t('ui.char.stats')} — {t(JOBS[job.job_id].nameKey)} Lv.{job.level}</h3>
      <div className="row"><span>{t('ui.char.points')}</span><b>{left}</b></div>
      <StatRow k="str" /><StatRow k="dex" /><StatRow k="con" /><StatRow k="int" />
      <div style={{ margin: '10px 0', fontSize: 13, lineHeight: 1.8 }}>
        {t('ui.char.hp')}: {d.maxHp} · {t('ui.char.patk')}: {d.patk} · {t('ui.char.matk')}: {d.matk} · {t('ui.char.def')}: {d.def}<br />
        {t('ui.char.spd')}: {d.spd} · {t('ui.char.crit')}: {d.critRate.toFixed(1)}% · {t('ui.char.hit')}: {d.hit} · {t('ui.char.flee')}: {d.flee}
      </div>
      <button disabled={spent === 0} onClick={apply}>{t('ui.char.apply')}</button>
      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}

/* ================= Bag ================= */
function BagPanel({ onClose, showErr }: { onClose: () => void; showErr: (e: unknown) => void }) {
  const items = getProfile()?.items ?? [];
  async function equip(it: ItemRow) {
    try { await api('/items/equip', { itemDbId: it.id }); await refreshProfile(); } catch (e) { showErr(e); }
  }
  async function unequip(it: ItemRow) {
    try { await api('/items/unequip', { slot: it.equipped_slot }); await refreshProfile(); } catch (e) { showErr(e); }
  }
  return (
    <div className="panel center">
      <h3>{t('ui.bag.title')}</h3>
      {items.length === 0 && <div style={{ opacity: .7 }}>—</div>}
      {items.map(it => (
        <div className="row" key={it.id}>
          <span className={`rarity-${it.rarity}`}>
            {t(ITEMS[it.item_id]?.nameKey ?? it.item_id)} <small>[{it.rarity}]</small>
            {it.equipped_slot && <b> ✓ {t('ui.bag.equipped')}</b>}
          </span>
          {it.equipped_slot
            ? <button className="small" onClick={() => unequip(it)}>{t('ui.bag.unequip')}</button>
            : <button className="small" onClick={() => equip(it)}>{t('ui.bag.equip')}</button>}
        </div>
      ))}
      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}

/* ================= Jobs ================= */
function JobsPanel({ onClose, showErr }: { onClose: () => void; showErr: (e: unknown) => void }) {
  const profile = getProfile()!;
  const current = profile.state.current_job_id;
  const inTown = profile.state.current_map === 'town';
  async function switchJob(jobId: string) {
    try {
      await api('/jobs/switch', { jobId });
      const p = await refreshProfile();
      (window as unknown as { __activeJob?: string }).__activeJob = p.state.current_job_id;
    } catch (e) { showErr(e); }
  }
  const tier1 = Object.values(JOBS).filter(j => j.tier <= 1);
  return (
    <div className="panel center">
      <h3>{t('ui.jobs.title')}</h3>
      {tier1.map(j => {
        const owned = profile.jobs.find(r => r.job_id === j.id);
        return (
          <div className="row" key={j.id}>
            <span>{t(j.nameKey)} {owned && <small>Lv.{owned.level}</small>} {current === j.id && <b>◀ {t('ui.jobs.current')}</b>}</span>
            {current !== j.id &&
              <button className="small" disabled={!inTown} onClick={() => switchJob(j.id)}>
                {owned ? t('ui.jobs.switch') : t('ui.jobs.unlock')}
              </button>}
          </div>
        );
      })}
      {!inTown && <div className="err">{t('error.job.townOnly')}</div>}
      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}

/* ================= Loot ================= */
function LootPanel({ resp, onClose, onRepeat }: { resp: BattleResponse; onClose: () => void; onRepeat: () => void }) {
  const win = resp.outcome === 'victory';
  return (
    <div className="panel center">
      <h3>{t(win ? 'ui.battle.victory' : resp.outcome === 'defeat' ? 'ui.battle.defeat' : 'ui.battle.timeout')}</h3>
      {win ? (
        <div style={{ lineHeight: 2 }}>
          {t('ui.loot.exp')}: +{resp.rewards.exp} · {t('ui.loot.gold')}: +{resp.rewards.gold}
          {resp.rewards.levelsGained > 0 && <div style={{ color: '#ffd24a' }}>⬆ {t('ui.loot.levelup')} → Lv.{resp.rewards.newLevel}</div>}
          {resp.rewards.drops.length > 0 && (
            <div>{t('ui.loot.drops')}:{resp.rewards.drops.map(d => (
              <div key={d.dbId} className={`rarity-${d.rarity}`}>• {t(ITEMS[d.itemId]?.nameKey ?? d.itemId)} [{d.rarity}]</div>
            ))}</div>
          )}
        </div>
      ) : <div className="err">{t('ui.loot.defeatHint')}</div>}
      <button onClick={onClose}>{t('ui.loot.close')}</button>
    </div>
  );
}

export { GAME };
