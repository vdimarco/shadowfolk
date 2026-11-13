export interface Progress {
  level: number;
  found: string[];
  gentle: boolean;
  dailyDay: number;
  streak: number;
  /** Chapter three: index of the next shadow puzzle. */
  puzzle: number;
  /** The chase from the Ink Wolf is done (or skipped). */
  chase: boolean;
  /** Chapter four: the Ink Wolf is beaten (or skipped). */
  battle: boolean;
}

const KEY = 'shadowfolk.v1';
const DEFAULTS: Progress = { level: 0, found: [], gentle: false, dailyDay: -1, streak: 0, puzzle: 0, chase: false, battle: false };

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // storage blocked: play without saving
  }
  return { ...DEFAULTS, found: [] };
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}
