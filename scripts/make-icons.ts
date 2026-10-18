/**
 * Writes public/icon-192.png and public/icon-512.png (PWA icons) with built-in modules only:
 * a dark square with a green rising line; and public/badge-96.png, the small monochrome notification badge for Android
 * (white line on transparent: Android shows only its shape in the status bar). Run from the web folder:  node scripts/make-icons.ts
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b: Buffer) => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// the line, in 0..1 coordinates (y down), inside the maskable safe zone (centre 80%)
const PTS = [[0.2, 0.68], [0.38, 0.5], [0.52, 0.6], [0.8, 0.32]];
const BG = [15, 20, 26], FG = [74, 222, 128];

function distToSeg(px: number, py: number, [ax, ay]: number[], [bx, by]: number[]): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function png(size: number, badge = false): Buffer {
  const ch = badge ? 4 : 3; // badge: RGBA, white with the line as alpha
  const raw = Buffer.alloc((size * ch + 1) * size);
  const w = badge ? 0.07 : 0.045; // half line width (thicker on the tiny badge)
  for (let y = 0; y < size; y++) {
    raw[y * (size * ch + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size, py = (y + 0.5) / size;
      let d = Infinity;
      for (let i = 0; i < PTS.length - 1; i++) d = Math.min(d, distToSeg(px, py, PTS[i], PTS[i + 1]));
      d = Math.min(d, Math.hypot(px - 0.8, py - 0.32) - 0.03); // dot at the end
      const a = Math.max(0, Math.min(1, (w - d) * size + 0.5)); // anti-aliased edge
      const o = y * (size * ch + 1) + 1 + x * ch;
      if (badge) { raw.fill(255, o, o + 3); raw[o + 3] = Math.round(255 * a); continue; }
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = badge ? 6 : 2; // 8-bit RGBA / RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
  console.log(`public/icon-${s}.png`);
}
writeFileSync(new URL("../public/badge-96.png", import.meta.url), png(96, true));
console.log("public/badge-96.png");
