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
  // The nav's Wi-Fi, Inputs and Settings and their menus; the report.
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  input: 'M3 9.5h18v5H3zM7 12h.01M17 12h.01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  hdmi: 'M8 3.5h8v5.5l-1.5 2v9.5h-5V11L8 9zM10.5 6h3',
  av: 'M6 4v16M12 4v16M18 4v16M4 8h4M10 15h4M16 10h4',
  liveTv: 'M3.5 8h17v11.5h-17zM8.5 3.5L12 7l3.5-3.5',
  picture: 'M3.5 5h17v11.5h-17zM8 20h8M12 16.5V20',
  sound: 'M4 9.5h4l5-4v13l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11',
  motion: 'M4 12h3M4 7h6M4 17h6M14 7l6 5-6 5',
  alert: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5h.01',
  gauge: 'M4.5 17a8 8 0 1 1 15 0M12 14l4-5M12 14h.01',
  // Not in design_preview: a cable for Ethernet (its nav only knows Wi-Fi), and Move in Home's tile menu.
  ethernet: 'M7 3.5h10v7h-2.5v3h-5v-3H7zM10 6v2M14 6v2M12 13.5v7',
  move: 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
  // Home's weather, Settings and first run.
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  sync: 'M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2M20 4v4h-4M4 20v-4h4',
};

export type IconName = keyof typeof P;

export const icon = (name: IconName, size = 26, fill = false) => svg(P[name], size, fill);
