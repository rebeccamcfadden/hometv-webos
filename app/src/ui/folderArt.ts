// F41 (2026-11-02): the TV Utilities tile is shaped like a folder (a tab on its top edge) with a gear in the
// middle, drawn in code in the theme's colours. From design_preview's ui/folderArt.ts (the launcher's FolderArt).

/** The tab's height and width, the corner radii and the curve where the tab meets the body, in px. */
const TAB_H = 14;
const TAB_W = 104;
const R = 16;
const TAB_R = 8;
const CURVE = 6;

/** The folder's outline in a w × h box: the body from TAB_H down, the tab over its top-left. */
function folderPath(w: number, h: number): string {
  return [
    `M0,${h - R}`,
    `V${TAB_R}`,
    `A${TAB_R},${TAB_R} 0 0 1 ${TAB_R},0`,
    `H${TAB_W - TAB_R}`,
    `A${TAB_R},${TAB_R} 0 0 1 ${TAB_W},${TAB_R}`,
    `V${TAB_H - CURVE}`,
    `Q${TAB_W},${TAB_H} ${TAB_W + CURVE},${TAB_H}`,
    `H${w - R}`,
    `A${R},${R} 0 0 1 ${w},${TAB_H + R}`,
    `V${h - R}`,
    `A${R},${R} 0 0 1 ${w - R},${h}`,
    `H${R}`,
    `A${R},${R} 0 0 1 0,${h - R}`,
    'Z',
  ].join(' ');
}

const TEETH = 8;

/** A gear of outer radius r around (cx, cy): eight teeth, and a hole (drawn with fill-rule evenodd). */
function gearPath(cx: number, cy: number, r: number): string {
  const root = r * 0.78;
  const step = (2 * Math.PI) / TEETH;
  const pt = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  const pts: string[] = [];
  for (let i = 0; i < TEETH; i++) {
    const a = i * step - Math.PI / 2;
    pts.push(pt(root, a - 0.3 * step), pt(r, a - 0.17 * step), pt(r, a + 0.17 * step), pt(root, a + 0.3 * step));
  }
  const hole = r * 0.34;
  return `M${pts.join(' L')} Z M${cx + hole},${cy} A${hole},${hole} 0 1 0 ${cx - hole},${cy} A${hole},${hole} 0 1 0 ${cx + hole},${cy} Z`;
}

let masks = 0;

/**
 * The folder face, w × h: the folder filled with the surface colour and the gear, and the focus ring just outside the
 * outline (a stroke masked to outside the folder, so it follows the tab). `room` is the space kept around it for the ring.
 */
export function folderFace(w: number, h: number, room: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'aa-folder-art');
  svg.setAttribute('width', String(w + 2 * room));
  svg.setAttribute('height', String(h + 2 * room));
  svg.setAttribute('viewBox', `${-room} ${-room} ${w + 2 * room} ${h + 2 * room}`);
  const outline = folderPath(w, h);
  const id = `aa-folder-mask-${++masks}`;
  const gearR = Math.min(w, h - TAB_H) * 0.21;
  svg.innerHTML =
    `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${-room}" y="${-room}" width="${w + 2 * room}" height="${h + 2 * room}">` +
    `<rect x="${-room}" y="${-room}" width="${w + 2 * room}" height="${h + 2 * room}" fill="#fff"/><path d="${outline}" fill="#000"/></mask></defs>` +
    `<path class="aa-folder-ring" d="${outline}" mask="url(#${id})" fill="none"/>` +
    `<path class="aa-folder-body" d="${outline}"/>` +
    `<path class="aa-folder-gear" fill-rule="evenodd" d="${gearPath(w / 2, TAB_H + (h - TAB_H) / 2, gearR)}"/>`;
  return svg;
}
