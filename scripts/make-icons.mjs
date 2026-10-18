/**
 * Makes the app icons (PNG) from simple SVG drawings. Run: npm run icons
 * The PNG files in /public are committed, so this only needs running if the design changes.
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const BG = "#0d1210";
const wheel = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="170" fill="#14532d" stroke="#d4af37" stroke-width="14"/>
    <circle cx="256" cy="256" r="110" fill="none" stroke="#e5e7eb" stroke-width="6" stroke-dasharray="26 18"/>
    <circle cx="256" cy="256" r="46" fill="#d4af37"/>
  </g>`;

/** rounded square: the normal "any" icon */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${BG}"/>${wheel()}</svg>`;
/** full-bleed square with the artwork inside the safe zone: for maskable (Android) and Apple touch icons */
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/>${wheel(0.82)}</svg>`;

const make = async (svg, size, file) => {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/${file}`);
  console.log("made public/" + file);
};

await make(rounded, 192, "icon-192.png");
await make(rounded, 512, "icon-512.png");
await make(bleed, 512, "icon-maskable-512.png");
await make(bleed, 180, "apple-touch-icon.png");
writeFileSync("public/icon.svg", rounded + "\n");
