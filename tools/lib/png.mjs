// HomeTV's placeholder icon, drawn without any library (LG's packager wants PNG icons).
import zlib from 'node:zlib';

// A plain PNG: dark background, a rounded-looking blue square with a white "H". Enough for LG's packager and launcher.
export function png(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const inset = Math.round(size * 0.12);
  const bar = Math.max(2, Math.round(size * 0.1));
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const hx = x - inset, hy = y - inset, hs = size - 2 * inset;
      const h = inside && hy > hs * 0.2 && hy < hs * 0.8 &&
        ((hx > hs * 0.25 && hx < hs * 0.25 + bar) || (hx > hs * 0.75 - bar && hx < hs * 0.75) ||
          (hy > hs * 0.5 - bar / 2 && hy < hs * 0.5 + bar / 2 && hx > hs * 0.25 && hx < hs * 0.75));
      const c = h ? [255, 255, 255] : inside ? [31, 111, 235] : [13, 17, 23];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))
  ]);
}
