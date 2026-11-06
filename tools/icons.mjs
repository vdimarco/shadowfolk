// Generate the app icons. Run: node tools/icons.mjs
// Lamp-lit paper with the hare hand shadow. Full-bleed and opaque, so the
// same art works as the maskable icon; the hare stays inside the middle 80%.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="lamp" cx="50%" cy="62%" r="72%">
      <stop offset="0%" stop-color="#fbe7b8"/>
      <stop offset="45%" stop-color="#d9a560"/>
      <stop offset="80%" stop-color="#5a3216"/>
      <stop offset="100%" stop-color="#1a0d07"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#lamp)"/>
  <g fill="#2a160c">
    <g opacity="0.35" transform="translate(4 6)">
      <rect x="214" y="98" width="38" height="170" rx="19" transform="rotate(-11 233 268)"/>
      <rect x="262" y="98" width="38" height="170" rx="19" transform="rotate(11 281 268)"/>
      <rect x="196" y="236" width="130" height="150" rx="58"/>
    </g>
    <rect x="214" y="98" width="38" height="170" rx="19" transform="rotate(-11 233 268)"/>
    <rect x="262" y="98" width="38" height="170" rx="19" transform="rotate(11 281 268)"/>
    <rect x="196" y="236" width="130" height="150" rx="58"/>
    <rect x="232" y="368" width="64" height="70" rx="22"/>
  </g>
  <circle cx="244" cy="300" r="9" fill="#ffd98a"/>
</svg>`;

await mkdir('public/icons', { recursive: true });
const png = (size, out) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
await png(512, 'public/icons/icon-512.png');
await png(192, 'public/icons/icon-192.png');
await png(512, 'public/icons/icon-512-maskable.png');
console.log('icons written');
