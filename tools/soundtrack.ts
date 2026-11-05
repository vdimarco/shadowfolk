/**
 * Build a WAV soundtrack that matches a capture: fire bed, room tone,
 * a chime on each creature wake, a tap on each button poke.
 * Run: npx tsx tools/soundtrack.ts <events.json> <out.wav>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [evPath, out] = process.argv.slice(2);
const { fps, frames, events } = JSON.parse(readFileSync(evPath, 'utf8')) as {
  fps: number; frames: number; events: { t: number; type: string }[];
};
const SR = 44100;
const len = Math.ceil((frames / fps + 0.5) * SR);
const L = new Float32Array(len);
const R = new Float32Array(len);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

// fire bed: brown noise through a gentle low-pass, stereo decorrelated
let bl = 0, br = 0, lpL = 0, lpR = 0;
for (let i = 0; i < len; i++) {
  bl = (bl + 0.02 * rnd()) / 1.02;
  br = (br + 0.02 * rnd()) / 1.02;
  lpL += (bl * 3 - lpL) * 0.06;
  lpR += (br * 3 - lpR) * 0.06;
  L[i] += lpL * 0.22;
  R[i] += lpR * 0.22;
}
// crackles
let t = 0.3;
while (t < len / SR) {
  const at = Math.floor(t * SR);
  const amp = 0.05 + Math.random() * 0.12;
  const pan = Math.random();
  const decay = 25 + Math.random() * 60;
  let hp = 0, prev = 0;
  for (let k = 0; k < 900 && at + k < len; k++) {
    const n = rnd() * Math.exp(-k / decay);
    hp = 0.85 * (hp + n - prev);
    prev = n;
    L[at + k] += hp * amp * (1 - pan);
    R[at + k] += hp * amp * pan;
  }
  t += 0.08 + Math.random() * 0.7;
}
// low room tone: two soft sine drones
for (let i = 0; i < len; i++) {
  const s = i / SR;
  const fade = Math.min(1, s / 3) * Math.min(1, (len / SR - s) / 2);
  const v = (Math.sin(2 * Math.PI * 110 * s) * 0.5 + Math.sin(2 * Math.PI * 164.8 * s + Math.sin(s * 0.3)) * 0.35) * 0.025 * fade;
  L[i] += v;
  R[i] += v;
}
function tone(at: number, f: number, amp: number, dur: number, pan = 0.5) {
  const a = Math.floor(at * SR);
  for (let k = 0; k < dur * SR && a + k < len; k++) {
    const s = k / SR;
    const env = Math.min(1, s / 0.015) * Math.exp(-s * 2.6);
    // triangle wave
    const ph = (f * s) % 1;
    const tri = 4 * Math.abs(ph - 0.5) - 1;
    L[a + k] += tri * env * amp * (1 - pan);
    R[a + k] += tri * env * amp * pan;
  }
}
for (const e of events) {
  if (e.type === 'chime') {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(e.t + i * 0.09, f, 0.16, 1.8, 0.35 + i * 0.1));
  } else if (e.type === 'tap') {
    tone(e.t, 880, 0.18, 0.18);
  }
}
// normalize gently and write 16-bit stereo WAV
let peak = 0;
for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0.89 ? 0.89 / peak : 1;
const buf = Buffer.alloc(44 + len * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(len * 4, 40);
for (let i = 0; i < len; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`wrote ${out}: ${(len / SR).toFixed(1)}s, ${events.length} cues`);
