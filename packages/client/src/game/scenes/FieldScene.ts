import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { MAPS, MONSTERS } from '@loce/shared';
import { getProfile } from '../../state/store';

/** Verdant Plains (map id: 'grassland'). Monster nodes come from maps.json — data-driven (Rule 5). */
export class FieldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private target: Phaser.Math.Vector2 | null = null;
  private busy = false;

  constructor() { super('Field'); }

  create() {
    const { width: w, height: h } = this.scale;
    this.busy = false;
    this.add.rectangle(w / 2, h / 2, w, h, 0x4c6b3c);
    for (let i = 0; i < 24; i++) {
      const x = Phaser.Math.Between(20, w - 20), y = Phaser.Math.Between(60, h - 30);
      this.add.rectangle(x, y, 6, 14, 0x3a5530).setAngle(Phaser.Math.Between(-20, 20));
    }
    this.add.text(w / 2, 24, t('map.grassland'), { fontSize: '20px', color: '#fff' }).setOrigin(0.5);

    // monster nodes (data-driven from maps.json)
    const nodes = MAPS['grassland'].nodes;
    nodes.forEach((node, i) => {
      const x = w * (0.3 + i * 0.4), y = h * 0.42;
      this.add.sprite(x, y, 'prop.node');
      const mon = MONSTERS[node.monsterId];
      const monSprite = this.add.sprite(x - 30, y, `unit.${node.monsterId}`).setInteractive({ useHandCursor: true });
      this.add.text(x + 18, y - 10, t(mon.nameKey), { fontSize: '13px', color: '#fff' }).setOrigin(0, 0.5);
      this.add.text(x + 18, y + 10, `Lv.${mon.level}`, { fontSize: '12px', color: '#ffd27f' }).setOrigin(0, 0.5);
      const fight = () => {
        if (this.busy) return;
        this.busy = true;
        EventBus.emit('request-battle', node.id);
        this.time.delayedCall(1200, () => { this.busy = false; });
      };
      monSprite.on('pointerdown', fight);
    });

    const jobId = getProfile()?.state.current_job_id ?? 'novice';
    this.player = this.add.sprite(w * 0.5, h * 0.75, `unit.${jobId}`);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.target = new Phaser.Math.Vector2(p.worldX, p.worldY);
    });
  }

  update(_: number, dtMs: number) {
    if (!this.target) return;
    const speed = 220 * (dtMs / 1000);
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (d <= speed) { this.player.setPosition(this.target.x, this.target.y); this.target = null; }
    else {
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.target.x, this.target.y);
      this.player.x += Math.cos(a) * speed; this.player.y += Math.sin(a) * speed;
    }
  }
}
