/** Placeholder texture generation (Rule 4: Rendering asset layer).
 * Real art swaps in later by loading images under the SAME keys — no code changes. */
import Phaser from 'phaser';

function circleTex(scene: Phaser.Scene, key: string, color: number, r = 24, border = 0x222222) {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  g.fillStyle(color, 1).fillCircle(r, r, r - 2);
  g.lineStyle(3, border, 1).strokeCircle(r, r, r - 2);
  g.generateTexture(key, r * 2, r * 2); g.destroy();
}
function rectTex(scene: Phaser.Scene, key: string, color: number, w: number, h: number, border = 0x111111) {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  g.fillStyle(color, 1).fillRoundedRect(0, 0, w, h, 8);
  g.lineStyle(3, border, 1).strokeRoundedRect(1, 1, w - 2, h - 2, 8);
  g.generateTexture(key, w, h); g.destroy();
}

export function generatePlaceholders(scene: Phaser.Scene) {
  // player per job (fallbacks when /sprites/*.png missing)
  circleTex(scene, 'unit.fallback', 0xd9c38c);
  circleTex(scene, 'unit.swordman', 0xd9534f);
  circleTex(scene, 'unit.mage', 0x5b7bd5);
  circleTex(scene, 'unit.archer', 0x3f9e58);
  circleTex(scene, 'unit.healer', 0xe8d06a);
  // monsters
  circleTex(scene, 'unit.green_slime', 0x5cb85c, 20);
  circleTex(scene, 'unit.wild_boar', 0x8a5a3b, 26);
  // world props
  rectTex(scene, 'prop.jobmaster', 0x8b6fc9, 72, 84);
  rectTex(scene, 'prop.gate', 0xb0893a, 96, 110);
  rectTex(scene, 'prop.node', 0x39465e, 150, 96);
}
