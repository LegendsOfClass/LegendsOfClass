import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { WorldScene } from './WorldScene';

/** Riverdale Town (map id: 'town'). Presence + movement come from WorldScene. */
export class TownScene extends WorldScene {
  private jobmaster!: Phaser.GameObjects.Sprite;
  private gate!: Phaser.GameObjects.Sprite;
  private gate2!: Phaser.GameObjects.Sprite;
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
    this.gate = this.add.sprite(w * 0.82, h * 0.36, 'prop.gate').setInteractive({ useHandCursor: true });
    this.add.text(this.gate.x, this.gate.y - this.gate.displayHeight / 2 - 12, t('ui.town.gate') + ' → ' + t('map.grassland'), { fontSize: '14px', color: '#ffe9c9' }).setOrigin(0.5);
    this.gate2 = this.add.sprite(w * 0.82, h * 0.68, 'prop.gate').setTint(0x9fd8a0).setInteractive({ useHandCursor: true });
    this.add.text(this.gate2.x, this.gate2.y - this.gate2.displayHeight / 2 - 12, t('ui.town.gate') + ' → ' + t('map.whisperwood'), { fontSize: '14px', color: '#c9ffd6' }).setOrigin(0.5);

    this.jobmaster.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.jobmaster.x + 60, this.jobmaster.y + 30); });
    this.gate.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.gate.x - 60, this.gate.y + 20); });
    this.gate2.on('pointerdown', () => { this.target = new Phaser.Math.Vector2(this.gate2.x - 60, this.gate2.y + 20); });
  }

  protected subUpdate(dtMs: number) {
    if (this.cooldown > 0) { this.cooldown -= dtMs; return; }
    if (!this.player) return;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.jobmaster.x, this.jobmaster.y) < 80) {
      this.cooldown = 800; EventBus.emit('open-panel', 'jobs');
    } else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.gate.x, this.gate.y) < 90) {
      this.cooldown = 1500; EventBus.emit('request-travel', 'grassland');
    } else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.gate2.x, this.gate2.y) < 90) {
      this.cooldown = 1500; EventBus.emit('request-travel', 'whisperwood');
    }
  }
}
