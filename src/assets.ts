import { defineAssets } from '@iwsdk/core';

// Shadowfolk builds its room procedurally at runtime (see src/game/theater.ts),
// so the shared asset catalog is empty.
export default defineAssets({});
