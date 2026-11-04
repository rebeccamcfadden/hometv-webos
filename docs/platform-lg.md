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
| `osVersion()` | The software version for the problem report, or `""` | `com.webos.service.tv.systemproperty/getSystemInfo` `{ keys: ['sdkVersion'] }`. The page asks once, at the first `network()` or `osVersion()`, and keeps the answer: the call is synchronous, so the very first `osVersion()` can still say `""` | Service and `sdkVersion` also used by the checks app; version shape a guess |
| `network()` | `{ kind, signal, name, online }` | `com.webos.service.connectionmanager/getStatus`: `wifi` (state, `ssid`, `signalLevel` 0-100 or `signalBars` 0-5) before `wired`; `online` from `isInternetConnectionAvailable`. `unknown` with no webOS | Service as `keyPages.address()` uses it; signal and internet fields a guess |
| `onNetworkChange(fn)` | Stop function | The same call with `subscribe: true` (the first answer is the state now, not a change), plus the page's `online` and `offline` | Guess |
| `inputs.list()` | `TvInput[]` or `null` | `com.webos.service.eim/getAllInputStatus`, `devices[]` with `id` (`HDMI_1`), `label`, `connected`, `appId` (`com.webos.app.hdmi1`), `activeInput`. A label LG fills in by default ("HDMI 1") isn't a device name. Live TV (`com.webos.app.livetv`) is added last, as hometv-tizen lists it | Guess (service and every field) |
| `inputs.show(input)` | `'left'`, `'preview'` or why not | Launches the input's `appId` through `com.webos.applicationManager/launch`; HomeTV is left behind, like Live TV on Samsung | Launch call known; the app ids a guess |
| `inputs.leave()` | nothing | Nothing to do: LG's input is its own app | Known |
| `inputs.onChange(fn)` | Stop function | `getAllInputStatus` with `subscribe: true` | Guess |
| `openTvSettings(page)` | `true` when LG's Settings opened | Launches `com.palm.app.settings`. No page `target` is known, so every page opens the app's main screen (`SETTINGS_TARGETS` in `platform.ts` is empty, ready to fill) | App id a guess; pages unknown |
| `settingsWhere(page)` | The menu path in plain words | LG webOS 25's menus (Settings button › All Settings › …), with the older path where it differs | Text, from docs/privacy.md and docs/research.md; Inputs path vague |
| `clock()` | Date, time, weekday, `hour24` | The page's `Date`: LG's pages follow the TV's time zone. `hour24` is `null` until a Luna read for the clock format is known | Known to follow the zone; format unread |
| `pageUpdates()` | Versions and last update check, or `null` | `null` for now. TODO: LG's page loader (another worker's branch) will fill it in | Not built |

`started()` and `keyPages` are unchanged from the first copy.
