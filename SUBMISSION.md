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

Hand shadow puppets are one of the oldest games people play with their hands. You need a lamp, a wall, and nothing else. Hand tracking on Quest gives us the same thing: 25 joints per hand, every frame. We wanted a game where your hands are not a pointer or a controller stand-in. Your hands are the game.

### What it is

You sit in front of a paper screen in a dark room. A lamp is behind you. When you lift your hands, their shadows fall on the paper, with soft edges that grow when your hands move closer to the lamp. A golden line on the paper shows the shape of a sleeping creature. Make that shape with your hands, hold it, and the creature wakes up: the moth flutters to the lamp, the hare hops away, the bird flies into the night.

Ten story shadows in two chapters teach the classic shapes, from one open hand to two-hand creatures. If you get stuck, a faint golden hand appears at the spot where your hand should go, already in the right pose, and you put your hand inside it. When a creature wakes, a glowing eye opens on its shadow. Chapter three turns the shadow solid: in shadow puzzles you make a slide with your hand to guide rain into a cup, and you herd fireflies, which flee from shadow, into a jar. After the story, a new shadow comes each day, and the Shadow Book keeps your collection and your daily streak.

### How we built it

- WebXR with the Immersive Web SDK (IWSDK), so it runs in the Quest browser with no install.
- Each hand becomes 28 capsules built from the joint poses. We project each capsule from the lamp onto the wall, with a penumbra from the flame size. A small shader paints this into a texture each frame.
- The same projected shapes go to a CPU matcher. It compares your shadow with the target and ignores position and size, so you can make the shape anywhere on the paper. It also accepts the mirrored shape, so left-handed players get the same game.
- Every target is built from a pose model of a real hand, so every level is a shape a hand can make. Tests check that each level matches itself, matches when moved or mirrored, and rejects the other levels.
- No art files. The paper, the light, and the sounds (fire crackle, a hum that rises as you get close, a chime when the creature wakes) are all code.

### Design for the competition guidelines

- Hands-first: the full game, from start to the daily shadow, uses hands only. The three buttons are brass buttons you poke on a tray in front of you.
- Seated: every interaction is within a two-foot radius of your chest.
- Short sessions: the first shadow appears on the paper in the first seconds. One creature takes about a minute. Progress saves on each creature, so you can stop at any time.
- Accessibility: no time limits, mirror-free matching for either hand, one-hand play for every two-hand shape in Gentle mode, a guide hand that shows each pose in place, and a Gentle mode that lowers the match level, shows the guide hand sooner, and switches to a high-contrast paper.

### What is next

Already in: a free play mode after the story, where any shadow from your Book wakes its creature.

- More story chapters with new creatures and two-player shadow plays.
- Shared daily shadow board for friends.
- Meta VR Glasses support with a pinch-only mode.

## Hand interactions (optional field)

Shadowfolk reads all 25 joints of each hand from WebXR Hand Input each frame. The hands are the only input: shapes come from finger curl, finger spread, and wrist turn, and buttons are poked with a fingertip. What excites us about the future of VR is input that feels like play from the first second. You do not learn Shadowfolk. You already know how to make a shadow rabbit.

## Target launch date

TODO (your call). The web build is already live, and the manifest, icons and auto-enter VR are ready for packaging. A suggestion: open web release at judging time, then the Meta Horizon Store as a packaged web app in early 2027.

## Team

TODO: name, email, role for each member.

## Links

- Playable build: https://shadowfolk.vercel.app
- Send it to a Quest from any phone or computer: https://shadowfolk.vercel.app/quest (Meta Web Launch)
- Video: TODO (paste the public YouTube link)

## Video plan (under 3 minutes, best part first)

1. 0:00 to 0:15: Your hand rises into the lamplight. The shadow falls on the paper. Title.
2. 0:15 to 0:50: The hare. The golden guide, the meter fills, the hare wakes and hops away.
3. 0:50 to 1:30: Crocodile and dog, then the two-hand bird flying off.
4. 1:30 to 2:00: The Shadow Book and the daily shadow with streak.
5. 2:00 to 2:30: Gentle mode, high contrast, left-hand mirror play.
6. 2:30 to 2:50: Close on the paper. "A new shadow wakes each day."

Record on a Quest 3 with the system recorder (Meta button, Camera, Record video), or in the IWER emulator in a desktop browser.

## YouTube upload text

Title:

Shadowfolk: a hands-only shadow puppet game for Meta Quest (Meta VR Start 2026)

Description:

Shadowfolk is a seated, hands-only VR game for Meta Quest. A lamp is behind you, and your real hands cast soft shadows on a paper screen. Make the shape of each sleeping creature and it wakes up: a starfish, a hare, a crocodile, a dog, a bird, a deer, a turkey, a bat, an owl and a spider. After the story, a new shadow wakes every day.

- No controllers. Every action uses hand tracking.
- Seated play, within a two-foot radius.
- Gentle mode: easier matching and high-contrast paper. Either hand works.

Play in the Meta Quest Browser: https://shadowfolk.vercel.app
Source: https://github.com/vdimarco/shadowfolk

Built with the Immersive Web SDK (WebXR) for the Meta VR Start Developer Competition 2026. The gameplay was captured in a desktop browser with simulated hand poses.

Visibility: Public. Category: Gaming.

To rebuild the video: make two 5-second 16:9 opening shots, then run `npm run build`, serve `dist/` with `npx vite preview --port 4173`, then run `npx tsx tools/capture-video.ts https://localhost:4173/ <frames-dir>` then `npx tsx tools/render-score.mts https://localhost:4173/ <frames-dir>/events.json 8.6 <seconds> score.wav` for the game's own score, and `python3 tools/assemble-video.py shotA.mp4 shotB.mp4 <frames-dir> out.mp4 score.wav`.
