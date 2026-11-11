/**
 * Render the game's own score (music, fire, cues) for a captured video.
 * Usage: npx tsx tools/render-score.mts <url> <events.json> <offsetSeconds> <totalSeconds> <out.wav> [extraCuesJSON]
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, eventsPath, offset, total, out, extra] = process.argv.slice(2);
const ev = JSON.parse(readFileSync(eventsPath, 'utf8')).events as { t: number; type: string }[];
const cues = [...ev, ...(extra ? JSON.parse(extra) : [])].map((c) => ({ t: c.t + Number(offset), type: c.type }));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ ignoreHTTPSErrors: true });
await pg.goto(url);
await pg.waitForFunction(() => !!(window as any).__shadowfolk, null, { timeout: 60000 });
const b64 = await pg.evaluate(([s, c]: any) => (window as any).__shadowfolk.renderMusic(s, c), [Number(total), cues]);
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`wrote ${out}: ${total}s, ${cues.length} cues`);
await b.close();
