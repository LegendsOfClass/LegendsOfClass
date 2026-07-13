import { useMemo, useState } from 'react';
import { api } from '../net/api';
import { t } from '../i18n';
import { getProfile, activeJob, refreshProfile } from '../state/store';
import { SKILLS, JOBS, type SkillDef } from '@loce/shared';

/**
 * Priority Builder (M3, docs/01-combat/05).
 * P1 = own-job actives only (D-006). P2–P4 = any unlocked active from any job.
 * Passive/Ultimate are informational — passive is always-on, ultimate auto-casts at 100 Energy.
 */
export function SkillsPanel({ onClose, showErr }: { onClose: () => void; showErr: (e: unknown) => void }) {
  const profile = getProfile()!;
  const job = activeJob()!;
  const unlocked = profile.skillsUnlocked;

  const [slots, setSlots] = useState<(string | null)[]>(
    Array.isArray(job.priority_slots) && job.priority_slots.length === 4
      ? [...job.priority_slots] : [null, null, null, null],
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const actives = useMemo(() =>
    unlocked
      .map(id => SKILLS[id])
      .filter((s): s is SkillDef => !!s && s.kind === 'skill')
      .filter(s => s.job !== job.job_id || s.unlockLevel <= job.level)
      .sort((a, b) => (a.job === job.job_id ? -1 : 1) - (b.job === job.job_id ? -1 : 1) || a.unlockLevel - b.unlockLevel),
    [unlocked, job.job_id, job.level]);

  const passive = Object.values(SKILLS).find(s => s.kind === 'passive' && s.job === job.job_id);
  const ultimate = Object.values(SKILLS).find(s => s.kind === 'ultimate' && s.job === job.job_id);
  const hasPassive = !!passive && unlocked.includes(passive.id) && passive.unlockLevel <= job.level;
  const hasUlt = !!ultimate && unlocked.includes(ultimate.id) && ultimate.unlockLevel <= job.level;

  function optionsFor(slotIdx: number): SkillDef[] {
    return slotIdx === 0 ? actives.filter(s => s.job === job.job_id) : actives;
  }

  function setSlot(i: number, id: string | null) {
    setSaved(false);
    setSlots(prev => {
      const next = [...prev];
      if (id) {
        for (let k = 0; k < 4; k++) if (k !== i && next[k] === id) next[k] = null; // no duplicates
      }
      next[i] = id;
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api('/jobs/priority', { slots });
      await refreshProfile();
      setSaved(true);
    } catch (e) { showErr(e); }
    finally { setBusy(false); }
  }

  const skillMeta = (s: SkillDef) =>
    `${t('ui.skills.cd')} ${s.cooldown / 10}s${s.castCondition !== 'always' ? ` · ${t('ui.skills.cond')}: ${s.castCondition}` : ''}`;

  return (
    <div className="panel center" style={{ maxWidth: 380 }}>
      <h3>⚔️ {t('ui.skills.title')} — {t(JOBS[job.job_id].nameKey)} Lv.{job.level}</h3>
      <div style={{ fontSize: 12, opacity: .8, lineHeight: 1.6, marginBottom: 8 }}>{t('ui.skills.hint')}</div>

      {[0, 1, 2, 3].map(i => (
        <div className="row" key={i} style={{ alignItems: 'center' }}>
          <b style={{ width: 30 }}>P{i + 1}</b>
          <select
            value={slots[i] ?? ''}
            onChange={e => setSlot(i, e.target.value || null)}
            style={{ flex: 1, background: '#161c2c', color: '#fff', border: '1px solid #3a4664', borderRadius: 6, padding: '5px 6px', fontSize: 13 }}>
            <option value="">{t('ui.skills.empty')}</option>
            {optionsFor(i).map(s => (
              <option key={s.id} value={s.id}>
                {t(`skill.${s.id}`)} {s.job !== job.job_id ? `〔${t(JOBS[s.job]?.nameKey ?? s.job)}〕` : ''}
              </option>
            ))}
          </select>
        </div>
      ))}
      {slots.map((id, i) => id && SKILLS[id] ? (
        <div key={'m' + i} style={{ fontSize: 11, opacity: .65, textAlign: 'left', paddingLeft: 34 }}>
          P{i + 1}: {skillMeta(SKILLS[id])}
        </div>
      ) : null)}
      <div style={{ fontSize: 11, opacity: .75, textAlign: 'left', marginTop: 6, padding: '6px 8px', background: 'rgba(0,0,0,.25)', borderRadius: 6 }}>
        🗡 <b>{t('ui.skills.normal')}</b> — {t('ui.skills.normalNote')}
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #444', fontSize: 12, textAlign: 'left', lineHeight: 1.8 }}>
        <div>🛡 <b>{t('ui.skills.passive')}:</b> {passive ? t(`skill.${passive.id}`) : '—'}{' '}
          {passive && (hasPassive ? <span style={{ color: '#8de29a' }}>✓ {t('ui.skills.alwaysOn')}</span>
            : <span style={{ opacity: .6 }}>🔒 {t('ui.skills.lockedAt')}{passive.unlockLevel}</span>)}
        </div>
        <div>💥 <b>{t('ui.skills.ultimate')}:</b> {ultimate ? t(`skill.${ultimate.id}`) : '—'}{' '}
          {ultimate && (hasUlt ? <span style={{ color: '#ffd24a' }}>✓ {t('ui.skills.autoCast')}</span>
            : <span style={{ opacity: .6 }}>🔒 {t('ui.skills.lockedAt')}{ultimate.unlockLevel}</span>)}
        </div>
      </div>

      <button disabled={busy} onClick={save}>{saved ? '✓ ' + t('ui.skills.saved') : t('ui.skills.save')}</button>

      <SkillBook unlocked={unlocked} currentJob={job.job_id} currentLevel={job.level} />

      <button onClick={onClose}>{t('ui.common.close')}</button>
    </div>
  );
}

/** Full per-job skill reference: what exists, at what level, and what you already own. */
function SkillBook({ unlocked, currentJob, currentLevel }: { unlocked: string[]; currentJob: string; currentLevel: number }) {
  const [tab, setTab] = useState(currentJob);
  const kindIcon: Record<string, string> = { skill: '⚔️', passive: '🛡', ultimate: '💥' };
  const list = Object.values(SKILLS)
    .filter(s => s.job === tab && s.kind !== 'normal')
    .sort((a, b) => a.unlockLevel - b.unlockLevel);
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #444' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>📖 <b>{t('ui.skills.book')}</b></div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        {Object.values(JOBS).map(jb => (
          <button key={jb.id} className="small"
            style={{ background: tab === jb.id ? '#3a5aad' : undefined }}
            onClick={() => setTab(jb.id)}>{t(jb.nameKey)}</button>
        ))}
      </div>
      <div style={{ textAlign: 'left', fontSize: 12, lineHeight: 1.9, maxHeight: 170, overflowY: 'auto' }}>
        {list.map(s => {
          const owned = unlocked.includes(s.id);
          const usable = owned && (s.job !== tab || tab !== currentJob || s.unlockLevel <= currentLevel);
          return (
            <div key={s.id} style={{ opacity: owned ? 1 : .55 }}>
              {kindIcon[s.kind]} Lv.{s.unlockLevel} — {t(`skill.${s.id}`)}{' '}
              <small style={{ opacity: .7 }}>[{t(`ui.skills.type.${s.kind}`)}]</small>{' '}
              {owned ? <span style={{ color: '#8de29a' }}>✓</span> : '🔒'}
              {owned && !usable ? null : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
