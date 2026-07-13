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
import { ChatBox } from './ChatBox';
import { SkillsPanel } from './SkillsPanel';
import { TravelPanel } from './TravelPanel';
import { initRealtime, rtLeave, rtRefresh } from '../net/realtime';

type PanelId = 'none' | 'jobs' | 'character' | 'bag' | 'skills' | 'travel' | 'dev' | 'loot';

export function App() {
  const [, force] = useState(0);
  const rerender = useCallback(() => force(n => n + 1), []);
  const [logged, setLogged] = useState(false);
  const [panel, setPanel] = useState<PanelId>('none');
  const [loot, setLoot] = useState<BattleResponse | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ---- boot: token → profile → enter world ----
  useEffect(() => {
    initRealtime(() => localStorage.getItem('loce.token'));
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
    const guideKey = 'loce_guide_' + p.account.username;
    if (!localStorage.getItem(guideKey)) {
      setShowGuide(true);
      localStorage.setItem(guideKey, '1');
    }
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
      rtLeave();
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
          {job ? `${t(JOBS[job.job_id]?.nameKey ?? job.job_id)} Lv.${job.level}` : ''}
          <span style={{ marginLeft: 10, color: '#9fd' }}>
            EXP {exp.cur}/{exp.next}
          </span>
        </div>
        <div>
          🪙 {profile?.state.gold ?? 0} · 💎 {profile?.state.diamond ?? 0}
          <button className="small" style={{ marginLeft: 10 }} onClick={() => { setLang(getLang() === 'th' ? 'en' : 'th'); rerender(); }}>{t('ui.common.lang')}</button>
          <button className="small" onClick={() => { rtLeave(); setToken(null); clearProfile(); location.reload(); }}>{t('ui.common.logout')}</button>
        </div>
      </div>

      {/* ---- Bottom HUD ---- */}
      <div className="hud">
        <button onClick={() => setPanel('character')}>{t('ui.hud.character')}</button>
        <button onClick={() => setPanel('bag')}>{t('ui.hud.bag')}</button>
        <button onClick={() => setPanel('skills')}>{t('ui.hud.skills')}</button>
        <button onClick={() => setPanel('jobs')}>{t('ui.hud.jobs')}</button>
        <button onClick={() => setPanel('travel')}>🗺 {t('ui.hud.map')}</button>
        {import.meta.env.DEV && <button style={{ background: '#7a3a3a' }} onClick={() => setPanel('dev')}>{t('ui.hud.dev')}</button>}
      </div>

      <ChatBox />

      {err && <div className="panel" style={{ top: 60, left: '50%', transform: 'translateX(-50%)' }}><span className="err">{err}</span></div>}

      {panel === 'character' && <CharacterPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'bag' && <BagPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'jobs' && <JobsPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'skills' && <SkillsPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'travel' && <TravelPanel onClose={() => setPanel('none')} onTravel={(m) => { setPanel('none'); travel(m); }} />}
      {panel === 'dev' && import.meta.env.DEV && <DevPanel onClose={() => setPanel('none')} showErr={showErr} />}
      {panel === 'loot' && loot && <LootPanel resp={loot} onClose={() => setPanel('none')} onRepeat={() => { setPanel('none'); }} />}
      {showGuide && (
        <div className="panel center">
          <h3>🗺 {t('ui.guide.title')}</h3>
          <p style={{ lineHeight: 1.7, fontSize: 14 }}>⚔️ {t('ui.guide.body1')}</p>
          <p style={{ lineHeight: 1.7, fontSize: 14 }}>✨ {t('ui.guide.body2')}</p>
          <button onClick={() => setShowGuide(false)}>{t('ui.guide.ok')}</button>
        </div>
      )}
    </>
  );
}

/* ================= Login ================= */
const BASE_JOBS = ['swordman', 'mage', 'archer', 'healer'] as const;

function Login({ onDone, showErr, err }: { onDone: () => void; showErr: (e: unknown) => void; err: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [d, setD] = useState('');
  const [jobId, setJobId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === 'register' && !jobId) { showErr({ messageKey: 'error.login.noJob' }); return; }
    setBusy(true);
    try {
      const body = mode === 'login' ? { username: u, password: p } : { username: u, password: p, displayName: d, jobId };
      const r = await api<{ token: string }>(`/auth/${mode}`, body);
      setToken(r.token);
      onDone();
    } catch (e) { showErr(e); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel center">
      <img src="sprites/logo.png" alt="Legends of Class Evolution" style={{ maxWidth: 220, margin: '0 auto 8px', display: 'block' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <h3>{t('ui.login.title')}</h3>
      <input placeholder={t('ui.login.username')} value={u} onChange={e => setU(e.target.value)} />
      <input placeholder={t('ui.login.password')} type="password" value={p} onChange={e => setP(e.target.value)} />
      {mode === 'register' && <input placeholder={t('ui.login.display')} value={d} onChange={e => setD(e.target.value)} />}
      {mode === 'register' && (
        <div style={{ margin: '8px 0' }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>{t('ui.login.pickJob')}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {BASE_JOBS.map(j => (
              <div key={j} onClick={() => setJobId(j)}
                style={{ cursor: 'pointer', padding: 6, borderRadius: 8, textAlign: 'center', width: 76,
                  border: jobId === j ? '2px solid #ffd24a' : '2px solid #444',
                  background: jobId === j ? 'rgba(255,210,74,.12)' : 'rgba(0,0,0,.25)' }}>
                <img src={`sprites/${j}.png`} alt={j} style={{ height: 56, display: 'block', margin: '0 auto 4px' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                <div style={{ fontSize: 11 }}>{t(`job.${j}`)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: .75, marginTop: 6 }}>{t('ui.login.pickJobHint')}</div>
        </div>
      )}
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
      rtRefresh();
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
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #444', fontSize: 12, opacity: .8 }}>
        {t('ui.jobs.t2')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {['magic_knight', 'paladin', 'dragoon', 'spell_archer', 'sage', 'bard'].map(j => (
            <span key={j} style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(0,0,0,.3)', border: '1px solid #555' }}>
              🔒 {t(`job.${j}`)}
            </span>
          ))}
        </div>
      </div>
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
