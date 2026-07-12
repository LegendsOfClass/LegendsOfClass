import Phaser from 'phaser';
import { generatePlaceholders } from '../textures';
import { EventBus } from '../../EventBus';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    generatePlaceholders(this);
    EventBus.emit('phaser-ready');
  }
}
