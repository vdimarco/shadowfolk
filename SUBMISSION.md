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

- Six story shadows teach the classic shapes that everyone can read: an open hand, a rabbit, a crocodile, a dog, a bird and a stag.
- Stuck? A glowing golden hand appears on your own wrist, already in the pose, so you only turn your hand and set your fingers to match.
- Then the Ink Wolf gives chase. The paper scrolls through a forest, a river, cliffs and a storm while the wolf runs behind you. Obstacles rush in, and each needs the right shadow before it hits: the hare leaps a log, the crocodile swims a river, the bird flies a gap, the dog barks away bats, the deer parts thorns, the starfish shines away the darkness, and a fist smashes a boulder. Miss one and the wolf gains; three in a row and you pull ahead. Five stages, each faster than the last.
- After the story, the shadow tools puzzles make your shadow solid, and each hand shape is a tool: a flat hand is a slide, a cupped hand is a bowl that catches rain and pours it, spread fingers are a sieve that lets rain through but stops pearls, and a fist is a stone that knocks ice loose. Each puzzle allows only some tools; any other shape casts a faint ghost shadow that things fall through. Six puzzles: guide rain, carry it in your hand, herd fireflies, sort pearls from rain, free a frozen cloud, and grow a moon flower with every tool at once.
- At the top of the cliff, the wolf turns to fight: a spell battle. Every creature you have woken is a spell. Make its shape and it flies across the paper at the Ink Wolf, which creeps toward your three lamp flames. Birds and hares swoop, the dog and crocodile hit twice as hard, the starfish raises a ward, and the deer relights a flame. The wolf's eyes glow red before it bites, so you have time to block.
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

## Devpost story (paste into "About the project")

Devpost asks for these seven headings. Paste this block as it is.

```markdown
## Inspiration

Hand shadow puppets are one of the oldest games people play with their hands: a lamp, a wall, and nothing else. Quest hand tracking gives us 25 joints per hand, every frame. We wanted a game where your hands are not a pointer or a stand-in for a controller. Your hands are the game.

## What it does

You sit in an open-air shadow theater on a starry night. A lamp is behind you. Lift your hands, and their soft shadows fall on a paper screen. A golden line shows a sleeping creature. Make that shape and hold it, and the creature wakes: its eye opens, and the hare hops away, the crocodile slides off, the bird flies into the night.

- **Chapter one:** six story shadows teach the classic shapes, from one open hand to the two-hand bird and stag.
- **Help when you are stuck:** a golden hand appears on your own wrist, already in the pose.
- **Chapter two, the Chase:** the Ink Wolf hunts you across the paper through five faster and faster stages. Every obstacle needs the right shadow before it hits. Miss, and the wolf gains on you.
- **After the story, shadow tools:** your shadow becomes solid, and each hand shape is a tool. A flat hand is a slide, a cupped hand is a bowl that carries rain, spread fingers are a sieve for pearls, and a fist is a stone that knocks ice loose. Each puzzle allows only some tools, so the puzzle is choosing the right shape.
- **Chapter three, the Ink Wolf:** every creature you have woken is now a spell. Make its shape and it flies at a wolf made of ink that creeps toward your three lamp flames. The dog and crocodile hit hard, the starfish blocks a bite, and the deer lights a flame again. The wolf's eyes glow red before it bites, so you have time to block.
- **Every day:** a new shadow wakes. The Shadow Book keeps your collection and your streak, and free play lets any shadow you know wake its creature.

## How we built it

- WebXR with Meta's Immersive Web SDK and Three.js, in TypeScript. It runs in the Quest Browser with no install.
- Each hand becomes 32 capsules (finger bones, palm, thumb web, forearm). We project them from the lamp onto the paper, with a soft edge from the flame size, and draw them as instanced quads into a high-resolution shadow texture.
- A matcher compares your shadow with each target. It ignores position and size, and it accepts the mirrored shape for left-handed players. In the battle, it checks every creature in your Shadow Book at once, so any shape you know is a spell.
- Every target comes from a pose model of a real hand.
- No art or audio files: the paper, the night sky, the light, and a generative lullaby score with a frame-drum pulse in the battle are all code.

## Challenges we ran into

- **Making every shape possible for a real hand.** Our first dog needed a pinky bent further than any hand can bend. We rebuilt every target from a model of real joints, and tests now check that each shape matches itself and rejects all the others.
- **Shadow quality on the headset.** Our first shadows looked soft and blotchy on Quest. We moved to one small instanced quad per capsule and multiplied the light, so overlaps join with no seams at full resolution.
- **A guide that maps to your hand.** A golden hand in the middle of the room did not help. Now the guide sits on your own wrist, so only your fingers and the turn of your hand need to change.
- **Puzzle physics on a shadow.** Raindrops stuck to the shadow's edge. They now slide along the surface, and a speed limit keeps them from shooting past the cup.

## Accomplishments that we're proud of

- The game is fully hands-only and seated. There are no controllers, and even the menu buttons are brass buttons you poke.
- Shapes, puzzles and battles all have automatic tests. A player who does nothing loses to the wolf, and a careful player wins.
- Gentle mode lowers the match level, accepts one hand for two-hand shapes, and switches to high-contrast paper.

## What we learned

- Hand tracking is the most natural input when the game asks for something people already know how to do.
- A shape is only fair if a real hand can make it, so the targets must come from real joint limits.
- Help works best right where your attention already is: on your hand, and on the paper.

## What's next for Shadowfolk

- More chapters and more creatures, and a two-player shadow play.
- A shared daily shadow board for friends.
- Meta VR Glasses support with a pinch-only mode.
- A release on the Meta Horizon Store as a packaged web app.
```

## Describe how Hand Interactions are implemented into your experience

```
Shadowfolk uses hand tracking as its only input. There are no controllers and no pinch menus.

How it works: each frame, the game reads all 25 joints of both hands from WebXR Hand Input. It turns each hand and forearm into 32 capsules, projects them from a virtual lamp onto a paper screen, and draws the soft shadow in real time. A matcher compares that shadow with the target shape. It ignores position and size, and it accepts the mirrored shape, so either hand works.

How the hands are used:
- Shapes: finger curl, finger spread and wrist turn make 6 classic hand shadows (one-hand and two-hand). Hold a shape for less than a second and the creature wakes.
- Guidance: when a player is stuck, a golden hand model appears on their own wrist, already in the pose, so they only change their fingers and the turn of their hand.
- Puzzles: the hand-and-arm shadow becomes solid, and the game reads each hand's shape from its joints as one of four tools: flat hand (slide), cupped hand (bowl; turn the palm down to pour), spread fingers (sieve), fist (stone). A shape the puzzle does not allow casts a ghost shadow that is not solid.
- Chase: the same shapes, under time pressure. Each obstacle names the shape it needs and shows its outline, and the player has a few seconds to make it. A fist is read from the hand's joints.
- Battle: every shape the player knows is a spell. Making a shape casts it at the Ink Wolf. The starfish blocks and the deer heals.
- Buttons: three brass buttons on a tray within easy reach of a seated player. You poke them with a fingertip.

Comfort and access: everything is seated, within about two feet of the chest. Gentle mode lowers the match level, accepts one hand for two-hand shapes, and uses high-contrast paper.
```

## What Meta VR capability(ies) did you use in your project?

```
Hand tracking (all 25 joints per hand through WebXR Hand Input), Meta Immersive Web SDK (IWSDK) for WebXR, Meta Quest Browser immersive VR sessions, IWER (the IWSDK WebXR emulator) for testing and recording, Meta Web Launch (send the game from a phone or computer to a Quest), and a Horizon OS web app build (Trusted Web Activity) shared on a Meta release channel.
```

## What makes you excited about the future of VR? (150 words or less)

```
VR is starting to understand people as they are, not as controllers. With hand tracking, the oldest skills we have become input: pointing, poking, shaping, playing. Shadowfolk works because nobody has to learn it. A child, a grandparent or a first-time headset user already knows how to make a shadow rabbit, and the headset now knows it too.

We are excited for VR that asks less of people and gives more back: games that you can play seated in a few minutes, that welcome different bodies and abilities, and that run from a simple link with no install. As hand and body tracking get more precise, and as headsets and glasses get lighter, we think the best VR will feel less like technology and more like play you already know.
```

## What is the target launch date for your app? (suggested answer)

```
Shadowfolk is already playable as a web app in the Meta Quest Browser (shadowfolk.vercel.app) and as a Horizon OS app on a Meta release channel. Our target for a public Meta Horizon Store launch is February 2027.
```

## Hand interactions (optional field)

Shadowfolk reads all 25 joints of each hand from WebXR Hand Input each frame. The hands are the only input: shapes come from finger curl, finger spread, and wrist turn; in the puzzles each hand shape is a tool (a slide, a bowl, a sieve or a stone); in the battle each shape you know is a spell; and buttons are poked with a fingertip. What excites us about the future of VR is input that feels like play from the first second. You do not learn Shadowfolk. You already know how to make a shadow rabbit.

## Target launch date

TODO (your call). The web build is already live, and the manifest, icons and auto-enter VR are ready for packaging. A suggestion: open web release at judging time, then the Meta Horizon Store as a packaged web app in early 2027.

## Team

TODO: name, email, role for each member.

## Links

- Playable build: https://shadowfolk.vercel.app
- Send it to a Quest from any phone or computer: https://shadowfolk.vercel.app/quest (Meta Web Launch)
- Video: https://youtu.be/hYi-IIQHwPE
- Meta VR competition release channel: https://www.meta.com/s/8Q43XSCZ7

## Built with (tags)

webxr, immersive-web-sdk, three.js, typescript, vite, hand-tracking, meta-quest, web-audio, vercel

## Image gallery

Use the images in `submission/`: `thumbnail.jpg` (3:2) as the project thumbnail, then `gallery-1.jpg` to `gallery-8.jpg` in order.

## YouTube upload text

Title:

Shadowfolk: a hands-only shadow puppet game for Meta Quest (Meta VR Start 2026)

Description:

Shadowfolk is a seated, hands-only VR game for Meta Quest. A lamp is behind you, and your real hands cast soft shadows on a paper screen. Make the shape of each sleeping creature and it wakes up: a starfish, a hare, a crocodile, a dog, a bird and a deer. Then the Ink Wolf chases you across the paper: make the right shadow before each obstacle hits. At the top of the cliff, every creature becomes a spell in a battle against the wolf. After the story, puzzles turn each hand shape into a tool. After the story, a new shadow wakes every day.

- No controllers. Every action uses hand tracking.
- Seated play, within a two-foot radius.
- Gentle mode: easier matching and high-contrast paper. Either hand works.

Play in the Meta Quest Browser: https://shadowfolk.vercel.app
Source: https://github.com/vdimarco/shadowfolk

Built with the Immersive Web SDK (WebXR) for the Meta VR Start Developer Competition 2026. The gameplay was recorded in IWER, the WebXR emulator in Meta's Immersive Web SDK, as an emulated Meta Quest 3 with scripted hand poses. The 13-second opening was animated with AI (Higgsfield) from frames rendered in the game; everything after it is real gameplay.

Visibility: Public. Category: Gaming.

To rebuild the video: render the start frames with `npx tsx tools/store-art.ts https://localhost:4173/ <dir> film`, animate each into a 5-second 16:9 shot with Higgsfield (Gemini Omni Flash, image-to-video), then run `npm run build`, serve `dist/` with `npx vite preview --port 4173`, then run `XR=1 npx tsx tools/capture-video.ts https://localhost:4173/ <frames-dir>` (XR=1 records inside the IWER emulator) then `npx tsx tools/render-score.mts https://localhost:4173/ <frames-dir>/events.json 13.0 <seconds> score.wav` for the game's own score, and `python3 tools/assemble-video.py shotA.mp4 shotB.mp4 shotC.mp4 <frames-dir> out.mp4 score.wav`.
