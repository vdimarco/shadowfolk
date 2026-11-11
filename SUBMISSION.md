# Devpost submission draft

Fields marked TODO need your input.

## Name

Shadowfolk

## Tagline (140 characters max)

Your real hands cast shadows on a paper screen. Make the right shape and the shadow comes alive. Seated, hands-only, a new shadow each day.

(137 characters)

## Track and division

- Track: Gaming
- Division: New Experience (all code written from November 5, 2026, inside the competition window)

## Description

### Inspiration

Hand shadow puppets are one of the oldest games people play with their hands: a lamp, a wall, and nothing else. Quest hand tracking gives us 25 joints per hand, every frame. We wanted a game where your hands are not a pointer or a controller stand-in. Your hands are the game.

### What it is

You sit in an open-air shadow theater on a starry night, with a lamp behind you, a moon over the pines, paper lanterns, and fireflies in the dark. Lift your hands, and their soft shadows fall on the paper. A golden line shows a sleeping creature. Make that shape, hold it, and the creature wakes: its eye opens, and the hare hops away, the crocodile slides down the river, the bird flies into the night.

- Ten story shadows in two chapters teach the classic shapes, from one open hand to two-hand creatures.
- Stuck? A glowing golden hand appears on your own wrist, already in the pose, so you only turn your hand and set your fingers to match.
- Chapter three makes your shadow solid. Hold your hand and arm as a slide to guide rain into a cup, and herd fireflies, which flee from shadow, into a jar.
- Chapter four is a spell battle. Every creature you have woken is a spell. Make its shape and it flies across the paper at the Ink Wolf, which creeps toward your three lamp flames. Birds, bats and owls swoop, the dog and crocodile hit twice as hard, the starfish raises a ward, the spider's web slows the wolf, and the deer relights a flame. The wolf's eyes glow red before it bites, so you have time to block.
- After the story, a new shadow wakes every day. The Shadow Book keeps your collection and your daily streak, and free play lets any shadow you know wake its creature.

### How we built it

- WebXR with the Immersive Web SDK, so it runs in the Quest browser with no install.
- Each hand becomes 32 capsules (finger bones, palm, thumb web, forearm), projected from the lamp onto the wall with a penumbra from the flame size, and drawn as instanced quads into a high-resolution shadow texture.
- A CPU matcher compares your shadow with the target. It ignores position and size, so you can make the shape anywhere, and it accepts the mirrored shape for left-handed players.
- Every target comes from a pose model of a real hand. Tests check that each shape matches itself, matches when moved or mirrored, and rejects every other shape. Puzzle tests drive the physics with drawn shadows, and battle tests play whole fights: a player who does nothing loses, a careful one wins.
- The battle uses the same matcher on every creature in your Shadow Book at once, so any known shape is a spell. The wolf is drawn as capsules straight onto the paper, in the same shadow pass as your hands.
- No art or audio files. The paper, the night sky, the light, and a generative lullaby score with chimes in the current chord are all code. In the battle, a frame-drum pulse joins the score.

### Design for the guidelines

- Hands-first: the whole game uses hands only. The three buttons are brass buttons you poke on a tray.
- Seated: every interaction is within a two-foot radius of your chest.
- Short sessions: your shadow appears in the first seconds, a creature takes about a minute, and progress saves on each one.
- Accessibility: no time limits outside the battle (and the battle can be skipped), either hand works, the guide shows each pose on your hand, and Gentle mode lowers the match level, accepts one hand for two-hand shapes, and switches to high-contrast paper.

### What is next

- More chapters, and two-player shadow plays.
- A shared daily shadow board for friends.
- Meta VR Glasses support with a pinch-only mode.

## Hand interactions (optional field)

Shadowfolk reads all 25 joints of each hand from WebXR Hand Input each frame. The hands are the only input: shapes come from finger curl, finger spread, and wrist turn; in the puzzles your hand and arm shadow is a solid slide or a wall; in the battle each shape you know is a spell; and buttons are poked with a fingertip. What excites us about the future of VR is input that feels like play from the first second. You do not learn Shadowfolk. You already know how to make a shadow rabbit.

## Target launch date

TODO (your call). The web build is already live, and the manifest, icons and auto-enter VR are ready for packaging. A suggestion: open web release at judging time, then the Meta Horizon Store as a packaged web app in early 2027.

## Team

TODO: name, email, role for each member.

## Links

- Playable build: https://shadowfolk.vercel.app
- Send it to a Quest from any phone or computer: https://shadowfolk.vercel.app/quest (Meta Web Launch)
- Video: https://youtu.be/hYi-IIQHwPE

## Built with (tags)

webxr, immersive-web-sdk, three.js, typescript, vite, hand-tracking, meta-quest, web-audio, vercel

## Image gallery

Use the images in `submission/`: `thumbnail.jpg` (3:2) as the project thumbnail, then `gallery-1.jpg` to `gallery-6.jpg` in order.

## YouTube upload text

Title:

Shadowfolk: a hands-only shadow puppet game for Meta Quest (Meta VR Start 2026)

Description:

Shadowfolk is a seated, hands-only VR game for Meta Quest. A lamp is behind you, and your real hands cast soft shadows on a paper screen. Make the shape of each sleeping creature and it wakes up: a starfish, a hare, a crocodile, a dog, a bird, a deer, a turkey, a bat, an owl and a spider. Then your shadow becomes solid for puzzles, and every creature becomes a spell in a battle against the Ink Wolf. After the story, a new shadow wakes every day.

- No controllers. Every action uses hand tracking.
- Seated play, within a two-foot radius.
- Gentle mode: easier matching and high-contrast paper. Either hand works.

Play in the Meta Quest Browser: https://shadowfolk.vercel.app
Source: https://github.com/vdimarco/shadowfolk

Built with the Immersive Web SDK (WebXR) for the Meta VR Start Developer Competition 2026. The gameplay was recorded in IWER, the WebXR emulator in Meta's Immersive Web SDK, as an emulated Meta Quest 3 with scripted hand poses.

Visibility: Public. Category: Gaming.

To rebuild the video: make two 5-second 16:9 opening shots, then run `npm run build`, serve `dist/` with `npx vite preview --port 4173`, then run `XR=1 npx tsx tools/capture-video.ts https://localhost:4173/ <frames-dir>` (XR=1 records inside the IWER emulator) then `npx tsx tools/render-score.mts https://localhost:4173/ <frames-dir>/events.json 8.6 <seconds> score.wav` for the game's own score, and `python3 tools/assemble-video.py shotA.mp4 shotB.mp4 <frames-dir> out.mp4 score.wav`.
