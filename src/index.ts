import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game/game-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(GameSystem);
});
