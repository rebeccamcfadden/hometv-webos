# The platform members on LG

The screens call the TV only through `bridge.platform` (`app/src/platform.ts`; hometv-tizen's `docs/platform.md` has the
Samsung side). This table is the LG column for the members added at hometv-tizen 7996c2b. All go through Luna
(`app/src/webos/luna.ts`), the call LG's system services answer.

**Nothing here has run on a real TV.** "Guess" means the service's name or its reply's shape is written from LG's own
apps and webOS notes, not seen on the test TV (LG 43UT8000AUA, webOS 25). The tests use a pretend PalmServiceBridge
(`tests/platform-members.test.mjs`); they prove the code does what it says, not that LG answers that way.

| Member | What it returns | LG | State |
|---|---|---|---|
| `credits` | Who the platform side is built on (Settings › About) | Homebrew Channel by webosbrew (MIT) for the rooted edition; lasharor/cleanyourtv-WebOS (MIT) for the root scripts | Text |
| `osVersion()` | The software version for the problem report, or `""` | `com.webos.service.tv.systemproperty/getSystemInfo` `{ keys: ['sdkVersion'] }`. The page asks once (`started()` starts it) and keeps the answer; until it arrives `osVersion()` says `""` | Service and `sdkVersion` also used by the checks app; version shape a guess |
| `network()` | `{ kind, signal, name, online }` | `com.webos.service.connectionmanager/getStatus`: `wifi` (state, `ssid`, `signalLevel` 0-100 or `signalBars` 0-5) before `wired`; `online` from `isInternetConnectionAvailable`. `unknown` with no webOS | Service as `keyPages.address()` uses it; signal and internet fields a guess |
| `onNetworkChange(fn)` | Stop function | The same call with `subscribe: true` (the first answer is the state now, not a change), plus the page's `online` and `offline` | Guess |
| `inputs.list()` | `TvInput[]` or `null` | `com.webos.service.eim/getAllInputStatus`, `devices[]` with `id` (`HDMI_1`), `label`, `connected`, `appId` (`com.webos.app.hdmi1`), `activeInput`. A label LG fills in by default ("HDMI 1") isn't a device name. Live TV (`com.webos.app.livetv`) is added last, as hometv-tizen lists it | Guess (service and every field) |
| `inputs.show(input)` | `'left'`, `'preview'` or why not | Launches the input's `appId` through `com.webos.applicationManager/launch`; HomeTV is left behind, like Live TV on Samsung | Launch call known; the app ids a guess |
| `inputs.leave()` | nothing | Nothing to do: LG's input is its own app | Known |
| `inputs.onChange(fn)` | Stop function | `getAllInputStatus` with `subscribe: true` | Guess |
| `openTvSettings(page)` | `true` when LG's Settings opened | Launches `com.palm.app.settings`. No page `target` is known, so every page opens the app's main screen (`SETTINGS_TARGETS` in `platform.ts` is empty, ready to fill) | App id a guess; pages unknown |
| `settingsWhere(page)` | The menu path in plain words | LG webOS 25's menus (Settings button › All Settings › …), with the older path where it differs | Text, from docs/privacy.md and docs/research.md; Inputs path vague |
| `clock()` | Date, time, weekday, `hour24` | The page's `Date`: LG's pages follow the TV's time zone. `hour24` is `null` until a Luna read for the clock format is known | Known to follow the zone; format unread |
| `pageUpdates()` | Versions and last update check, or `null` | The loader's `HomeTVBoot.status()` (`app/loader/boot.js`), as on Samsung; `null` without the loader | Built, tested with a fake loader |

`started()` is unchanged from the first copy.

## v1: the key page, API keys and Watch

v1 (`HOMETV_V1=1`) reads TMDB and the price APIs with keys the household sends from a phone to HomeTV's own service
(`service/pages.js`, run by `service/service.js`; hometv-tizen's `service/pages.js` ported, same security rules). The
tests (`tests/pages.test.mjs`, `key-service.test.mjs`, `platform-keys.test.mjs`) use fake HTTP and a fake PalmServiceBridge.
Still nothing here has run on a real TV.

| Member | What it returns | LG | State |
|---|---|---|---|
| `keyPages.start()` | nothing | Luna `com.hometv.app.service/start`: the service takes port 8766 and a keep-alive activity (`hometv-keys-keepalive`) so webOS doesn't stop it; it lets go 2 minutes after the screen stops holding the routes | Guess (keep-alive, timing) |
| `keyPages.token()` | The token for the screen's loopback calls, or `""` | Luna `…/token`, only once the server listens; never on disk. On a PC: `/__hometv/pages-token` (vite, `tools/dev-keys.mjs`) | Guess (caller name) |
| `keyPages.tmdbKey()` | The TMDB key, or `""` | Luna `…/tmdbKey`, read from the service's private store. On a PC: `/__hometv/tmdb-key` | Guess |
| `keyPages.priceKeys()` | `{ watchmode, motn }` (empty strings when unset) | Luna `…/priceKeys`. On a PC: `/__hometv/price-keys` | Guess |
| `keyPages.address()`, `onTv()` | LAN address for the QR; whether this is a TV | As before: `connectionmanager/getStatus` | As before |
| Key store | Keys the phone page saved | `/media/developer/.hometv-private/hometv-keys-v1.json` (mode 0700 folder, outside the package so an update keeps it), else `<service folder>/.private/`; never the page's web storage. With neither writable the page still opens but saving says "couldn't save" | Writable dir a guess |
| Luna callers | Who may ask for the token and keys | `com.hometv.app` or `com.webos.app.home`; an unnamed caller is refused (`alive` stays lenient) | `message.sender` shape a guess |
| Watch: Trailer | YouTube opens the video | `applicationManager/launch` `youtube.leanback.v4` with `{ contentId: 'v=<id>' }` (from the test app) (openTitle); if the TV refuses the params, the app opens plainly | Params from the test app, unproven |
| Watch: Netflix | The app opens on its home | The old catalogue link (`m=http://api.netflix.com/catalog/titles/movies/<id>&source_type=4`) only with `localStorage['hometv.netflix-old-link']='1'` | Unproven; off by default |

The page reaches the service over loopback HTTP at `127.0.0.1:8766` (`screens/keys.ts`, shared). The origin the page sends
from `file://` or the app's own folder (null or `file://`) is the one the service trusts on the TV.
