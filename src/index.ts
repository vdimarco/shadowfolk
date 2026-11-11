import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game/game-system.js';

/**
 * With ?iwer in the URL, run inside IWER, the WebXR emulator from Meta's
 * Immersive Web SDK, as an emulated Quest 3. Used to record demo footage
 * "as viewed via an emulator". Normal players never load it.
 */
async function installEmulator() {
  if (!new URLSearchParams(location.search).has('iwer')) return;
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  // force: browsers can ship an empty native WebXR runtime that would win otherwise
  device.installRuntime({ forceInstall: true });
  device.stereoEnabled = false;
  device.primaryInputMode = 'hand';
  // the scripted hands draw themselves; hide the emulator's default hands
  if (device.hands.left) device.hands.left.connected = false;
  if (device.hands.right) device.hands.right.connected = false;
  (window as unknown as { __iwer: unknown }).__iwer = device;
}

installEmulator()
  .catch((e) => console.warn('[shadowfolk] emulator not installed', e))
  .then(() =>
    World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions),
  )
  .then((world) => {
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
