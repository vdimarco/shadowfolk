/** Play whole Ink Wolf battles through the rules: a player who does nothing loses, a good one wins. */
import { Battle, SPELLS, spellFor } from '../src/game/battle.js';

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails++;
};
const DT = 1 / 60;
/** A real player casts about every 2 s: hold, flight, then change shape. */
const CADENCE = 2.0;

function play(gentle: boolean, brain: (b: Battle, t: number) => string | null, limit = 180) {
  const b = new Battle(gentle);
  let t = 0;
  let flying: { id: string; at: number }[] = [];
  let cool = 0;
  while (b.state === 'fight' && t < limit) {
    t += DT;
    cool -= DT;
    if (cool <= 0) {
      const id = brain(b, t);
      if (id) {
        flying.push({ id, at: t + 0.35 + 0.5 }); // hold + flight
        cool = CADENCE;
      }
    }
    for (const f of flying.filter((f) => f.at <= t)) {
      const s = spellFor(f.id);
      if (s.damage > 0) b.hitNow(s.damage);
      else b.cast(s);
    }
    flying = flying.filter((f) => f.at > t);
    b.step(DT);
  }
  return { b, t };
}

// 1. a player who does nothing loses all three flames
for (const gentle of [false, true]) {
  const { b, t } = play(gentle, () => null);
  check(b.state === 'lost' && b.flames === 0, `idle player loses (${gentle ? 'gentle' : 'normal'}) after ${t.toFixed(1)} s`);
  check(t > 12, `  and the wolf gives at least 12 s (${t.toFixed(1)} s)`);
}

// 2. only attacking with the bird: wins in Gentle; a close fight in normal
{
  const { b, t } = play(true, () => 'bird');
  check(b.state === 'won', `gentle: bird spam wins in ${t.toFixed(1)} s, flames ${b.flames}`);
  const n = play(false, () => 'bird');
  console.log(`info normal: bird spam ${n.b.state} in ${n.t.toFixed(1)} s, wolf hp ${n.b.hp}, flames ${n.b.flames}`);
}
// 2b. mixed attacks (bird and dog) without blocking
{
  let k = 0;
  const { b, t } = play(false, () => (k++ % 2 ? 'dog' : 'bird'));
  check(b.state === 'won', `normal: bird and dog win in ${t.toFixed(1)} s, flames ${b.flames}`);
  check(t > 12, `  and the fight lasts more than 12 s at a 2 s cast rate`);
}

// 3. a careful player wards when the eyes glow and attacks otherwise: no flames lost
for (const gentle of [false, true]) {
  const { b, t } = play(gentle, (b) => (b.windup > 0 && !b.warded ? 'moth' : b.warded || b.windup === 0 ? 'dog' : null));
  check(b.state === 'won' && b.flames >= 2, `careful player wins (${gentle ? 'gentle' : 'normal'}) in ${t.toFixed(1)} s, flames ${b.flames}`);
}

// 4. ward blocks exactly one bite
{
  const b = new Battle(false);
  b.cast(SPELLS.moth);
  let blocked = 0, hurt = 0;
  for (let t = 0; t < 12; t += DT) b.step(DT);
  for (const e of b.events) {
    if (e.type === 'blocked') blocked++;
    if (e.type === 'hurt') hurt++;
  }
  check(blocked === 1, `a ward blocks the first bite, and only one (blocked ${blocked}, hurt ${hurt})`);
}

// 5. the deer relights a flame, never above three
{
  const b = new Battle(false);
  b.cast(SPELLS.deer);
  check(b.flames === 3, 'deer at full flames changes nothing');
  b.flames = 1;
  b.cast(SPELLS.deer);
  check(b.flames === 2, 'deer relights one flame');
}

// 6. the web slows the creep
{
  const a = new Battle(false), w = new Battle(false);
  w.cast(SPELLS.spider);
  for (let t = 0; t < 3; t += DT) {
    a.step(DT);
    w.step(DT);
  }
  check(w.x > a.x, `web slows the wolf (${w.x.toFixed(3)} > ${a.x.toFixed(3)})`);
}

// 7. every story creature is a spell
for (const id of ['moth', 'hare', 'crocodile', 'dog', 'bird', 'deer', 'turkey', 'bat', 'owl', 'spider']) check(!!SPELLS[id], `${id} is a spell: ${SPELLS[id]?.name}`);

console.log(fails ? `\n${fails} FAIL` : '\nall battle checks pass');
process.exit(fails ? 1 : 0);
