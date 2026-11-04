# Replacing LG's home screen: what's possible

Research for Rebecca, 2026-11-04, without the TV. Nothing here has been run on any TV. Sources at the end; how sure
each point is, is said where it matters.

## The short version

- **LG's Home key and power-on can't be taken by an app** on a normal (not rooted) LG. LG said so in 2026, and every
  project works around it.
- **Without root, the best there is:** HomeTV as a Developer Mode app, LG's settings set to start on the last input,
  and optionally an **experimental on-TV helper** that catches the Home key and opens HomeTV instead. Razdva122's
  project does exactly this, MIT-licensed, with a Windows installer.
- **With root, Home can be replaced properly** (lasharor's project: Home key and power-on, held only in memory, so a
  restart without its start-up script brings LG's Home back). Root carries the risks in [jailbreak.md](jailbreak.md);
  on her dad's TV it's very likely possible (SlopBro), and it's **Rebecca's pick, only after a non-root test**
  (22:1x).
- **LG's own Home can't be changed** by an app: its banner and recommended row are turned off in settings
  ([privacy.md](privacy.md)); HomeTV covers the rest while it's open.
- **Unlike Samsung, Developer Mode runs out** (~41 days) and takes the app with it: every no-root tier carries the
  monthly Extend ([research.md](research.md), W1).

## Three levels

| | A. Settings only | B. Developer Mode app | C. Root |
|---|---|---|---|
| **What's installed** | Nothing | HomeTV (and optionally a Home helper), installed from a computer or Android phone | B, plus Homebrew Channel and a start-up script |
| **Opens at power-on** | No; Power On Screen (2023+) or Home Auto Launch (2019-2022) skips LG's Home to the last input | No (LG, 2026). Waking from Quick Start+ standby may return to HomeTV if it was open: a TV check | Yes (Home replaced at start; a short black screen first) |
| **Home key** | LG's Home | LG's Home; **with the helper**: HomeTV, after a brief flash of LG's Home, on models where it works | HomeTV directly |
| **LG's ad rows** | Banner and recommendations off in settings | Same; HomeTV covers Home while it's open | Could be stopped (debloat) |
| **Keeps working** | Until a reset | **While Developer Mode is extended** (~monthly) and, for the helper, while its pairing and the Wi-Fi work | Until a firmware update ends root (updates are usually blocked, which blocks security fixes too) |
| **Undo** | Settings back | Delete the apps; Developer Mode off | Remove the start-up script and restart; [jailbreak.md](jailbreak.md) |
| **Risk** | None | Low (the helper: per model, experimental) | Higher: a young root tool, LG's updates stopped for good |

## How the existing ones do it

**Razdva122/clean-your-tv-lg-webos** ([repo](https://github.com/Razdva122/clean-your-tv-lg-webos), MIT, v1.7.1, read
2026-11-04; commits daily). A home screen (apps, dock, themes, inputs, Wi-Fi shortcut) built on webos-vibehack and
upstream cleanyourtv, with a graphical installer for Windows, Mac, Linux and Android phones. Two editions:

- **No-root:** HomeTV-like Home app plus an on-TV **Home Helper** (a small program installed with it). It needs an
  active Developer Mode with Key Server, LG's remote connection paired from the TV itself, and "native input access"
  to the remote: it reads the Home key press and opens the launcher. Press Home three times within two seconds to
  stop it and get LG's Home back. Its own limits: Developer Mode renewal is "optional Beta, unverified on unrooted
  TVs"; returning can briefly show LG's Home; startup can show black or LG's Home first; tested no-root only on
  community C4 reports with open questions; C5 (webOS 26), BX (webOS 5) and others "unverified".
- **Root:** native Home routing, independent recovery, updates on the TV. Tested on a C3 (firmware 43.21.71).

**OmkarK97/webos-vibehack** ([repo](https://github.com/OmkarK97/webos-vibehack), MIT). The Apple TV-style home from
upstream's tv-vibehack as a webOS app, no root. Its Home return runs on **another computer**: a script on a Mac or
Raspberry Pi watches which app is on screen over LG's remote connection and opens the launcher when LG's Home appears
(~0.1 s). Home twice within 3 seconds stays on LG's Home. Tested on one TV (C6, webOS 26). Its installer is for Mac.

**mbsintegrations/LG-TV-HA-Home-Launcher** ([repo](https://github.com/mbsintegrations/LG-TV-HA-Home-Launcher)). A
Home Assistant-driven home screen. Its Home-button helper is a native program in the app package that reads the
remote's input device (`LGE M-RCU`, Linux key 773 for Home), no root; it lists the models it works on (a 2019 B9,
a NANO76) and calls itself experimental. Useful as a second, independent account of how the helper works.

**lasharor/cleanyourtv-WebOS** ([repo](https://github.com/lasharor/cleanyourtv-WebOS), MIT, in upstream's
SHOWCASE). **Root only** (Homebrew Channel). At each start its script mounts the launcher over LG's Home, in memory
only (webOS 24+: over the Home app's folder; webOS 5-23: a stand-in for LG's Home program), so the Home key and
power-on open it. LG's files aren't changed; a restart without the script brings LG's Home back, and if the launcher
doesn't come up in 30 seconds the stand-in removes itself. Optional debloat stops LG's ad services. Its docs list
per-model side effects it had to fix (HDMI-CEC, sound over ARC, black video after restarting LG's app manager).
webOS 5 (2020) and newer only. Its security page (every port, token and allow-list) is a good model for HomeTV's.

**webosbrew** ([webosbrew.org](https://www.webosbrew.org)): the community behind the Homebrew Channel (MIT; an app
store, and with root the start-up scripts, SSH, update blocking), Dev Manager (Apache-2.0, a desktop installer that
can renew Developer Mode) and youtube-webos (GPL-3.0, an ad-free YouTube). Not a home screen.

## Which to build on

| Project | Licence | Root? | Installer | Home key | Tested | Fit for HomeTV |
|---|---|---|---|---|---|---|
| **Razdva122/clean-your-tv-lg-webos** | MIT | No (and a root edition) | Windows, Mac, Linux, Android | On-TV helper | C3 (root), C4 (no-root, community) | **Best base**: the installer, the helper and the recovery are the hard, LG-specific parts |
| OmkarK97/webos-vibehack | MIT | No | Mac script | Another computer watches | C6 | Simpler, but needs an always-on second device |
| mbsintegrations/LG-TV-HA-Home-Launcher | **GPL-3.0** (copying its code would make HomeTV's webOS app GPL) | No | Home Assistant | On-TV helper | B9, NANO76 | Second source for the helper, ideas only; needs Home Assistant |
| lasharor/cleanyourtv-WebOS | MIT | **Yes** | Homebrew Channel | Takes Home over | G2 (OLED65G26LA), webOS 25 | **The root base**, if Rebecca picks root: the most complete, tested on webOS 25 |

Licences checked from each repo's LICENSE file on 2026-11-04 (GitHub's licence badge can't read the MIT ones, which
carry two copyright lines). Razdva122's also ships a font under the SIL OFL. Last pushes: Razdva122 and lasharor
2026-11-04, mbsintegrations 2026-11-02, webos-vibehack 2026-10-19.

**Recommendation:** HomeTV's screens (from hometv-tizen and `design_preview/`) on Razdva122's No-root base, as
builder-4 did with AeroTizen: its installer and Home Helper, its MIT licence kept and credited. Less proven than
AeroTizen (its own docs mark most models unverified; none is a UT80), so the first TV call checks it on his TV before
anything is built on it. Whether to build on it is Rebecca's call (asked 22:18, as she decided AeroTizen for Samsung).

## What HomeTV should do on LG

1. **Be a Developer Mode app** with its own tile, packaged so it opens offline.
2. **LG's start settings**, set by the household from a short guide: Power On Screen (or Home Auto Launch) to the last
   input, Quick Start+ on, Home Promotion and Content Recommendation off.
3. **The Home helper: off by default** (the fork's rule), only after it's been checked on his TV, with the
   three-presses way out explained.
4. **A Developer Mode reminder** inside HomeTV (Rebecca W1 (a)), if it can read the time left; else a date it keeps.
5. **No root** until Rebecca picks it after the non-root test; then lasharor's base for Home and power-on.

## What it costs the household

- An LG developer account and the Developer Mode app; a computer (or Android phone) once.
- **Extend every month** (or a phone, PC or Home Assistant that does it), else HomeTV is uninstalled.
- With the helper: LG's remote connection paired to the TV itself, and a small program running while the TV is on.
- A firmware update may stop the helper until it's updated; HomeTV itself still opens from its tile.

## Undo

- Settings: back to the photos taken first ([privacy.md](privacy.md) step 0).
- The helper: Home three times within two seconds stops it; delete it with the installer.
- HomeTV: Home › Edit App List › delete, or the installer's uninstall.
- Developer Mode: delete the Developer Mode app (its apps go with it).

## Sources

- Razdva122: [README](https://github.com/Razdva122/clean-your-tv-lg-webos), [COMPATIBILITY.md](https://github.com/Razdva122/clean-your-tv-lg-webos/blob/main/docs/COMPATIBILITY.md) (read 2026-11-04, v1.7.1).
- OmkarK97: [README](https://github.com/OmkarK97/webos-vibehack).
- mbsintegrations: [HOME-BUTTON-HELPER.md](https://github.com/mbsintegrations/LG-TV-HA-Home-Launcher/blob/main/docs/HOME-BUTTON-HELPER.md).
- lasharor: [README](https://github.com/lasharor/cleanyourtv-WebOS), [what it changes on the TV](https://lasharor.github.io/cleanyourtv-WebOS/tv-changes/),
  [security](https://lasharor.github.io/cleanyourtv-WebOS/security/).
- webosbrew: [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), [Dev Manager](https://github.com/webosbrew/dev-manager-desktop),
  [youtube-webos](https://github.com/webosbrew/youtube-webos).
- LG: [no auto-launch at power-on](https://forum.webostv.developer.lge.com/t/how-to-make-the-app-launch-automatically-after-power-on/28121) (2026);
  [Power On Screen / Home Auto Launch](https://www.lg.com/in/support/product-support/troubleshoot/help-library/cs-CT52006899-20155412187966/).
- Upstream cleanyourtv: [SHOWCASE › Other platforms](https://github.com/Gathin23/cleanyourtv/blob/main/SHOWCASE.md#other-platforms-fire-tv-and-lg-webos).
