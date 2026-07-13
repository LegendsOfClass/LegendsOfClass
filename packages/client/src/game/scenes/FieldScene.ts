import { EventBus } from '../../EventBus';
import { t } from '../../i18n';
import { MAPS, MONSTERS } from '@loce/shared';
import { WorldScene } from './WorldScene';

/** Generic field map — content is data-driven from maps.json (Rule 5). */
export class FieldScene extends WorldScene {
  private busy = false;
  private currentMapId = 'grassland';

  constructor() { super('Field'); }
  init(data: { mapId?: string }) { this.currentMapId = data?.mapId ?? 'grassland'; }
  protected mapId() { return this.currentMapId; }

  protected createWorld(w: number, h: number) {
    this.busy = false;
    const palette: Record<string, number> = { grassland: 0x4c6b3c, whisperwood: 0x35513f };
    this.add.rectangle(w / 2, h / 2, w, h, palette[this.currentMapId] ?? 0x4c6b3c);
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(Math.random() * (w - 40)) + 20, y = Math.floor(Math.random() * (h - 90)) + 60;
      this.add.rectangle(x, y, 6, 14, 0x2c4030).setAngle(Math.floor(Math.random() * 40) - 20);
    }
    const map = MAPS[this.currentMapId];
    this.add.text(w / 2, 24, t(map.nameKey), { fontSize: '20px', color: '#fff' }).setOrigin(0.5);

    // layout: up to 3 nodes on the first row, the rest on a second row
    const nodes = map.nodes;
    nodes.forEach((node, i) => {
      const row = i < 3 ? 0 : 1;
      const inRow = row === 0 ? Math.min(nodes.length, 3) : nodes.length - 3;
      const col = row === 0 ? i : i - 3;
      const x = w * ((col + 1) / (inRow + 1));
      const y = h * (0.3 + row * 0.22);
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
