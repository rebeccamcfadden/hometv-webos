# Where `app/` comes from

HomeTV's screens and shell are copied unchanged from
[hometv-tizen](https://github.com/rebeccamcfadden/hometv-tizen) at commit **a4940f9** (`app/`, its
`docs/platform.md` layer at 27173fa). Only the platform files differ. A fix to a screen goes to hometv-tizen first,
then is copied here again with this file's commit updated.

| File | Here |
|---|---|
| `src/bridge.ts`, `src/platform.ts`, `src/pageChecks.ts` | Written for LG, with the same exports: Luna's app manager lists, opens and draws the apps; LG's key codes (Back 461); the checks done LG's way; the heartbeat for the rooted edition's watchdog |
| `src/webos/luna.ts`, `src/webos/apps.ts` | LG only: the Luna call, LG's app ids and title launch params |
| `aero-glue.js` | Not copied: AeroTizen (Samsung) |
| `loader/` | LG's own, ported from hometv-tizen's signed-update loader (`boot.js`, `update.js` at 5ac0b52): the same checks, its pages kept in IndexedDB instead of Samsung's app storage, a 20-second start limit (docs/updates.md). `page-keys.txt`: the public keys |
| everything else under `app/` | Unchanged copy |

Tests copied from hometv-tizen's `tests/` (`allApps`, `library`, `offers`, `search`, `title-links`, `qr`, `versions`,
`platform-boundary`, `ts-module.mjs`), changed only where they read a Samsung file: `platform-boundary` also allows
`webos/`, `title-links` checks LG's ids instead of Samsung's service, `versions` reads `tools/package-webos.mjs`.
`page-updates` and `fake-browser.mjs` are ported for LG (IndexedDB in place of Samsung's filesystem).

`vite.config.ts` is hometv-tizen's without AeroTizen's scripts; the build goes to `dist/app`.
