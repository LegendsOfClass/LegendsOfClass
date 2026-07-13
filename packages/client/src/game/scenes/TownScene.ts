import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { WorldScene } from './WorldScene';

/** Riverdale Town (map id: 'town'). Presence + movement come from WorldScene. */
export class TownScene extends WorldScene {
  private jobmaster!: Phaser.GameObjects.Sprite;
  private cooldown = 0;

  constructor() { super('Town'); }
  protected mapId() { return 'town'; }

  protected createWorld(w: number, h: number) {
    this.cooldown = 0;
    this.add.rectangle(w / 2, h / 2, w, h, 0x3f5a3a);
    this.add.rectangle(w / 2, h / 2 + 30, w * 0.55, 90, 0x8a7a58);
    this.add.text(w / 2, 24, t('map.town'), { fontSize: '20px', color: '#fff' }).setOrigin(0.5);

    this.jobmaster = this.add.sprite(w * 0.25, h * 0.4, 'prop.jobmaster').setInteractive({ useHandCursor: true });
    this.add.text(this.jobmaster.x, this.jobmaster.y - this.jobmaster.displayHeight / 2 - 12, t('ui.town.jobmaster'), { fontSize: '14px', color: '#e8ddff' }).setOrigin(0.5);
    this.jobmaster.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.jobmaster.x + 60, this.jobmaster.y + 30); });
  }

  protected subUpdate(dtMs: number) {
    if (this.cooldown > 0) { this.cooldown -= dtMs; return; }
    if (!this.player) return;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.jobmaster.x, this.jobmaster.y) < 80) {
      this.cooldown = 800; EventBus.emit('open-panel', 'jobs');
    }
  }
}
