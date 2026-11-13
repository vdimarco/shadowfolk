# Shadowfolk

A seated, hands-only VR game for Meta Quest. You sit in front of a paper screen. A lamp is behind you. Your real hands cast soft shadows on the paper. Make the shape of each shadow creature and it wakes up and leaves the screen.

Built with the Immersive Web SDK (IWSDK) for WebXR. Entry for the Meta VR Start Developer Competition 2026: Gaming track, New Experience division.

Demo video (2:46): https://youtu.be/HJrWuZwFKZw (always the latest: https://shadowfolk.vercel.app/video)

## Play

1. Open https://shadowfolk.vercel.app in the Meta Quest Browser.
2. Pinch "Enter Shadowfolk".
3. Sit back and lift a hand into the light.

No controllers. Every action uses hands:

- Make a shape: hold your hands between your head and the paper.
- Press a button: poke one of the three brass buttons on the tray below you with a fingertip.
  - **Book**: shows the creatures you found.
  - **Gentle**: lowers the match level and raises the contrast.
  - **Skip / Next / Daily / Free play**: moves on. After the daily shadow it opens free play, where any shadow from your Book wakes its creature.

### Get it onto your Quest

- **From a phone or computer:** open https://shadowfolk.vercel.app/quest (or press "Open on Meta Quest" on the site). Meta's Web Launch sends the page to your headset's browser.
- **In the headset:** open the Quest Browser and type `shadowfolk.vercel.app`. Bookmark it to come back.

The site also has a web app manifest and icons. If it is later packaged for the Meta Horizon Store, the packaged app opens straight into VR.

## How it works

- `src/game/hand-model.ts`: the 25 WebXR hand joints, and a pose model that builds joints from finger curl and splay. The levels use it, so each target shape is a shape a real hand can make.
- `src/game/silhouette.ts`: turns each hand into 28 capsules, projects them from the lamp onto the wall, and gives each edge a soft penumbra. The same 2D data drives the GPU shadow and the CPU shape matcher.
- The matcher compares your shadow with the target. It ignores position and size, and it accepts mirrored shapes, so left-handed players get the same game.
- `src/game/theater.ts`: the paper wall shader, the room, and the button tray.
- `src/game/game-system.ts`: hand tracking, game states, the creature animations, and the Shadow Book.
- `src/game/puzzles.ts` and `src/game/tools.ts`: chapter three, shadow tools. The player's shadow is solid on the paper, and each hand's shape (read from its joints) is a tool: slide, bowl, sieve or stone. Six puzzles (rain, bowl, fireflies, pearls, frozen cloud, moon garden). `tools/test-puzzles.ts` checks them with drawn shadows; `tools/plan-tools.ts` solves them with real hand poses.
- `src/game/chase.ts` and `src/game/chase-scene.ts`: chapter two, the Chase. The Ink Wolf hunts the player through five faster stages; each obstacle needs the right shadow before it hits (a fist is read from the joints). `tools/test-chase.ts` plays whole runs with scripted players.
- `src/game/mirror-scene.ts`: Shadow Mirror, a no-rules toy (a delayed mirrored twin, echoes, a giant copy, fingertip sparks, hand music). `src/game/music.ts`: each shape is an instrument and the hand's height the note.
- `src/game/battle.ts` and `src/game/battle-scene.ts`: chapter four, the Ink Wolf spell battle. Every creature the player has found is a spell. `tools/test-battle.ts` plays whole fights; `tools/preview-wolf.ts` draws the wolf to a PNG.
- `src/game/world.ts`: the open-air night theater around the paper (sky, moon, pines, stage, curtains, lanterns, fireflies).
- `src/game/daily.ts`: a new shape each day from a date seed. The book keeps a daily streak.

All sound is made with WebAudio. The game uses no image, audio, or model files.

## Develop

```bash
npm install
```

```bash
npm run dev
```

The dev server opens a browser with IWER, the IWSDK WebXR emulator. In a cloud container with no display, use `npx @iwsdk/cli dev up --headless`.

```bash
npm test
```

`npm test` checks the shape matcher: each level matches itself, matches when moved, resized, or mirrored, and rejects the other levels.

```bash
npm run build && npx vite preview --port 4173 &
```

```bash
npm run test:e2e
```

The end-to-end test plays the full story with synthetic hand poses and checks that progress saves.

Add `?demo=1` to the URL to see a desktop demo with simulated hands.

## Deploy

Live build: https://shadowfolk.vercel.app

The Vercel project `shadowfolk` is connected to this GitHub repo. Each push to `main` deploys to production. Each push to another branch gets a preview URL. Build settings are in `vercel.json`. The install skips package scripts, because the web build does not need the native metavr binary.

To deploy by hand from a signed-in machine:

```bash
npm run deploy
```
