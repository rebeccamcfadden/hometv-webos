# Where `app/` comes from

HomeTV's screens and shell are copied unchanged from
[hometv-tizen](https://github.com/rebeccamcfadden/hometv-tizen) at commit **1aa9191** (the v1 merge: `app/`, its
`docs/platform.md` layer). v1's screens, the live data (`src/live`) and the TMDB account (`src/account`) are behind `HOMETV_V1=1`. Only the platform files differ. A fix to a screen goes to hometv-tizen first,
then is copied here again with this file's commit updated.

| File | Here |
|---|---|
| `src/bridge.ts`, `src/platform.ts`, `src/pageChecks.ts` | Written for LG, with the same exports: Luna's app manager lists, opens and draws the apps; LG's key codes (Back 461); the checks done LG's way; the heartbeat for the rooted edition's watchdog |
| `src/webos/luna.ts`, `src/webos/apps.ts` | LG only: the Luna call, LG's app ids and title launch params (YouTube by `contentId`; Netflix's old link only behind a flag) |
| `src/platform.ts` `keyPages` | `token`, `tmdbKey` and `priceKeys` over Luna to LG's key service, or the PC's `/__hometv/*` routes (`tools/dev-keys.mjs`); hometv-tizen's read its Samsung key service's private file |
| `service/pages.js`, `service/keys-page.html` | The key page service, ported from hometv-tizen's `service/pages.js` (the page is a copy): same security rules, keys in the service's own private folder, token in memory and given over Luna |
| `aero-glue.js` | Not copied: AeroTizen (Samsung) |
| `loader/` | LG's own, ported from hometv-tizen's signed-update loader (`boot.js`, `update.js` at 5ac0b52): the same checks, its pages kept in IndexedDB instead of Samsung's app storage, a 20-second start limit (docs/updates.md). `page-keys.txt`: the public keys |
| everything else under `app/` | Unchanged copy |

Tests copied from hometv-tizen's `tests/` (`allApps`, `library`, `offers`, `search`, `title-links`, `qr`, `versions`,
`platform-boundary`, `ts-module.mjs`, and from 7996c2b `public-text`, `report`, `screensaver`, `settings`, `weather`
with `fixtures/`; at 1aa9191 the v1 tests `live*`, `prices-*`, `account-*` and `fixtures/sample-catalog.ts`), changed only where they read a Samsung file: `platform-boundary` also allows `webos/`,
`title-links` checks LG's ids instead of Samsung's service, `versions` reads `tools/package-webos.mjs`. LG-adapted or LG-only at 1aa9191: `versions`, `title-links`, `pages` (the service port; the token comes from the instance, not a file), `key-service`, `platform-keys`, `webos-apps`, `webos-bridge`, `legacy`, `package-guard`.
`platform-members` is written for LG: it runs our members against a fake PalmServiceBridge. `page-updates` and
`fake-browser.mjs` are ported for LG (IndexedDB in place of Samsung's filesystem).

`vite.config.ts` is hometv-tizen's without AeroTizen's scripts; the build goes to `dist/app`. It sets
`__HOMETV_VERSION__` from `package.json`, as hometv-tizen's does.

The platform members the screens added at 7996c2b, and what stands behind each on LG, are in
[docs/platform-lg.md](../docs/platform-lg.md). `bridge.ts` also has `appId()` and writes the error log
(`launch_failed`, `title_failed`), as hometv-tizen's does.
