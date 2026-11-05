# Shadowfolk

A seated, hands-only VR game for Meta Quest. You sit in front of a paper screen. A lamp is behind you. Your real hands cast soft shadows on the paper. Make the shape of each shadow creature and it wakes up and leaves the screen.

Built with the Immersive Web SDK (IWSDK) for WebXR. Entry for the Meta VR Start Developer Competition 2026: Gaming track, New Experience division.

## Play

1. Open the hosted link in the Meta Quest Browser.
2. Pinch "Enter Shadowfolk".
3. Sit back and lift a hand into the light.

No controllers. Every action uses hands:

- Make a shape: hold your hands between your head and the paper.
- Press a button: poke one of the three brass buttons on the tray below you with a fingertip.
  - **Book**: shows the creatures you found.
  - **Gentle**: lowers the match level and raises the contrast.
  - **Skip / Next / Daily**: moves on.

## How it works

- `src/game/hand-model.ts`: the 25 WebXR hand joints, and a pose model that builds joints from finger curl and splay. The levels use it, so each target shape is a shape a real hand can make.
- `src/game/silhouette.ts`: turns each hand into 28 capsules, projects them from the lamp onto the wall, and gives each edge a soft penumbra. The same 2D data drives the GPU shadow and the CPU shape matcher.
- The matcher compares your shadow with the target. It ignores position and size, and it accepts mirrored shapes, so left-handed players get the same game.
- `src/game/theater.ts`: the paper wall shader, the room, and the button tray.
- `src/game/game-system.ts`: hand tracking, game states, the creature animations, and the Shadow Book.
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

`npm run build` writes a static site to `dist/`. Host it on any HTTPS static host (GitHub Pages, Vercel). WebXR needs HTTPS.
