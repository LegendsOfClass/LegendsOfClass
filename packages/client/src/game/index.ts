/** Phaser bootstrap + scene routing driven by EventBus (Rule 4: Rendering layer). */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TownScene } from './scenes/TownScene';
import { FieldScene } from './scenes/FieldScene';
import { BattleScene } from './scenes/BattleScene';
import { EventBus } from '../EventBus';
import type { BattleResponse } from '@loce/shared';

let game: Phaser.Game | null = null;

export function startGame(parent: HTMLElement) {
  if (game) return game;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1a1a2e',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, TownScene, FieldScene, BattleScene],
  });

  EventBus.on('goto-map', (mapId: string) => {
    stopAll();
    if (mapId === 'town') game!.scene.start('Town');
    else game!.scene.start('Field', { mapId });
  });
  EventBus.on('start-battle-replay', (resp: BattleResponse) => {
    stopAll();
    game!.scene.start('Battle', { resp });
  });
  return game;
}

function stopAll() {
  for (const key of ['Town', 'Field', 'Battle']) {
    if (game!.scene.isActive(key) || game!.scene.isPaused(key)) game!.scene.stop(key);
  }
}
