import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { simulate, type BattleResponse, type BattleEvent, type UnitSnapshot } from '@loce/shared';

/**
 * Deterministic replay (D-017): the server sends seed + snapshots + checksum,
 * the client re-simulates with the SAME shared engine and animates the event stream.
 * If checksums mismatch (data version drift), we still show the server outcome.
 */
interface UnitView {
  snap: UnitSnapshot;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBack: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  hp: number;
}

export class BattleScene extends Phaser.Scene {
  private resp!: BattleResponse;
  private views = new Map<string, UnitView>();
  private queue: BattleEvent[] = [];
  private speed = 1;
  private stepTimer?: Phaser.Time.TimerEvent;

  constructor() { super('Battle'); }

  init(data: { resp: BattleResponse }) { this.resp = data.resp; }

  create() {
    const { width: w, height: h } = this.scale;
    this.views.clear();
    this.speed = 1;
    this.add.rectangle(w / 2, h / 2, w, h, 0x2b3a2b);
    this.add.rectangle(w / 2, h * 0.78, w * 0.9, 4, 0x1c281c);

    // local re-simulation with the shared engine
    const sim = simulate(this.resp.setup);
    const verified = sim.checksum === this.resp.checksum;
    if (!verified) console.warn('[battle] checksum mismatch — showing server outcome', sim.checksum, this.resp.checksum);
    this.queue = verified ? [...sim.events] : [];

    // layout: player side left, monsters right
    const players = this.resp.setup.units.filter(u => u.side === 0);
    const mons = this.resp.setup.units.filter(u => u.side === 1);
    players.forEach((u, i) => this.spawnUnit(u, w * 0.22, h * 0.55 + i * 70));
    mons.forEach((u, i) => this.spawnUnit(u, w * 0.72, h * 0.35 + i * 90));

    // speed / skip controls
    const mkBtn = (x: number, label: string, cb: () => void) => {
      const btn = this.add.text(x, 20, label, { fontSize: '14px', color: '#fff', backgroundColor: '#3a5aad', padding: { x: 10, y: 6 } })
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', cb);
      return btn;
    };
    mkBtn(16, `${t('ui.battle.speed')} x1`, () => this.setSpeed(1));
    mkBtn(120, 'x2', () => this.setSpeed(2));
    mkBtn(170, 'x4', () => this.setSpeed(4));
    mkBtn(220, t('ui.battle.skip'), () => this.finish());

    this.schedule();
  }

  private spawnUnit(u: UnitSnapshot, x: number, y: number) {
    const texKey = u.side === 0
      ? `unit.${u.nameKey && this.textures.exists(`unit.${u.nameKey}`) ? u.nameKey : this.playerTex()}`
      : `unit.${u.id.split('#')[0]}`;
    const sprite = this.add.sprite(x, y, this.textures.exists(texKey) ? texKey : 'unit.novice');
    const top = y - sprite.displayHeight / 2;
    const label = this.add.text(x, top - 24, u.side === 0 ? u.nameKey : t(u.nameKey), { fontSize: '12px', color: '#fff' }).setOrigin(0.5);
    const hpBack = this.add.rectangle(x, top - 10, 64, 7, 0x111111).setOrigin(0.5);
    const hpBar = this.add.rectangle(x - 32, top - 10, 64, 7, 0x53d769).setOrigin(0, 0.5);
    this.views.set(u.id, { snap: u, sprite, hpBar, hpBack, label, hp: u.maxHp });
  }

  private playerTex() {
    // active job texture for the player unit
    const job = (window as unknown as { __activeJob?: string }).__activeJob ?? 'novice';
    return job;
  }

  private setSpeed(s: number) {
    this.speed = s;
    this.schedule();
  }

  private schedule() {
    this.stepTimer?.remove();
    this.stepTimer = this.time.addEvent({ delay: 420 / this.speed, loop: true, callback: () => this.step() });
  }

  private step() {
    // consume one "action group": an action event and its following damage/heal/death events
    const ev = this.queue.shift();
    if (!ev) { this.finish(); return; }
    if (ev.type === 'end') { this.finish(); return; }

    if (ev.type === 'action') {
      const v = this.views.get(ev.actor);
      if (v) this.tweens.add({ targets: v.sprite, x: v.sprite.x + (v.snap.side === 0 ? 14 : -14), yoyo: true, duration: 110 / this.speed });
      // consume the effects belonging to this action immediately after
      while (this.queue.length && (this.queue[0].type === 'damage' || this.queue[0].type === 'heal' || this.queue[0].type === 'death')) {
        this.applyEffect(this.queue.shift()!);
      }
    } else {
      this.applyEffect(ev);
    }
  }

  private applyEffect(ev: BattleEvent) {
    if (ev.type === 'damage' || ev.type === 'heal') {
      const v = this.views.get(ev.target); if (!v) return;
      v.hp = ev.targetHp;
      const pct = Phaser.Math.Clamp(v.hp / v.snap.maxHp, 0, 1);
      v.hpBar.width = 64 * pct;
      v.hpBar.fillColor = pct > 0.5 ? 0x53d769 : pct > 0.25 ? 0xe8b339 : 0xd9534f;
      const isHeal = ev.type === 'heal';
      const txt = ev.type === 'damage' && ev.miss ? 'MISS' : `${isHeal ? '+' : '-'}${ev.value}${ev.crit ? '!' : ''}`;
      const color = isHeal ? '#7CFC9A' : ev.crit ? '#ffd24a' : '#ff8a8a';
      const float = this.add.text(v.sprite.x, v.sprite.y - v.sprite.displayHeight / 2 - 4, txt, { fontSize: ev.crit ? '18px' : '14px', color }).setOrigin(0.5);
      this.tweens.add({ targets: float, y: float.y - 30, alpha: 0, duration: 650 / this.speed, onComplete: () => float.destroy() });
      if (!isHeal && !('miss' in ev && ev.miss)) {
        this.tweens.add({ targets: v.sprite, alpha: 0.4, yoyo: true, duration: 80 / this.speed });
      }
    } else if (ev.type === 'death') {
      const v = this.views.get(ev.target); if (!v) return;
      this.tweens.add({ targets: [v.sprite, v.label, v.hpBar, v.hpBack], alpha: 0.15, duration: 250 / this.speed });
    }
  }

  private finish() {
    this.stepTimer?.remove();
    EventBus.emit('battle-finished', this.resp);
  }

  shutdown() { this.stepTimer?.remove(); }
}
