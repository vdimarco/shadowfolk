/**
 * All sound is synthesized: a fire bed, a generative lullaby score, and
 * game cues that play in the score's current chord. No audio files.
 */

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** A slow progression in D major. Each chord: bass root, then pad and melody tones (MIDI). */
const CHORDS: { bass: number; pad: number[]; mel: number[] }[] = [
  { bass: 38, pad: [62, 66, 69, 73], mel: [74, 76, 78, 81, 85] }, // Dmaj7
  { bass: 35, pad: [59, 62, 66, 69], mel: [71, 74, 76, 78, 81] }, // Bm7
  { bass: 31, pad: [59, 62, 66, 67], mel: [71, 74, 78, 79, 83] }, // Gmaj7
  { bass: 33, pad: [61, 64, 67, 69], mel: [69, 73, 76, 79, 81] }, // A7sus feel
];
const CHORD_SECONDS = 8;

export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private wet: GainNode | null = null;
  private hum: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private nextChordAt = 0;
  private chordIndex = 0;
  private nextNoteAt = 0;
  private scheduler: number | null = null;
  private lastMel = -1;

  /** Call from a user gesture (Enter VR click). */
  start() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.init(new Ctx(), true);
  }

  /**
   * Render the score offline (no speakers), for checking it outside a headset.
   * Returns 16-bit stereo WAV bytes.
   */
  static async renderPreview(seconds: number): Promise<Uint8Array> {
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, sr * seconds, sr);
    const sfx = new Sfx();
    sfx.init(ctx, false);
    sfx.scheduleUntil(seconds);
    // a wake chime and a button tap partway through, to hear the cues in the music
    sfx.chimeAt(seconds * 0.45);
    sfx.tapAt(seconds * 0.7);
    const buf = await ctx.startRendering();
    return encodeWav(buf);
  }

  private init(ctx: BaseAudioContext, live: boolean) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // room: a generated reverb tail and a soft echo, shared by music and cues
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(verb).connect(this.master);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    dl.connect(this.wet);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.gain.setTargetAtTime(0.42, ctx.currentTime + 0.5, 2.5); // fade the score in
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.wet);
    this.musicBus.connect(delay);

    this.startFire(live);

    // match hum: a soft fifth that swells as the shape gets close
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc.frequency.value = midi(69);
    this.humOsc.connect(this.hum);
    this.hum.connect(this.master);
    this.hum.connect(this.wet);
    this.humOsc.start();

    this.nextChordAt = ctx.currentTime + 0.3;
    this.nextNoteAt = ctx.currentTime + 2.5;
    // schedule a little ahead, the usual Web Audio pattern
    if (live) this.scheduler = window.setInterval(() => this.schedule(), 200);
  }

  suspend() {
    void (this.ctx as AudioContext | null)?.suspend?.();
  }
  resume() {
    void (this.ctx as AudioContext | null)?.resume?.();
  }

  // ------------------------------------------------------------- the score

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.scheduleUntil(ctx.currentTime + 1.2);
  }

  private scheduleUntil(horizon: number) {
    while (this.nextChordAt < horizon) {
      this.playChord(this.nextChordAt, CHORDS[this.chordIndex]);
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.nextChordAt += CHORD_SECONDS;
    }
    while (this.nextNoteAt < horizon) {
      // the melody uses the chord that is sounding at that moment
      const chord = this.chordAt(this.nextNoteAt);
      this.playMusicBox(this.nextNoteAt, chord);
      // mostly gentle half-beats, sometimes a held breath
      const r = Math.random();
      this.nextNoteAt += r < 0.18 ? 2.25 : r < 0.6 ? 0.75 : 0.375;
    }
  }

  private chordAt(t: number) {
    const sinceNext = this.nextChordAt - t;
    const back = Math.ceil(sinceNext / CHORD_SECONDS);
    const i = (((this.chordIndex - back) % CHORDS.length) + CHORDS.length) % CHORDS.length;
    return CHORDS[i];
  }

  /** Warm pad: two slightly detuned voices per note, slow swell, low-passed. */
  private playChord(t: number, chord: (typeof CHORDS)[number]) {
    const ctx = this.ctx!;
    const end = t + CHORD_SECONDS + 2.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1300, t + CHORD_SECONDS * 0.5);
    lp.frequency.linearRampToValueAtTime(800, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 2.2);
    g.gain.setValueAtTime(0.11, t + CHORD_SECONDS - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(g).connect(this.musicBus!);
    for (const n of chord.pad) {
      for (const detune of [-2.5, 2.5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
    // soft bass root
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = midi(chord.bass);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.16, t + 0.6);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + CHORD_SECONDS);
    b.connect(bg).connect(this.musicBus!);
    b.start(t);
    b.stop(t + CHORD_SECONDS + 0.1);
  }

  /** Music box pluck: a sine with a bell overtone and a quick decay. */
  private playMusicBox(t: number, chord: (typeof CHORDS)[number]) {
    let i = Math.floor(Math.random() * chord.mel.length);
    // prefer small steps, like a hummed tune
    if (this.lastMel >= 0 && Math.random() < 0.7) i = Math.max(0, Math.min(chord.mel.length - 1, this.lastMel + (Math.random() < 0.5 ? -1 : 1)));
    this.lastMel = i;
    this.pluck(t, midi(chord.mel[i]), 0.07, this.musicBus!);
  }

  private pluck(t: number, f: number, amp: number, out: AudioNode) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    g.connect(out);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 4.07; // slightly inharmonic, like a tine
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.35, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o1.connect(g);
    o2.connect(g2).connect(g);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 2.3);
    o2.stop(t + 0.4);
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // ------------------------------------------------------------- fire

  private startFire(live: boolean) {
    const ctx = this.ctx!;
    // brown noise bed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    // crackles
    if (!live) {
      for (let t = 0.3; t < (this.ctx as OfflineAudioContext).length / this.ctx!.sampleRate; t += 0.16 + Math.random() * 1.1) this.pop(t);
      return;
    }
    const crackle = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') this.pop();
      setTimeout(crackle, 160 + Math.random() * 1100);
    };
    crackle();
  }

  private pop(at?: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    const b = ctx.createBuffer(1, 400, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 40);
    n.buffer = b;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    g.gain.value = 0.03 + Math.random() * 0.04;
    n.connect(hp).connect(g).connect(this.master!);
    n.start(at ?? ctx.currentTime);
  }

  // ------------------------------------------------------------- cues

  /** Score 0..1 drives the hum: the fifth of the current chord, swelling as you get close. */
  setCloseness(score: number, threshold: number) {
    if (!this.ctx || !this.hum || !this.humOsc) return;
    const k = Math.max(0, Math.min(1, (score - (threshold - 0.25)) / 0.25));
    const t = this.ctx.currentTime;
    const chord = this.chordAt(t);
    this.hum.gain.setTargetAtTime(k * 0.035, t, 0.15);
    this.humOsc.frequency.setTargetAtTime(midi(chord.pad[2] + (k > 0.8 ? 12 : 0)), t, 0.2);
  }

  /** The wake chime: a rising arpeggio in the chord that is playing now. */
  chime() {
    if (this.ctx) this.chimeAt(this.ctx.currentTime);
  }

  private chimeAt(t0: number) {
    if (!this.ctx) return;
    const chord = this.chordAt(t0);
    const notes = [chord.mel[0], chord.mel[1], chord.mel[2], chord.mel[0] + 12, chord.mel[2] + 12];
    notes.forEach((n, i) => this.pluck(t0 + i * 0.085, midi(n), 0.12, this.master!));
    notes.forEach((n, i) => this.pluck(t0 + i * 0.085, midi(n), 0.06, this.wet!));
  }

  tap() {
    if (this.ctx) this.tapAt(this.ctx.currentTime);
  }

  private tapAt(t: number) {
    if (!this.ctx) return;
    this.pluck(t, midi(this.chordAt(t).mel[3]), 0.08, this.master!);
  }

  dispose() {
    if (this.scheduler != null) clearInterval(this.scheduler);
    void (this.ctx as AudioContext | null)?.close?.();
    this.ctx = null;
  }
}

function encodeWav(buf: AudioBuffer): Uint8Array {
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) out.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return new Uint8Array(out.buffer);
}
