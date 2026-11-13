/**
 * Music from the hands. Each shadow has its own instrument, and the height
 * of the hand picks the note (always in key: the D major pentatonic of the
 * score). In the chase, every cleared obstacle adds its creature's note to a
 * tune that loops over the drums; a miss drops the tune and the drums for a bar.
 */
import type { Instrument, Sfx } from './audio.js';

export const INSTRUMENTS: Record<string, Instrument> = {
  hare: 'harp',
  bird: 'flute',
  crocodile: 'marimba',
  dog: 'drum',
  deer: 'horn',
  moth: 'bells',
  stone: 'bigdrum',
};

/** A creature's instrument (the daily shadows play the harp). */
export function instrumentFor(id: string): Instrument {
  return INSTRUMENTS[id] ?? 'harp';
}

/** Hand height (theater y of the palm, meters) to a note: 0 (low, about the lap) to 9 (high, about the chin). */
export function degreeFor(y: number): number {
  return Math.max(0, Math.min(9, Math.round(((y + 0.42) / 0.36) * 9)));
}

export interface Note {
  inst: Instrument;
  degree: number;
}

export class HandMusic {
  /** Every note played, in game seconds, for the video's soundtrack: 'note:<instrument>:<degree>'. */
  readonly log: { t: number; type: string }[] = [];
  /** The chase tune: the last notes cleared, looped over the drums. */
  readonly phrase: Note[] = [];
  private inst: Instrument | null = null;
  private degree = -1;
  private last = -1e9;
  private loopAt = 0;
  private loopIndex = 0;

  constructor(private sfx: Sfx) {}

  /**
   * Playing by hand: call every frame with the instrument of the shape the
   * player is making (null when none) and the hand's height. A note sounds
   * when the shape starts and each time the hand moves to a new note.
   */
  play(time: number, inst: Instrument | null, handY: number) {
    if (!inst) {
      this.inst = null;
      this.degree = -1;
      return;
    }
    const d = degreeFor(handY);
    if (inst !== this.inst || (d !== this.degree && time - this.last > 0.16)) {
      this.note(time, inst, d);
      this.inst = inst;
      this.degree = d;
      this.last = time;
    }
  }

  /** Play one note now, or on the next drum step. */
  note(time: number, inst: Instrument, degree: number, onBeat = false) {
    const delay = onBeat ? this.sfx.toBeat() : 0;
    this.sfx.note(inst, degree, delay);
    this.log.push({ t: time + delay, type: `note:${inst}:${degree}` });
  }

  /** A creature wakes: three rising notes of its instrument from the hand's note. */
  motif(time: number, inst: Instrument, degree: number) {
    [0, 2, 4].forEach((step, i) => {
      const d = Math.min(9, degree + step);
      const delay = i * 0.14;
      this.sfx.note(inst, d, delay);
      this.log.push({ t: time + delay, type: `note:${inst}:${d}` });
    });
  }

  /** The chase: a cleared obstacle adds its note to the tune, and plays it on the beat. */
  add(time: number, n: Note, every: number) {
    this.phrase.push(n);
    if (this.phrase.length > 8) this.phrase.shift();
    this.note(time, n.inst, n.degree, true);
    // the loop picks up two steps later
    this.loopAt = Math.max(this.loopAt, time + every * 2);
  }

  /** A miss: the tune is gone, and the drums drop out for a bar. */
  drop(time: number) {
    this.phrase.length = 0;
    this.loopIndex = 0;
    this.sfx.dropBar();
    this.log.push({ t: time, type: 'drop' });
  }

  /** Loop the tune: one of its notes on every other drum step. Call every frame during the chase. */
  tick(time: number, every: number) {
    if (!this.phrase.length || time < this.loopAt) return;
    const n = this.phrase[this.loopIndex % this.phrase.length];
    this.loopIndex++;
    this.note(time, n.inst, n.degree, true);
    this.loopAt = time + every * 2;
  }

  reset() {
    this.phrase.length = 0;
    this.loopIndex = 0;
    this.inst = null;
    this.degree = -1;
  }
}
