import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { getProfile } from '../../state/store';

/** Riverdale Town (map id: 'town'). Click-to-move; walk into hotspots to interact. */
export class TownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private nameTag!: Phaser.GameObjects.Text;
  private target: Phaser.Math.Vector2 | null = null;
  private jobmaster!: Phaser.GameObjects.Sprite;
  private gate!: Phaser.GameObjects.Sprite;
  private cooldown = 0;

  constructor() { super('Town'); }

  create() {
    const { width: w, height: h } = this.scale;
    // ground
    this.add.rectangle(w / 2, h / 2, w, h, 0x3f5a3a);
    this.add.rectangle(w / 2, h / 2 + 30, w * 0.55, 90, 0x8a7a58); // plaza road
    this.add.text(w / 2, 24, t('map.town'), { fontSize: '20px', color: '#fff' }).setOrigin(0.5);

    // hotspots
    this.jobmaster = this.add.sprite(w * 0.25, h * 0.4, 'prop.jobmaster').setInteractive({ useHandCursor: true });
    this.add.text(this.jobmaster.x, this.jobmaster.y - 60, t('ui.town.jobmaster'), { fontSize: '14px', color: '#e8ddff' }).setOrigin(0.5);
    this.gate = this.add.sprite(w * 0.82, h * 0.5, 'prop.gate').setInteractive({ useHandCursor: true });
    this.add.text(this.gate.x, this.gate.y - 72, t('ui.town.gate') + ' → ' + t('map.grassland'), { fontSize: '14px', color: '#ffe9c9' }).setOrigin(0.5);

    // player
    const jobId = getProfile()?.state.current_job_id ?? 'novice';
    this.player = this.add.sprite(w * 0.5, h * 0.68, `unit.${jobId}`);
    this.nameTag = this.add.text(this.player.x, this.player.y - 36, getProfile()?.account.display_name ?? '', { fontSize: '12px', color: '#fff' }).setOrigin(0.5);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.target = new Phaser.Math.Vector2(p.worldX, p.worldY); });
    this.jobmaster.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.jobmaster.x + 60, this.jobmaster.y + 30); });
    this.gate.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.gate.x - 60, this.gate.y + 20); });

    // job may change while standing in town — swap texture live
    const off = EventBus.on('profile', () => {
      const j = getProfile()?.state.current_job_id ?? 'novice';
      if (this.player?.active) this.player.setTexture(`unit.${j}`);
    });
    this.events.once('shutdown', off);
  }

  update(_: number, dtMs: number) {
    if (this.cooldown > 0) this.cooldown -= dtMs;
    if (!this.target) return;
    const speed = 220 * (dtMs / 1000);
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (d <= speed) { this.player.setPosition(this.target.x, this.target.y); this.target = null; }
    else {
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.target.x, this.target.y);
      this.player.x += Math.cos(a) * speed; this.player.y += Math.sin(a) * speed;
    }
    this.nameTag.setPosition(this.player.x, this.player.y - 36);

    if (this.cooldown <= 0) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.jobmaster.x, this.jobmaster.y) < 80) {
        this.cooldown = 800; EventBus.emit('open-panel', 'jobs');
      } else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.gate.x, this.gate.y) < 90) {
        this.cooldown = 1500; EventBus.emit('request-travel', 'grassland');
      }
    }
  }
}
