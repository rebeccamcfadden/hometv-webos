// The page's version, from package.json at build time (vite.config.ts), for Settings › About when no loader says which
// page is showing (TizenBrew, the fake TV, a preview).
declare const __HOMETV_VERSION__: string;

export const PAGE_VERSION: string = typeof __HOMETV_VERSION__ !== 'undefined' ? __HOMETV_VERSION__ : '';
