import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game/game-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(GameSystem);

  // Installed as a Quest app there is no 2D page to click, so the app-icon
  // tap must start the VR session. getDigitalGoodsService exists only in the
  // installed app, so a browser tab keeps its normal Enter button.
  const nav = navigator as Navigator & {
    xr?: { isSessionSupported?: (m: string) => Promise<boolean> };
  };
  if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
    nav.xr
      .isSessionSupported('immersive-vr')
      .then((supported) => {
        if (supported) world.launchXR();
      })
      .catch(() => {});
  }
});
