// TEMPORARY copy of the icons the ported screens use (Search, the title page, Movies, TV Shows, All apps), from
// hometv-launcher's design_preview/src/ui/icons.ts at 2bf3c2d (same paths), until icons are shared. Outline icons on a
// 24-unit grid; colour comes from `currentColor`.
const svg = (d: string, size: number, fill: boolean) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const P = {
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  back: 'M15 5l-7 7 7 7',
  chevRight: 'M9 6l6 6-6 6',
  play: 'M8 5.5v13l10-6.5z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  trailer: 'M3.5 6.5h17v11h-17zM10 9.5v5l4-2.5z',
  star: 'M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  backspace: 'M9 6h11v12H9l-6-6zM12 9.5l5 5M17 9.5l-5 5',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  wifiOff: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3.5 3.5l17 17',
  // Movies, TV Shows and All apps.
  chevLeft: 'M15 6l-6 6 6 6',
  shuffle: 'M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M18 14l3 3-3 3M3 17h3.5c1.3 0 2.2-.4 3-1.2M14.5 8.2c.8-.8 1.7-1.2 3-1.2H21M18 4l3 3-3 3',
  filter: 'M4 6h16M7 12h10M10 18h4',
  sort: 'M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5',
  home: 'M4 11l8-7 8 7v9h-5.5v-6h-5v6H4z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  apps: 'M5 5h4v4H5zM10 5h4v4h-4zM15 5h4v4h-4zM5 10h4v4H5zM10 10h4v4h-4zM15 10h4v4h-4zM5 15h4v4H5zM10 15h4v4h-4zM15 15h4v4h-4z',
};

export type IconName = keyof typeof P;

export const icon = (name: IconName, size = 26, fill = false) => svg(P[name], size, fill);
