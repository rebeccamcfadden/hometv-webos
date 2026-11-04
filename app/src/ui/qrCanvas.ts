// A QR as a canvas, for the API keys page (screens/keys.ts) and the problem report (screens/report.ts).
import { dark, encodeQr, type Ecc } from '../qr';

/** The QR as a canvas: black modules on white, with the standard light border of 4. */
export function qrCanvas(text: string, px: number, ecc: Ecc = 'M'): HTMLCanvasElement {
  const qr = encodeQr(text, ecc);
  const modules = qr.size + 8;
  const scale = Math.max(1, Math.floor(px / modules));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = modules * scale;
  canvas.className = 'qr';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (dark(qr, x, y)) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  }
  return canvas;
}
