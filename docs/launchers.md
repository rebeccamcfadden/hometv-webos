# LG home screens: what each one does, and a plan to pick from

Written 2026-11-04. Five open-source LG webOS home screens, read from their source and GitHub's
data today; nothing run on a TV. For each: how it gets the Home key and power-on, how a household installs it, its
licence, how active it is, how well it's built, and what HomeTV would take from it. Then four plans.

The test TV for reference: 43UT8000AUA, a 2024 LCD (US) on webOS 25, release 10.3.1-3001, Chromium 120, Node 16.
Automatic updates stay on, so root may go away.

## The short version

- **None of the five has been tested on the test TV's model** (or any UT80). The nearest: lasharor's, reported working on two
  sibling 2024 LCDs (43UT7590PUA, 65UT7000PUA) on webOS 25, **with root**.
- **Without root, only Razdva122's gets the Home key** (a native helper that intercepts the remote's Home press on the
  TV). Hearth works without root as a home screen you open; zzeppieri's might catch Home without root, untested.
- **Power-on needs root in all five.**
- **Every one of them is weeks old and written largely with AI help.** Two have real tests and CI (lasharor's,
  Razdva122's), one has tests without CI (Hearth), two have none (OpenLauncher, zzeppieri's).
- **Recommended plan (A):** HomeTV as **its own** Developer Mode app (our screens, from hometv-tizen), borrowing MIT
  pieces with credit, and choosing the Home-key helper after the first call has shown what the test TV allows. If root
  is picked later, lasharor's is the base for that.

## The five

### Razdva122/clean-your-tv-lg-webos ("Clean Your TV for LG webOS")

- **What:** a home screen with themes, plus a no-root **Home Helper** and a root edition. Built on webos-vibehack and
  upstream cleanyourtv.
- **Home key, no root:** the Helper is a small native app (C plus the TV's own Node) that takes exclusive hold of the
  remote's input device (`LGE M-RCU - Builtin`, found by name), passes every key through except Home (key 773), and
  opens the launcher instead. Three Home presses in two seconds release it. A second connection to the TV's own
  remote-control port watches which app is in front and standby. Runs as Developer Mode's limited user; restarts
  itself through webOS's activity scheduler at boot.
- **Power-on:** no-root: not reliable ("black screen or LG Home first"). Root: the launcher registered as a TV input
  that follows Live TV at start (one cold boot observed).
- **Developer Mode renewal:** built in, hourly check, talks to LG directly, no PC needed; **unverified on non-rooted
  TVs** (its own words).
- **Install:** Windows/Mac/Linux/Android installer (unsigned on Windows: SmartScreen warning); laptop off after setup;
  updates from the laptop again.
- **Licence:** MIT (font: SIL OFL).
- **Activity:** created 2026-10-22; ~960 commits in 13 days, 96% from one account; 17 releases; 63 open issues. Heavy
  AI-agent signs (an `AGENTS.md` running releases, agent tooling files).
- **Quality:** large test suite and CI, including runs on the TV's old Node versions; careful state-file handling.
  But physical-TV acceptance is "pending" across its docs, mostly one OLED (C3). **Open issue #96: arrow keys stop
  after standby on a C5 (webOS 25).** The Helper fails if the remote's device name differs.
- **For HomeTV:** the Helper and installer are separable; the launcher isn't (no plug-in API). Using it means forking
  and pointing the Helper at HomeTV's app id, then keeping up with a project releasing several times a day.

### lasharor/cleanyourtv-WebOS

- **What:** a full home screen (dock, app grid, Inputs, Live TV from your own playlist, add-ons) and an on-TV manager
  app. In upstream's SHOWCASE.
- **Home key and power-on (root only):** at each start, a Homebrew Channel script mounts the launcher over LG's Home
  app **in memory** (webOS 24+), restarts LG's app manager and the services that need it (sound over ARC, video); LG's
  files aren't changed; a restart without the script brings LG's Home back; the installer rolls back if Home doesn't
  come up. One decision table (`helper/tvprofile.js`) picks the method per TV.
- **Install:** root first (not provided), then Homebrew Channel's repository list or one SSH command; updates from
  the on-TV manager, SHA-256 checked.
- **Licence:** MIT; one bundled helper library is GPL-3.0, kept separate; fonts OFL.
- **Activity:** created 2026-10-21; daily releases; one main maintainer plus external contributors; 420 stars.
  AI-assisted commits (credited).
- **Quality:** the best engineered: 53 test files, run on Node 8 and old Chromium too, CI on every change; a written
  security page (loopback-only API, short-lived setup pages with codes, checked downloads); compatibility list with
  sources. Releases not signed yet.
- **Tested:** **43UT7590PUA and 65UT7000PUA on webOS 25 (firmware 33.31.75) work** (community reports
  [#10](https://github.com/lasharor/cleanyourtv-WebOS/issues/10), [#11](https://github.com/lasharor/cleanyourtv-WebOS/issues/11)):
  the closest to the test TV (33.31.61).
- **For HomeTV:** the root route, if ever picked. Its per-TV decision table, mount safety and security design are
  worth copying in any plan (MIT).

### rudra-avatar/Hearth

- **What:** a calm home screen (clock, weather, one row of apps and inputs, themes), Preact and TypeScript, built from
  partridgeworks/webos-launcher.
- **Home key:** without root, **none**: it says so plainly and suggests LG's Quick Access (hold a number key). With
  root, a watcher that sees LG's Home come to the front and opens Hearth (a brief flash of LG's Home), plus an optional
  GPL key hook.
- **Power-on:** root only.
- **No-root extras worth having:** a tiny Node service that talks to the TV's own remote-control port from
  `127.0.0.1`, limited to two read-only calls (the full app list and the inputs), because newer firmware refuses a
  page's own connection. Reported working without root on webOS 26.
- **Install:** Developer Mode with webosbrew's Dev Manager, or Homebrew Channel's repository list (one-click updates).
- **Licence:** MIT (the bundled key hook GPL-3.0, separate); ~25 OFL fonts.
- **Activity:** created 2026-10-17; 327 stars; external contributors and merged pull requests; AI co-authored commits.
- **Quality:** 35+ named tests (Home watcher, power-on, uninstall), not run in CI; good docs; a compatibility table
  built from reports. **Open issue #43 (today): a rooted 2016 TV (webOS 3.4) stuck on its start-up screen after "Add
  Hearth as a TV input"**, back only after many power cycles; the input feature is root-only, but shows how a
  start-up change can go wrong.
- **For HomeTV:** closest in stack (TypeScript); its app-list helper and watcher are good patterns (MIT).

### zzeppieri/webos-custom-home

- **What:** a clock-and-tiles hub (React, Tailwind), weather, an "eARC guard".
- **Home key:** its in-app Node service polls the remote's input devices for key 773 and opens itself (LG's Home shows
  first). The author thinks this may work in Developer Mode; tested only rooted.
- **Power-on:** root (a Homebrew Channel start script); waking from standby by a timer guess (open issue #7: doesn't
  come back after standby).
- **Licence:** MIT. **Activity:** five days in July 2026, nothing since. **Quality:** careful code, **no tests, no
  CI**, one OLED on webOS 24.
- **For HomeTV:** its small Luna-call wrapper (`src/service/luna.ts`) and the idea of watching the remote from an
  app's own service (cheaper than a native helper, if the test TV allows it).

### Shantil-K/OpenLauncher

- **What:** a home screen with video wallpapers and folders.
- **Home key and power-on:** root only, five per-version tricks, including patching LG's own Home program in memory
  for webOS 25-26; the author's notes say the webOS 25 ones are guesses.
- **Licence:** **GPL-3.0** with mixed, partly unclear asset licences. **Activity:** one person, 7 weeks, no pull
  requests. **Quality:** no tests, no CI; tested on one 2022 OLED.
- **For HomeTV:** ideas only.

## Side by side

| | Home key, no root | Power-on | Install for the household | Licence | Activity | Tests | Nearest to the test TV |
|---|---|---|---|---|---|---|---|
| **Razdva122** | **Yes** (native helper, experimental) | Root only | Windows installer, laptop off after | MIT | Very high, one person, AI-heavy | Many + CI | C5 webOS 25: open bug |
| **lasharor** | No (root only) | **Root** | Root, then on-TV manager | MIT | Very high, a few people | Many + CI | **UT7590, UT7000 on webOS 25: work** |
| **Hearth** | No | Root only | Dev Manager or Homebrew | MIT | High, some outside help | Many, no CI | webOS 26 no-root reports |
| zzeppieri | Maybe (untested) | Root | Script or installer | MIT | Stopped in July | None | One OLED, webOS 24 |
| OpenLauncher | No | Root | Sideload | GPL-3.0 | One person | None | One 2022 OLED |

## What HomeTV would take, whatever the plan (all MIT, credited)

- **Hearth:** the app-list helper (a service talking to the TV's own remote-control port from `127.0.0.1`, read-only
  calls only); the compatibility-report form and table.
- **lasharor:** the per-TV decision table, the security design (loopback-only API, short-lived phone pages with codes,
  checked downloads), the list of services to restart.
- **zzeppieri:** the Luna-call wrapper.
- **Razdva122:** the Home helper's design (and its code, if plan B or C).
- **HomeTV's own:** the screens (hometv-tizen and `design_preview/`), the key page and phone notes (hometv-tizen's
  ES5 service), the page updates.

## Plans to pick from

| | Plan | What the test TV gets | Cost to build | Risk | Undo |
|---|---|---|---|---|---|
| **A (recommended)** | **HomeTV as its own Developer Mode app**, our code plus the MIT pieces above. The Home key: chosen after the first call. If the test app shows an app's own service can open the remote's device, our own small watcher (zzeppieri's way, tested on the test TV); if not, Razdva122's native Helper, forked only for that part, pointed at HomeTV | HomeTV with its own tile, opens offline, apps and YouTube titles open from it, key page and phone notes; Home key if the helper works on the test TV; no power-on | ~3-4 days for the first version (screens exist), +1-2 days for the helper | Low; we own the code; the helper is the experimental part, off by default | Delete the app |
| B | **Fork Razdva122** (as AeroTizen for Samsung): our screens in its launcher, keep its Helper and Windows installer | The same as A, plus its installer and renewal (beta) | ~4-5 days, then keeping up with a project releasing several times a day | Medium: a 2-week-old, one-person, AI-heavy base untested on the test TV's model; #96 on webOS 25 | Its uninstall; delete the apps |
| C | **Recommend Razdva122 or Hearth as they are** for now, HomeTV later | Their home screen, not HomeTV's catalogue or prices | ~0.5 day (an install guide) | As B, but nothing of ours to maintain | Their uninstall |
| D | **Root with lasharor** (only if root still works on the test TV's firmware, after a non-root test) | The full thing: Home key and power-on, no 41-day timer | A non-root test first, then ~2-3 days to swap our screens into its launcher | Higher: root, LG updates blocked for good to keep it ([jailbreak.md](jailbreak.md)); conflicts with the decision to leave automatic updates on | Remove its start scripts; restart |

**Why A:** none of the bases is proven on the test TV's model, all are weeks old, and the parts HomeTV needs most (the screens,
the key page, phone notes, page updates) are already ours from Samsung. The only hard LG-specific part is the Home key,
and that's exactly what the first call's test app checks (the "Remote: can the app see it?" button), so the choice
between our own watcher and Razdva122's helper can be made on evidence. Developer Mode's timer is handled the same way
in every no-root plan (a reminder now, renewal later; Razdva122's renewal is a reference).

## Sources

Read 2026-11-04 from GitHub (source, README, docs, API data):
- [Razdva122/clean-your-tv-lg-webos](https://github.com/Razdva122/clean-your-tv-lg-webos) (v1.7.1, tree `e44c056`):
  `native/app/` (detach.c, native.js, helper-entry.js, screen-watch.js), `native/prototype/relay.c`, `filter.c`,
  docs/COMPATIBILITY.md, RECOVERY.md, DEVELOPER-MODE-BETA.md, INSTALL.md, UPDATES.md, AGENTS.md; [#96](https://github.com/Razdva122/clean-your-tv-lg-webos/issues/96).
- [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (`dev` at `3b2158f`): helper/tvprofile.js,
  helper/nativehome.js, scripts/after-sam.sh, compat.json, docs/tested-tvs.md, SECURITY.md, THIRD-PARTY.md, tools/check.sh;
  [docs site](https://lasharor.github.io/cleanyourtv-WebOS/).
- [rudra-avatar/Hearth](https://github.com/rudra-avatar/Hearth) (`e23706b`): README.md, THIRD_PARTY_NOTICES.md,
  src/homehook/, src/homeapp/, services/tld.my.customlauncher.ssap/service.js, docs/COMPATIBILITY.md, package.json;
  [#43](https://github.com/rudra-avatar/Hearth/issues/43).
- [zzeppieri/webos-custom-home](https://github.com/zzeppieri/webos-custom-home) (`41f8fc2`): service/service.js,
  src/service/luna.ts, installer/tv-install.sh; [#7](https://github.com/zzeppieri/webos-custom-home/issues/7).
- [Shantil-K/OpenLauncher](https://github.com/Shantil-K/OpenLauncher) (`8291da9`): Readme.md, src/access/replace/,
  src/appinfo.json, LICENSE.
- [OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack) (`31a518a`), for contrast: an always-on second
  device watches the TV.
