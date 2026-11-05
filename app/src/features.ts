// Which version's screens this build holds. v0 is the default: Home, All apps and the base UI, with
// no screens that need API keys and no sample data. `HOMETV_V1=1 npm run build` (or `npm run dev`) adds v1's: Movies,
// TV Shows, Search, the title and person pages, the API keys page, all reading TMDB (app/src/live) with the user's own
// key. No sample data is in either build; tools/package-tizen.mjs refuses a page that has it.
declare const __HOMETV_V1__: boolean;

export const V1: boolean = typeof __HOMETV_V1__ !== 'undefined' && __HOMETV_V1__;
