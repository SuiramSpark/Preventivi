#!/usr/bin/env node
// Generate icon.png (512x512) and icon.ico (multi-size) from assets/icon.svg
// using `sharp` (SVG rasteriser) and `png-to-ico` (multi-size ICO container).
//
// Outputs:
//   - assets/icon.png         (512x512, used by manifest + Electron dev)
//   - C:\PrevBuild\icon.ico   (multi-size: 16, 32, 48, 64, 128, 256)
//
// Usage:  node scripts/build-icons.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

const SVG_PATH = join(ROOT, "assets", "icon.svg");
const PNG_OUT  = join(ROOT, "assets", "icon.png");
const ICO_DIR  = "C:\\PrevBuild";
const ICO_OUT  = join(ICO_DIR, "icon.ico");

const SIZES = [16, 32, 48, 64, 128, 256];

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function rasterize(svgBuffer, size, outFile) {
  await sharp(svgBuffer, { density: Math.max(72, Math.round(size * 1.5)) })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outFile);
}

(async () => {
  if (!existsSync(SVG_PATH)) {
    console.error(`Missing source SVG: ${SVG_PATH}`);
    process.exit(1);
  }

  const svgBuffer = readFileSync(SVG_PATH);

  // 1) Big PNG for manifest + Electron dev icon
  ensureDir(join(ROOT, "assets"));
  await rasterize(svgBuffer, 512, PNG_OUT);
  console.log("✓ generato assets/icon.png 512x512");

  // 2) Temporary PNGs at each ICO size
  const tmpFiles = [];
  for (const sz of SIZES) {
    const tmp = join(ROOT, "assets", `_tmp-icon-${sz}.png`);
    await rasterize(svgBuffer, sz, tmp);
    tmpFiles.push(tmp);
  }

  // 3) Combine into a single multi-size ICO
  ensureDir(ICO_DIR);
  const icoBuffer = await pngToIco(tmpFiles);
  writeFileSync(ICO_OUT, icoBuffer);
  console.log(`✓ generato ${ICO_OUT} (${SIZES.join("-")})`);

  // 4) Cleanup temp PNGs
  for (const f of tmpFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
})().catch((err) => {
  console.error("Errore generazione icone:", err);
  process.exit(1);
});
