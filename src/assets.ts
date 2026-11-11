import { AssetType, defineAssets } from '@iwsdk/core';

// Shadowfolk builds its room procedurally at runtime (see src/game/theater.ts).
// The only files are the standard WebXR generic hand models, used to draw
// the simulated hands in desktop demo and capture modes.
const HAND_BASE = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand';

export default defineAssets({
  'hand-left': { url: `${HAND_BASE}/left.glb`, type: AssetType.GLTF, name: 'Generic Hand (left)', priority: 'lazy' },
  'hand-right': { url: `${HAND_BASE}/right.glb`, type: AssetType.GLTF, name: 'Generic Hand (right)', priority: 'lazy' },
});
