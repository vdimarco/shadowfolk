/** Chase rules checks: whole runs with scripted players. Run: npx tsx tools/test-chase.ts */
import { Chase, STAGES } from '../src/game/chase.js';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const DT = 1 / 72;

/** A player who makes the wanted shape after `react` seconds (or a share of the approach), and sometimes the wrong one. */
function play(c: Chase, react: (approach: number) => number, maxSec: number, wrongEvery = 0) {
  let t = 0;
  let seen = 0;
  let since = 0;
  let n = 0;
  const stageAt: number[] = [];
  while (t < maxSec && c.state !== 'won') {
    const o = c.obstacle;
    if (o && !o.result) {
      if (seen !== c.events.length && c.events[c.events.length - 1].type === 'spawn') {
        seen = c.events.length;
        since = 0;
        n++;
      }
      since += DT;
    }
    const wrong = wrongEvery > 0 && n % wrongEvery === 0;
    const making = o && !o.result && since >= react(o.approach) && !wrong ? c.wanted : null;
    const st = c.stage;
    c.step(DT, making);
    if (c.stage !== st) stageAt.push(t);
    t += DT;
  }
  return { t, stageAt };
}

// a quick player clears everything and escapes in about three minutes
{
  const c = new Chase(false);
  const r = play(c, () => 0.9, 400);
  check(c.state === 'won' && c.missed === 0, `quick player: ${c.state}, ${c.cleared} cleared, ${c.missed} missed, ${r.t.toFixed(0)} s (stages at ${r.stageAt.map((x) => x.toFixed(0)).join(', ')})`);
  check(r.t > 120 && r.t < 210, `the run takes ${r.t.toFixed(0)} s`);
  check(c.best >= 9, `best streak ${c.best}`);
}
// a player who reacts late (at 90% of the approach) still makes it, just
{
  const c = new Chase(false);
  const r = play(c, (a) => a * 0.9 - 0.3, 400);
  check(c.state === 'won', `late player: ${c.state}, ${c.cleared} cleared, ${c.missed} missed, ${r.t.toFixed(0)} s`);
}
// a player who misses every third obstacle gets caught sometimes but can still escape
{
  const c = new Chase(false);
  const r = play(c, () => 1.0, 900, 3);
  const caught = c.events.filter((e) => e.type === 'caught').length;
  check(c.state === 'won' && caught > 0, `player who misses every 3rd: ${c.state}, caught ${caught} times, ${r.t.toFixed(0)} s`);
}
// a player who does nothing is caught in the forest, again and again
{
  const c = new Chase(false);
  play(c, () => 1e9, 90);
  const caught = c.events.filter((e) => e.type === 'caught').length;
  check(c.stage === 0 && caught >= 2 && c.cleared === 0, `idle player: stage ${STAGES[c.stage].name}, caught ${caught} times`);
}
// gentle mode: slower obstacles and a longer lead
{
  const c = new Chase(true);
  check(c.lead === 5, `gentle lead ${c.lead}`);
  const r = play(c, (a) => a * 0.85, 600);
  check(c.state === 'won', `gentle late player: ${c.state}, ${c.missed} missed, ${r.t.toFixed(0)} s`);
}
// every stage uses each of its obstacle kinds, never the same one twice in a row
{
  const c = new Chase(false);
  const seq: string[] = [];
  const kindsByStage: string[][] = STAGES.map(() => []);
  let t = 0;
  let last = 0;
  while (t < 400 && c.state !== 'won') {
    c.step(DT, c.wanted);
    for (; last < c.events.length; last++) {
      const e = c.events[last];
      if (e.type === 'spawn') {
        seq.push(e.kind);
        kindsByStage[c.stage].push(e.kind);
      }
    }
    t += DT;
  }
  const repeats = kindsByStage.reduce((n, ks) => n + ks.filter((k, i) => i > 0 && ks[i - 1] === k).length, 0);
  check(repeats === 0, `no obstacle twice in a row within a stage (${seq.length} obstacles)`);
  check(STAGES.every((s, i) => s.kinds.every((k) => kindsByStage[i].includes(k))), 'each stage shows all of its kinds');
}
if (failures) process.exit(1);
console.log('\nall chase checks pass');
