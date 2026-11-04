// Which version's screens this build holds. v0 is the default: Home, All apps and the base UI, with
// no screens that need API keys and no sample data. `HOMETV_V1=1 npm run build` (or `npm run dev`) adds v1's: Movies,
// TV Shows, Search, the title and person pages, the API keys page. A v1 build still uses the sample catalogue, so
// tools/package-tizen.mjs refuses it for a TV.
declare const __HOMETV_V1__: boolean;

export const V1: boolean = typeof __HOMETV_V1__ !== 'undefined' && __HOMETV_V1__;
