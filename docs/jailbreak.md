# "Jailbreaking" an LG TV: the options, safest first

Research for Rebecca, 2026-11-04, for deciding, not doing. Nothing here has been run on any TV, and this note gives
no exploit steps. **Rebecca, 22:1x: for hometv-webos, explore both rooting and non-rooting options, with the risks;
test without root first, before she decides whether to root.** So: no root on any TV until she picks it, after a
non-root test. (hometv-launcher's AGENTS.md still says no root; that rule is unchanged there.)

**Since 22:35 the plan is root-first, with the way back prepared first: [root-plan.md](root-plan.md).**

## The short version

- **First: LG's Developer Mode plus HomeTV.** It's LG's own switch for app makers, undone by deleting the apps, and
  US law explicitly allows running lawfully obtained apps on a smart TV. Its one LG-specific cost: **it runs out
  every ~41 days** unless extended, and then LG uninstalls the apps.
- **Root is possible on her dad's TV today, very likely** ([below](#her-dads-tv-43ut8000aua)): one tool, SlopBro,
  lists his exact firmware as the newest it's known to work on. Root would give what Developer Mode can't: HomeTV on
  the Home key and at power-on, no 41-day timer, LG's ad services stopped.
- **The price of root:** a young proof-of-concept tool run from the laptop; **firmware updates stopped for good**
  (the next update may close the hole and can't be undone), so no more LG security fixes; SSH and Telnet to lock
  down; a warranty that wouldn't cover damage. And it's a race: an automatic LG update before the decision may close
  it.
- **Never:** the hidden service menus (InStart, EZ-Adjust), hardware mods, flashing firmware.

## Her dad's TV (43UT8000AUA)

From Rebecca's screenshot (only model, webOS version and firmware quoted): **43UT8000AUA, webOS 25, release
10.3.1-3001.** A 2024 UT80 LCD (US, ATSC tuner) that shipped with webOS 24 and has LG's webOS 25
upgrade. On LG's platform: machine `k8lpn2`, OTA id `HE_DTV_W24P_AFADATAA`, webOS 25 software major 33; release
10.3.1-3001 is software version **33.31.61**.

Root tools for exactly this TV, from [CanI.RootMy.TV](https://cani.rootmy.tv)'s data (read 2026-11-04):

| Tool | For this TV | Status | What it is |
|---|---|---|---|
| **SlopBro** | **Very likely works** | Newest known rootable version: **33.31.61, his exact version**. No patched version listed | Run from a computer on the same Wi-Fi; pairs with the TV's remote connection (the TV asks "Allow"), uses an LG bug in a built-in service, then installs Homebrew Channel with persistence. No USB, no Developer Mode. AGPL-3.0, created 2026-06, last commit 2026-09-28. Its author calls it a lightly tested proof of concept; it already carries a workaround for one LG fix attempt. Reported working on webOS 4-11 |
| DangBro | **No** | Works only on TVs with a DVB tuner; this US set has ATSC | - |
| faultmanager | **No** | Patched on this platform from 23.22.60 (webOS 24); not listed for webOS 25 | - |
| DejaVuln, crashd, WTA, ASM | **No** | Older platforms or patched | - |
| **RootMyTV** (v1, v2; MIT; Rebecca's 22:52 link) | **No** | Its own README: patched by LG since mid-2022, and it "never worked on … TVs that came with webOS … 7 (22), or 8 (23)"; his is a 2024 set on webOS 25, and CanI.RootMy.TV lists no RootMyTV entry for it | The first one-click LG root (2021), the origin of Homebrew Channel's install-and-persist step that SlopBro reuses (same end state, same undo: a factory reset). Useful for us: its [warning page](https://rootmy.tv/warning) (never write signed partitions, never `chattr`) and TROUBLESHOOTING (factory reset to clear leftovers), both in [root-plan.md](root-plan.md); and its one-page, run-from-the-TV's-browser flow as an idea for the installer |

What that means, and what's unknown:

- "Newest known rootable version" means someone has reported success on it; it doesn't promise the next version
  fails. Other webOS 25 models are listed as rootable up to 10.3.1-3006 (33.31.68), so a small next update may
  still work. Nobody knows when LG fixes it for good.
- **If the TV updates itself** before a decision, root may become impossible. Keeping the option open means turning
  off automatic software updates on his TV now (Settings › Support › Software Update › Allow Automatic Updates), which
  also delays LG's security fixes. That's Rebecca's call (asked through the proxy). (The menu path is LG's for 2023+
  TVs; medium confidence it's the same on webOS 25.)
- **To read on the first call:** Settings › Support › TV Information: software version **33.31.61** (confirms the
  mapping), and whether automatic updates are on.
- **If she picks root, after the non-root test:** the Developer Mode app must be deleted first (both root tool
  authors: never both); Homebrew Channel's "Block system updates" on; SSH given a key and Telnet off at once;
  lasharor's launcher (tested on a webOS 25 OLED) or Razdva122's Root edition for Home. A rehearsal on another LG
  first, if one is available, would be the careful order.

## The options

| # | Option | What it gives | Needs | Risk of a TV that won't start | After an LG firmware update | Undo | Warranty | For the family TV? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Settings only** ([privacy.md](privacy.md)) | Tracking and Home ads off | The remote | None | Re-check the settings | Settings back | Unaffected | **Yes** |
| 2 | **Developer Mode + HomeTV** | HomeTV as an app; apps opened from it | A free LG developer account; a computer or Android phone once; **Extend monthly** | Very low | Kept (nothing says an update ends it); the Home helper may stop working | Delete the apps; or let the session run out (LG then removes them) | LG's own feature; no LG statement treats it as a modification (inferred) | **Yes** |
| 3 | **Developer Mode + on-TV Home helper** (Razdva122's, or LG-TV-HA-Home-Launcher's) | The Home key opens HomeTV | 2, plus a native helper that reads the remote's key presses | Low (it runs as Developer Mode's limited user; three Home presses stop it) | May stop until the helper is updated | Three Home presses; delete it | As 2 | **Yes, to test** (Rebecca W3: once the model is known; it is now) |
| 4 | **Root on still-unpatched firmware** (for his TV: SlopBro; others: faultmanager-autoroot for webOS 4-10, DejaVuln for 3.5+; checked per model at [CanI.RootMy.TV](https://cani.rootmy.tv)), then Homebrew Channel | Full control: Home and power-on replaced (lasharor), LG's ad services stopped, Developer Mode no longer needed | Firmware LG hasn't patched yet; **no updates afterwards** | Low per the projects ("generally safe... no consequences even if it fails"), not zero: boot loops, and "reckless changes can brick your TV"; SlopBro is a young, lightly tested tool | **Usually ends it, and a TV can't go back to older firmware** | Remove the start-up scripts; Homebrew Channel's failsafe (an emergency shell when a start crashes); factory reset doesn't undo the root itself | Likely refused for damage ("this may void your warranty", RootMyTV) | **Rebecca's pick, after the non-root test** (22:1x); updates blocked for good |
| 5 | **Old root tools** (RootMyTV, crashd, WTA, GetMeNow) | As 4, on old firmware only | Firmware from before 2022-2024 | As 4 | Patched | As 4 | As 4 | **No** |
| 6 | **Hardware "debug" mods** (NVM changes, pre-2018 sets) | Root on very old sets | Opening the TV | **High**; webosbrew warns of permanent damage and dangerous voltages | - | Often none | Voided | **Never** |
| 7 | **Service/factory menus** (InStart, EZ-Adjust; the "NSU Mode" setting) | Panel, region and update-channel settings | A service remote or key codes | Misconfiguration with no clean undo; pre-release firmware | - | Often none | - | **Never** (as AGENTS.md's rule on factory packages) |

## What each changes, in plain words

**2. Developer Mode.** Lets a computer with the TV's key install apps, over SSH on port 9922 as a limited user
(`prisoner`), not root. Key Server (which hands out the key with a six-letter code) can be switched off after the
install. The session timer is the catch: ~1,000 hours, Extend in the Developer Mode app, else LG removes the apps.
It also ends after 10 restarts without a network. Rooted TVs must not have the Developer Mode app (both root tools
say so), so 2 and 4 don't mix.

**3. The Home helper.** A small native program installed with the app that reads the remote's input device and opens
HomeTV when Home is pressed. It works because Developer Mode's user can read that device on some models; LG hasn't
said whether that's intended, and a firmware update can take it away.

**4. Root.** A bug in LG's software gives a shell as root; the tools then install the Homebrew Channel, which runs
start-up scripts, can block firmware updates, and opens SSH (default password `alpine` until a key is set) and an
unauthenticated Telnet: both must be locked down at once. lasharor's launcher then mounts itself over LG's Home in
memory at each start. As of 2025-08-24 (faultmanager's README) the latest firmware for nearly every webOS 5, 6, 7
and 9 model was patched against faultmanager; SlopBro (2026, a different bug) reopened root on current webOS 4-11
firmware, his TV included ([above](#her-dads-tv-43ut8000aua)). Each new tool is followed by an LG fix.

## If something goes wrong

- **HomeTV misbehaves:** Home › Edit App List › delete it; or delete the Developer Mode app (its apps go with it).
- **The helper misbehaves:** Home three times within two seconds, then delete it.
- **Settings in a mess:** Reset to Initial Settings (2021-2025: General › System; 2020: Support; older: General).
  It removes every app and turns every privacy switch back on.
- **A rooted TV that won't start:** Homebrew Channel's failsafe shell, or a factory reset; LG's USB firmware update
  installs the current firmware (which ends root). Older firmware can't be put back.

## Warranty and the law (US)

- LG's terms (seen in its general US warranty wording) exclude damage from "modification" and use "other than as
  authorized by LG"; no LG text names Developer Mode or root. Developer Mode is LG's own feature: very unlikely to
  matter. A TV damaged after root wouldn't be repaired for free. Under the Magnuson-Moss Act a maker can refuse a
  repair caused by a modification, not the whole warranty.
- The DMCA exemption for smart TVs (37 CFR 201.40(b)(10), renewed October 2024) allows getting around a TV's locks to
  run lawfully obtained apps or remove software. Options 2-3 fit it; root's legality is covered too, but not the
  warranty. Not legal advice.

## Recommendation

1. **Now:** options 1 and 2 on his TV, then 3 as a test (Rebecca's W1/W3). That's the non-root test she asked for.
2. **Decide on root after that test**, with this page. If the non-root version does what the family needs (an app
   they open, monthly Extend, the Home helper working on his model), stay there. If power-on, the Home key or the
   timer are the problem, root with SlopBro is the only route on his TV, at the cost of LG's updates for good.
3. **Before the decision:** whether to turn off automatic updates to keep root possible (her call; asked).
4. **Never:** options 5-7.

## Sources

- LG: [Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) (timer, removal).
- webosbrew: [rooting overview](https://www.webosbrew.org/rooting/), [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) (MIT; failsafe, SSH, Telnet, Block system updates),
  [CanI.RootMy.TV](https://cani.rootmy.tv).
- Root tools (read for status only): [SlopBro](https://github.com/throwaway96/slopbro) (AGPL-3.0, README at `21023d5`, 2026-09-28),
  [faultmanager-autoroot](https://github.com/throwaway96/faultmanager-autoroot) (AGPL-3.0, status 2025-08-24),
  [dejavuln-autoroot](https://github.com/throwaway96/dejavuln-autoroot) (AGPL-3.0), [RootMyTV](https://github.com/RootMyTV/RootMyTV.github.io) (MIT, patched since 2022),
  [DangBro](https://azoffshowy.github.io/dangbro/) (DVB only). Per-model status: CanI.RootMy.TV's data (`js/app.20c15735.js`,
  entries `UT8000AUA` and `HE_DTV_W24P_AFADATAA`), read 2026-11-04.
- Helpers: [Razdva122 COMPATIBILITY.md](https://github.com/Razdva122/clean-your-tv-lg-webos/blob/main/docs/COMPATIBILITY.md),
  [LG-TV-HA-Home-Launcher HOME-BUTTON-HELPER.md](https://github.com/mbsintegrations/LG-TV-HA-Home-Launcher/blob/main/docs/HOME-BUTTON-HELPER.md).
- Root launcher: [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS), [tv-changes](https://lasharor.github.io/cleanyourtv-WebOS/tv-changes/).
- LG: [Reset to Initial Settings](https://www.lg.com/us/support/help-library/lg-tv-how-to-reset-your-tv--20154634935200).
- 37 CFR 201.40(b)(10) ([89 FR 85437](https://www.federalregister.gov/documents/2024/10/28/2024-24563/exemption-to-prohibition-on-circumvention-of-copyright-protection-systems-for-access-control-technologies)).
