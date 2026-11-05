/** Tiny synthesized sound set. No audio files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;

  /** Call from a user gesture (Enter VR click). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    this.startFire();
    // match hum: a soft tone that rises as the shape gets close
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc.frequency.value = 220;
    this.humOsc.connect(this.hum).connect(this.master);
    this.humOsc.start();
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }

  private startFire() {
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
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    // crackles
    const crackle = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') this.pop();
      setTimeout(crackle, 120 + Math.random() * 900);
    };
    crackle();
  }

  private pop() {
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
    g.gain.value = 0.04 + Math.random() * 0.06;
    n.connect(hp).connect(g).connect(this.master!);
    n.start();
  }

  /** Score 0..1 drives the hum. */
  setCloseness(score: number, threshold: number) {
    if (!this.ctx || !this.hum || !this.humOsc) return;
    const k = Math.max(0, Math.min(1, (score - (threshold - 0.25)) / 0.25));
    const t = this.ctx.currentTime;
    this.hum.gain.setTargetAtTime(k * 0.05, t, 0.1);
    this.humOsc.frequency.setTargetAtTime(196 + k * 98, t, 0.1);
  }

  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 1.7);
    });
  }

  tap() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 880;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.2);
  }
}
