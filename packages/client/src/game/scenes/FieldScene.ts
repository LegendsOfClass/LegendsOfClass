import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { MAPS, MONSTERS } from '@loce/shared';
import { WorldScene } from './WorldScene';

/** Verdant Plains (map id: 'grassland'). Monster nodes are data-driven (Rule 5). */
export class FieldScene extends WorldScene {
  private busy = false;

  constructor() { super('Field'); }
  protected mapId() { return 'grassland'; }

  protected createWorld(w: number, h: number) {
    this.busy = false;
    this.add.rectangle(w / 2, h / 2, w, h, 0x4c6b3c);
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(Math.random() * (w - 40)) + 20, y = Math.floor(Math.random() * (h - 90)) + 60;
      this.add.rectangle(x, y, 6, 14, 0x3a5530).setAngle(Math.floor(Math.random() * 40) - 20);
    }
    this.add.text(w / 2, 24, t('map.grassland'), { fontSize: '20px', color: '#fff' }).setOrigin(0.5);

    MAPS['grassland'].nodes.forEach((node, i) => {
      const x = w * (0.3 + i * 0.4), y = h * 0.42;
      this.add.sprite(x, y, 'prop.node');
      const mon = MONSTERS[node.monsterId];
      const monSprite = this.add.sprite(x - 30, y, this.unitTex(node.monsterId)).setInteractive({ useHandCursor: true });
      this.add.text(x + 18, y - 10, t(mon.nameKey), { fontSize: '13px', color: '#fff' }).setOrigin(0, 0.5);
      this.add.text(x + 18, y + 10, `Lv.${mon.level}`, { fontSize: '12px', color: '#ffd27f' }).setOrigin(0, 0.5);
      monSprite.on('pointerdown', () => {
        if (this.busy) return;
        this.busy = true;
        EventBus.emit('request-battle', node.id);
        this.time.delayedCall(1200, () => { this.busy = false; });
      });
    });
  }
}
