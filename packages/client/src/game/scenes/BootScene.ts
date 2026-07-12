import Phaser from 'phaser';
import { generatePlaceholders } from '../textures';
import { EventBus } from '../../EventBus';

/** Real art loads from /sprites/*.png; any missing file falls back to a generated
 * placeholder under the SAME texture key — swapping art never requires code changes. */
const SPRITES: [string, string][] = [
  ['unit.swordman', 'sprites/swordman.png'],
  ['unit.mage', 'sprites/mage.png'],
  ['unit.archer', 'sprites/archer.png'],
  ['unit.healer', 'sprites/healer.png'],
  ['unit.green_slime', 'sprites/green_slime.png'],
  ['unit.wild_boar', 'sprites/wild_boar.png'],
  ['prop.jobmaster', 'sprites/jobmaster.png'],
  ['ui.logo', 'sprites/logo.png'],
];

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    for (const [key, path] of SPRITES) this.load.image(key, path);
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn('[boot] missing sprite, placeholder will be used:', file.key);
    });
  }
  create() {
    generatePlaceholders(this); // fills only keys that failed to load
    EventBus.emit('phaser-ready');
  }
}
