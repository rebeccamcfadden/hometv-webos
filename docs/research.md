# LG (webOS) spike: what we know so far

Written 2026-11-04 without the TV and without LG's emulator. Each answer says how sure it is and where
it comes from. Nothing here has been run on any TV. The companion notes: [privacy.md](privacy.md),
[jailbreak.md](jailbreak.md), [launcher-replacement.md](launcher-replacement.md).

## The short version

- **It can work, as an app the family opens, through LG's own Developer Mode.** No root, nothing flashed, undone by
  deleting one app. HomeTV would be a web app like the Samsung one (TypeScript, built for the TV's old Chromium).
- **The big catch, unlike Samsung: LG's Developer Mode runs out.** A session lasts about 1,000 hours (~41 days).
  When it runs out, **LG uninstalls every app installed through it** (LG's own docs), HomeTV and its saved keys
  included. Someone has to press **Extend** in the Developer Mode app before then, or a phone, PC or Home Assistant
  does it for them. This is the first question for Rebecca (Q-W1 below).
- **Opening Netflix, YouTube and the rest: yes** (high confidence). Any installed app may call LG's public
  `luna://com.webos.applicationManager/launch` with the app's id. App ids are known for most US services.
- **Opening one film or show: YouTube yes; Netflix maybe** (an old, brittle form); **Disney+, Prime Video, Max,
  Apple TV, Hulu: no known way.** Same picture as Samsung.
- **Keys without ADB: a QR to a page on the phone, as on Android: probably.** A web app can carry a small Node.js
  background service, which can run a web server. Nobody documents a phone reaching one on a non-rooted TV: a TV
  check.
- **Home key and power-on: not by LG's rules.** LG confirmed in 2026 that no app can start at power-on, and the Home
  key belongs to LG's Home. Two no-root projects get around the Home key (a helper that reads the remote's key
  presses on the TV, tested on a handful of models); power-on needs root, which SlopBro very likely gives on her
  dad's exact firmware ([jailbreak.md](jailbreak.md)). Details in [launcher-replacement.md](launcher-replacement.md).
- **Cost for the household:** an LG developer account (free), the Developer Mode app from LG's store, a computer
  (or an Android phone) once for the install, and the 41-day Extend. All of it undone by deleting the apps.
- **Best base to build on:** [Razdva122/clean-your-tv-lg-webos](https://github.com/Razdva122/clean-your-tv-lg-webos)
  (MIT, very active, a Windows/Mac/Linux/Android installer, an on-TV Home helper), itself built on
  [OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack) and on upstream cleanyourtv. Less proven
  than AeroTizen is for Samsung: its own docs mark most models "unverified".

## Her dad's TV, and Rebecca's answers

- **The TV** (Rebecca, 22:1x, from a screenshot; only model, webOS version and firmware are ever quoted):
  **43UT8000AUA**, a 2024 UT80 LCD (US) with LG's webOS 25 upgrade, release **10.3.1-3001** (software 33.31.61).
  So: **Chromium 120 and Node 16** (LG's charts for webOS 25): a modern build target, newer than the Samsung one's
  Chromium 56. A budget model: assume little memory and keep the fork's 1 GB-TV rules.
- **Access:** a TV call at most once a week; a Windows laptop at the house; the US (21:54-22:09).
- **W1** (a): a reminder inside HomeTV now; automatic renewal later. **And root is open for research in this repo**:
  explore both, with the risks; test without root first, before she decides whether to root
  ([jailbreak.md](jailbreak.md) has the status for his exact firmware). No root on any TV until she picks it.
- **W2** (a): title-link checks on a call. **W3** (a): the Home helper, now that the model is known. **W4**: covered
  by the root research. **W5** (a): the key page and phone notes; the phone remote on the back burner (as on
  Samsung). **W6** (a): page updates.

## Questions for Rebecca (her rule: features that may not work go to her)

Asked on 2026-11-04, 22:03; answered above.

| # | Feature | What fails | Evidence | Cost of more research |
|---|---|---|---|---|
| W1 | **HomeTV staying installed** | Developer Mode runs out after ~1,000 h and uninstalls HomeTV and its keys | LG's Developer Mode guide, quoted below | (a) a reminder inside HomeTV plus the Extend button (a minute with the remote, every month): ~1 day; (b) automatic renewal from a phone or PC: ~1-2 days, plus a TV check; (c) root: see [jailbreak.md](jailbreak.md) (Rebecca's pick, only after a non-root test) |
| W2 | **"Watch on" opening the title** | Only YouTube (and maybe Netflix) open a title | Home Assistant, homebridge and Jellyfin reports; no documented form for the others | ~1 hour of build plus ~15 minutes of checks on a TV call |
| W3 | **The Home key going to HomeTV** | LG keeps the Home key | LG's docs; every project works around it | Test the on-TV helper (Razdva122's, or LG-TV-HA-Home-Launcher's) on the family's model: ~1 day plus a call |
| W4 | **Opening at power-on** | No app can start at power-on without root (LG, April 2026) | LG developer forum, quoted below | No no-root way known; only "start on the last input" settings |
| W5 | **Servers on the TV** (key page, phone notes, phone remote) | Undocumented on a non-rooted TV | No project shows a phone reaching a dev-mode service | A small test app: ~half a day plus a check on a call |
| W6 | **In-app updates** | A Developer Mode app can't update itself; a reinstall needs the computer | LG's docs; Razdva122's updater needs root | The pages can update themselves (a newer page kept on the TV, as on Samsung): ~1 day; the app shell has no known way |

## 1. Can HomeTV open Netflix and the rest?

**Opening the app: yes.** How sure: high.

- A webOS web app loads LG's `webOSTV.js` and calls
  `webOS.service.request('luna://com.webos.applicationManager', {method: 'launch', parameters: {id, params}})`.
  It's LG's public, documented service; any installed app may call it, Developer Mode apps included
  ([Application Manager](https://webostv.developer.lge.com/develop/references/application-manager)).
- **Listing the installed apps** (`listApps`, `listLaunchPoints`): the same service; it works over LG's remote-control
  connection (Home Assistant and PyWebOSTV use it). From inside an app: likely, not documented. A TV check.
- **Permissions to come (ACG):** LG is adding per-app permission groups for Luna calls: not enforced on webOS 25 and
  older, testable on webOS 26 Re:New, **mandatory from webOS 27** ([ACG guide](https://webostv.developer.lge.com/develop/guides/acg-guide)).
  `launch` is in the public list (`application.launcher`); `listApps` isn't, so it may stop working for apps on
  webOS 27. His TV is webOS 25: no effect now; HomeTV declares `requiredACG` once it targets 26+.
- **LG's remote-control connection** (SSAP, `ws://<tv>:3000`, `wss://<tv>:3001` on newer sets) is what phone apps and
  Home Assistant use: launch, close, list apps, which app is on screen, remote key presses. The TV asks once to
  allow each new client. Razdva122's Home helper pairs with the TV's own connection, from the TV, which shows a page
  on the TV can do the same (medium confidence, from its docs).

**App ids** (from PyWebOSTV, homebridge-webos-tv, the Home Assistant community list and LG-TV-HA-Home-Launcher; ids
change with rebrands, so HomeTV reads the TV's list where it can and keeps a "find this app" fallback):

| App | Id | Sure? |
|---|---|---|
| Netflix | `netflix` | high |
| YouTube | `youtube.leanback.v4` | high |
| Prime Video | `amazon` | high (US) |
| Disney+ | `com.disney.disneyplus-prod` | medium-high |
| HBO Max | `com.wbd.stream` (newer), `com.hbo.hbomax` (older) | medium |
| Apple TV | `com.apple.appletv` (some TVs `com.apple.appletv.web`) | medium |
| Hulu | `hulu` | medium |
| Paramount+ | `com.cbs-all-access.webapp.prod` | medium |
| Plex | `cdp-30` | high |
| Jellyfin | `org.jellyfin.webos` | high |
| Peacock, Tubi, Pluto TV, Crunchyroll, Spotify | not found | - |
| SVT Play, TV4 Play, Viaplay, SkyShowtime (Sweden) | not found | - |
| Live TV / HDMI 1-4 | `com.webos.app.livetv` / `com.webos.app.hdmi1`…`hdmi4` | high |
| Settings / LG's Home | `com.webos.app.settings` / `com.webos.app.home` | high |

**Opening one title inside the app.** The launch carries `params`; LG's own search uses `contentTarget`, older
integrations `contentId`. Whether the app honours it is up to the app:

| App | Form | Status | Sure? |
|---|---|---|---|
| YouTube | `contentId: "v=<id>"` or `contentTarget: "https://www.youtube.com/tv?v=<id>"` | Works | high |
| Netflix | `contentId: "m=http://api.netflix.com/catalog/titles/movies/<id>&source_type=4"` | Old form; works for some, not for others (homebridge-webos-tv #518, 2024, unresolved) | medium |
| Disney+, Prime Video, Max, Apple TV, Hulu | none known | Plan for "opens the app" | - |
| Spotify | no launch link; Spotify Connect from a phone instead | - | medium |

So "Watch on" opens the service's app, as on Android and Samsung, plus YouTube's video; Netflix's title link is
worth one button on a TV call (W2).

## 2. How do the household's keys get on without ADB?

**The same way as on Android and Samsung: a QR on the TV opens a page on the phone.** How sure: medium until seen on
a TV.

- A webOS web app can ship a **JS service** (Node.js) in the same package. It has Node's `http` module, so it can
  run the key page's server, a port of the launcher's `KeyInbox` (as hometv-tizen's `service/pages.js` is).
- **Nobody documents a phone reaching such a server on a non-rooted TV.** LG's forum has an unanswered October 2026
  question about even a loopback-only server in a store app. A Developer Mode app isn't reviewed, so this is a
  technical question only: a test app on the first call (W5).
- **Services stop after a few seconds idle** unless they hold an "activity" open (`activityManager.create`). That's
  the standard webOS pattern; whether it holds through standby is a TV check.
- **Node's version is old on older TVs** (LG's chart): 2016-2019 Node 0.12, 2020-2021 Node 8, 2022-2023 Node 12,
  2024-2025 Node 16, 2026 Node 20. So the service is written in plain ES5 with Node's built-in modules only, as on
  Samsung (hometv-tizen's service already is).
- **Where keys are kept:** not in the page's `localStorage` alone: LG deletes it when the app is updated or removed.
  The service keeps them in a file in its own folder (LG: a service's files aren't visible to web apps, which keeps
  other apps out). Both go when Developer Mode runs out and uninstalls the app (W1), so the key page must make
  typing them again quick.
- **Fallback:** type the keys with the remote (TMDB's short key and Watchmode's key make that slow but possible).

## 3. What Developer Mode needs, and what it changes

How sure: high (LG's [Developer Mode guide](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)),
except where marked.

- **An LG developer account** (free, at webostv.developer.lge.com) and the **Developer Mode app** from LG's Content
  Store. Sign in inside the app, switch Dev Mode Status on (the TV restarts), switch Key Server on.
- **A computer once** (or an Android phone with Razdva122's installer or the "webOS Dev Mode Manager" app): it fetches
  the TV's key with a six-letter code shown on the TV and installs the app over Developer Mode's connection
  (SSH on port 9922, user `prisoner`).
- **What it changes:** the TV accepts apps installed from that computer. It opens port 9922 on the home network, with
  a key (no password). Key Server can be switched off after the install. It doesn't give root.
- **The timer:** each session lasts about **1,000 hours** (LG raised it from 50 hours in 2023; LG's forum and 2025
  reports agree). The app shows what's left and has an **Extend** button, which starts it again. Developer Mode
  also ends after **10 restarts without a network**. Either way, LG's words: *"After Developer Mode is disabled, the
  installed apps that you were using on Developer Mode are uninstalled."*
- **Keeping it alive:** the Extend button (the remote, a minute, while the TV is online); `ares-extend-dev` from a
  computer; Home Assistant scripts that wake the TV and press Extend; webosbrew's Dev Manager and Razdva122's
  installer can renew on a schedule (Razdva122 marks its renewal "Beta, real renewal on unrooted TVs unverified").
  Whether HomeTV itself can read the time left (to remind the family) is unknown: a TV check.
- **A firmware update:** nothing says it ends Developer Mode; it can break the Home helpers, which rely on LG
  internals (see [launcher-replacement.md](launcher-replacement.md)).
- **Undo:** delete HomeTV, then the Developer Mode app (or let the session run out).

## 4. Can it start at power-on, or only be opened?

**Only opened, without root.** How sure: high.

- LG, on its developer forum, March and April 2026: *"there is no API provided to automatically launch an app when
  the TV is turned on. Only the user can launch the app."*
- LG's settings choose only between **LG's Home and the last input** at power-on: **Home Auto Launch** (2019-2022) or
  **Power On Screen** (2023+), with **Quick Start+** on. An app isn't an input, so HomeTV can't be chosen.
- **Waking from Quick Start+ standby:** an app that was open may come back as it was (it gets `webOSRelaunch` or
  `visibilitychange`). How it behaves on the family's TV is a TV check.
- **The Home key:** a web app never sees it. Two no-root projects catch it with a small native helper on the TV that
  reads the remote's key presses (Razdva122's "Home Helper"; mbsintegrations/LG-TV-HA-Home-Launcher's, which names
  the models it's tested on). Experimental, per model, and a firmware update can break it. Root takes Home over
  properly ([launcher-replacement.md](launcher-replacement.md)).
- **Back:** on webOS 6+ Back at an app's first page asks "exit app?"; HomeTV can handle Back itself
  (`disableBackHistoryAPI`). Where Back from inside Netflix lands is a TV check.

## 5. Memory and speed

- **The web engine by year** (LG's [chart](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)):
  2016-2017 Chromium 38, 2018-2019 53, 2020 68, 2021 79, 2022 87, 2023 94, 2024 108, 2025 120, 2026 132. The
  Samsung build targets Chromium 56; **a 2016-2019 LG needs older still** (Chromium 38/53: no CSS grid on 38, careful
  ES5 output). His TV is webOS 25: Chromium 120, so this only matters for other households.
- **Memory:** LG publishes no figure. Third-party notes say 1.5-3 GB on recent sets, with backgrounded apps reclaimed
  quickly. The fork's 1 GB-TV rules (no blur, no autoplaying video) fit as they are.
- **Unknown:** start time and scrolling on the family's TV.

## 6. How updates reach the TV

- **The app shell:** only by reinstalling from the computer (or Android installer) over Developer Mode. Razdva122's
  on-TV updates need root.
- **The pages:** as on Samsung (hometv-tizen's W2 page updates), the packaged app can fetch a newer, signed page when
  online, keep it, and fall back to the one inside the app. LG also has "hosted" apps (a shell that loads a web
  address), but that one doesn't open offline.
- **LG's Content Store** (a public app): free to register, about three weeks' review per version, and no "home
  screen" category; a launcher-like app is unlikely to pass and couldn't do more than a Developer Mode app anyway.
  Not recommended.

## 7. Working without the internet

- **A packaged app opens offline** (its files are on the TV): high confidence, LG's docs. HomeTV's Home, lists and
  the keys work offline; the catalogue shows what was kept.
- **But Developer Mode ends after 10 restarts with no network.** A TV that stays offline for weeks loses HomeTV.
  Rare for a family TV; worth a line in the household guide.

## 8. What it costs the household

- An LG developer account (free; Rebecca's or a new one: a question for the install plan), the Developer Mode app,
  the computer once.
- **The monthly Extend** (W1), or a phone, PC or Home Assistant that does it.
- Port 9922 open on the home network while Developer Mode is on (key only). Key Server off after the install.
- Optional: the on-TV Home helper (experimental, per model).
- **Undo:** delete HomeTV and the Developer Mode app; LG's settings back as written down first.

## Risks, in order

1. **Developer Mode running out** uninstalls HomeTV and its keys, silently, after ~41 days without Extend (W1).
2. **No Home key or power-on without root:** HomeTV is an app they open, unless the experimental Home helper works on
   their model (W3, W4).
3. **The servers on the TV** (key page, phone notes) are unproven on a non-rooted LG (W5).
4. **Older TVs:** a 2016-2019 set means Chromium 38-53 and Node 0.12; the build must target it.
5. **The base is young:** Razdva122's project is very active but marks most models unverified; webos-vibehack is
   tested on one TV.
6. **Title links** work for YouTube only, maybe Netflix (W2).

## Plan (once Rebecca has answered)

- **The app:** HomeTV's screens from hometv-tizen and `design_preview/` (the shared `packages/core`), built for the
  family TV's Chromium; LG's `webOSTV.js` for launch and app lists in place of Tizen's calls. Packaged, so it opens
  offline; pages update themselves as on Samsung.
- **The service:** hometv-tizen's ES5 key-page service, ported to webOS's service API (same Node built-ins).
- **Off the TV:** LG's CLI (`@webos-tools/cli` 3.2.6, on this PC's npm feed) packages and installs; LG's TV emulator
  needs VirtualBox, not installed here (a question before installing it).
- **The first TV call:** read the software version (33.31.61?) and whether automatic updates are on; Developer Mode
  and the timer; a test app with buttons for
  launch, list apps, the key page from a phone, title links, and the time left in Developer Mode.

## Sources

- LG webOS TV developer site: [Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app),
  [Application Manager](https://webostv.developer.lge.com/develop/references/application-manager),
  [Web engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine),
  [JS service basics](https://webostv.developer.lge.com/develop/guides/js-service-basics) (Node versions; service files),
  [App lifecycle](https://webostv.developer.lge.com/develop/getting-started/app-lifecycle),
  [Back button](https://webostv.developer.lge.com/develop/guides/back-button),
  [Magic Remote keys](https://webostv.developer.lge.com/develop/guides/magic-remote),
  [Web app types](https://webostv.developer.lge.com/develop/getting-started/web-app-types),
  [local storage removal](https://webostv.developer.lge.com/faq/web-storage-local-storage-data-removal-app-removal-or-uninstallation),
  [App self checklist](https://webostv.developer.lge.com/distribute/app-self-checklist).
- LG developer forum: [no auto-launch at power-on](https://forum.webostv.developer.lge.com/t/how-to-make-the-app-launch-automatically-after-power-on/28121) (2026),
  [loopback HTTP server question](https://forum.webostv.developer.lge.com/t/is-a-loopback-only-http-server-in-a-js-service-allowed-for-content-store-apps/28491) (Oct 2026),
  [session timer](https://forum.webostv.developer.lge.com/t/topic/4854) (Dec 2023).
- App ids and links: [PyWebOSTV](https://github.com/supersaiyanmode/PyWebOSTV) (`pywebostv/controls.py`),
  [homebridge-webos-tv](https://github.com/merdok/homebridge-webos-tv) (README, [#518](https://github.com/merdok/homebridge-webos-tv/issues/518)),
  [jellyfin-webos #260](https://github.com/jellyfin/jellyfin-webos/issues/260),
  [LG-TV-HA-Home-Launcher](https://github.com/mbsintegrations/LG-TV-HA-Home-Launcher) (docs/APP-TILES.md, INSTALL.md, HOME-BUTTON-HELPER.md),
  [Home Assistant: app ids for LG](https://community.home-assistant.io/t/app-ids-for-lg-smart-tvs/662550).
- Projects: [Razdva122/clean-your-tv-lg-webos](https://github.com/Razdva122/clean-your-tv-lg-webos) (README, docs/COMPATIBILITY.md, read 2026-11-04, v1.7.1),
  [OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack),
  [webosbrew/dev-manager-desktop](https://github.com/webosbrew/dev-manager-desktop),
  [symonxdd/aphanes](https://github.com/symonxdd/aphanes) (webOS Dev Mode Manager for phones),
  [Home Assistant renewal gist](https://gist.github.com/singularity0821/af83dcb89da323e60ce359281b48441b).
- webOS OSE: [JS service FAQ](https://www.webosose.org/docs/iot/development/js-services/js-service-faq-iot/) (idle timeout, activities).
