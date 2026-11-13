/** Hand music checks with a silent sound engine. Run: npx tsx tools/test-music.ts */
import type { Instrument, Sfx } from '../src/game/audio.js';
import { degreeFor, HandMusic, instrumentFor } from '../src/game/music.js';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const played: { inst: Instrument; degree: number; delay: number }[] = [];
let drops = 0;
const sfx = { note: (inst: Instrument, degree: number, delay = 0) => played.push({ inst, degree, delay }), toBeat: () => 0.1, dropBar: () => drops++ } as unknown as Sfx;

check(degreeFor(-0.45) === 0 && degreeFor(-0.06) === 9 && degreeFor(-0.24) === 5, `hand height to note: low 0, high 9, middle ${degreeFor(-0.24)}`);
check(instrumentFor('hare') === 'harp' && instrumentFor('stone') === 'bigdrum' && instrumentFor('daily-12') === 'harp', 'each shape has its instrument; daily shadows play the harp');

// playing by hand: a note when the shape starts, then one per new height, never faster than about 6 a second
{
  const m = new HandMusic(sfx);
  played.length = 0;
  let t = 0;
  for (let i = 0; i < 120; i++, t += 1 / 60) m.play(t, 'flute', -0.42 + (i / 120) * 0.36);
  check(played.length >= 6 && played.length <= 13 && played.every((p) => p.inst === 'flute'), `a hand rising over 2 s plays ${played.length} flute notes, ${played.map((p) => p.degree).join(' ')}`);
  const n = played.length;
  for (let i = 0; i < 60; i++, t += 1 / 60) m.play(t, 'flute', -0.06);
  check(played.length === n, 'a still hand plays no more notes');
  for (let i = 0; i < 30; i++, t += 1 / 60) m.play(t, null, -0.2);
  check(played.length === n, 'no shape, no notes');
}
// the chase: clears build a looping tune on the beat; a miss drops it
{
  const m = new HandMusic(sfx);
  played.length = 0;
  const every = 0.25;
  let t = 0;
  const tick = (sec: number) => {
    for (let i = 0; i < sec * 60; i++, t += 1 / 60) m.tick(t, every);
  };
  m.add(t, { inst: 'harp', degree: 2 }, every);
  tick(2);
  m.add(t, { inst: 'marimba', degree: 4 }, every);
  tick(2);
  m.add(t, { inst: 'flute', degree: 7 }, every);
  tick(2);
  const insts = new Set(played.map((p) => p.inst));
  check(m.phrase.length === 3 && insts.size === 3 && played.every((p) => p.delay === 0.1), `three clears make a 3-note tune that loops on the beat (${played.length} notes)`);
  m.drop(t);
  const n = played.length;
  tick(2);
  check(played.length === n && drops === 1 && m.phrase.length === 0, 'a miss drops the tune and the drums for a bar');
}
if (failures) process.exit(1);
console.log('\nall music checks pass');
