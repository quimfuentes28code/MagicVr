// Copia el motor OCR (Tesseract) y el idioma a public/ocr para que la app
// funcione sin depender de CDNs (también dentro del APK).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/ocr';
mkdirSync(out, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', join(out, 'worker.min.js'));
const core = 'node_modules/tesseract.js-core';
for (const f of readdirSync(core)) {
  if (/^tesseract-core.*lstm\.(js|wasm|wasm\.js)$/.test(f)) cpSync(join(core, f), join(out, f));
}
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', join(out, 'eng.traineddata.gz'));
console.log('OCR copiado a', out);
