# "Jailbreaking" an LG TV: the options, safest first

Research for Rebecca, 2026-11-04, for deciding, not doing. Nothing here has been run on any TV, and this note gives
no exploit steps. **AGENTS.md's hard rules say no root**, so root is out for the family TV unless Rebecca changes
that rule; it's described here only so the choice is an informed one.

## The short version

- **Recommended for the family TV: LG's Developer Mode plus HomeTV, nothing more.** It's LG's own switch for app
  makers, undone by deleting the apps, and US law explicitly allows running lawfully obtained apps on a smart TV.
  Its one LG-specific cost: **it runs out every ~41 days** unless extended, and then LG uninstalls the apps.
- **Root exists for many LG TVs**, but it's a race: LG patches each hole, a TV can only be rooted on firmware that
  hasn't had the fix, and the community's advice is then to **stop firmware updates for good**, which also stops
  security fixes. **Not for the family TV.**
- **Never:** the hidden service menus (InStart, EZ-Adjust), hardware mods, flashing firmware.

## The options

| # | Option | What it gives | Needs | Risk of a TV that won't start | After an LG firmware update | Undo | Warranty | For the family TV? |
|---|---|---|---|---|---|---|---|---|
| 1 | **Settings only** ([privacy.md](privacy.md)) | Tracking and Home ads off | The remote | None | Re-check the settings | Settings back | Unaffected | **Yes** |
| 2 | **Developer Mode + HomeTV** | HomeTV as an app; apps opened from it | A free LG developer account; a computer or Android phone once; **Extend monthly** | Very low | Kept (nothing says an update ends it); the Home helper may stop working | Delete the apps; or let the session run out (LG then removes them) | LG's own feature; no LG statement treats it as a modification (inferred) | **Yes** |
| 3 | **Developer Mode + on-TV Home helper** (Razdva122's, or LG-TV-HA-Home-Launcher's) | The Home key opens HomeTV | 2, plus a native helper that reads the remote's key presses | Low (it runs as Developer Mode's limited user; three Home presses stop it) | May stop until the helper is updated | Three Home presses; delete it | As 2 | **Maybe**, only once checked on the family's model and if Rebecca picks it (W3) |
| 4 | **Root on still-unpatched firmware** (faultmanager-autoroot for webOS 4-10, DejaVuln for 3.5+; checked per model at [CanI.RootMy.TV](https://cani.rootmy.tv)), then Homebrew Channel | Full control: Home and power-on replaced (lasharor), LG's ad services stopped, Developer Mode no longer needed | Firmware LG hasn't patched yet; **no updates afterwards** | Low per the projects ("generally safe... no consequences even if it fails"), not zero: boot loops, and "reckless changes can brick your TV" | **Usually ends it, and a TV can't go back to older firmware** | Remove the start-up scripts; Homebrew Channel's failsafe (an emergency shell when a start crashes); factory reset doesn't undo the root itself | Likely refused for damage ("this may void your warranty", RootMyTV) | **No** (AGENTS.md; and updates blocked) |
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
memory at each start. As of 2025-08-24 (faultmanager's README): the latest firmware for nearly every webOS 5, 6, 7
and 9 model is patched; 2025 models are only open on their factory firmware, before any update. So root on a TV that
has been updating normally is most likely already impossible.

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

Options 1 and 2 for the family TV; 3 only once checked on the family's model and if Rebecca picks it. Options 4-7:
not in any guide for the family. Option 4 on a TV of Rebecca's own would be her separate decision, with this warning,
and a change to AGENTS.md's rule for this repo.

## Sources

- LG: [Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) (timer, removal).
- webosbrew: [rooting overview](https://www.webosbrew.org/rooting/), [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) (MIT; failsafe, SSH, Telnet, Block system updates),
  [CanI.RootMy.TV](https://cani.rootmy.tv).
- Root tools (read for status only): [faultmanager-autoroot](https://github.com/throwaway96/faultmanager-autoroot) (AGPL-3.0, status 2025-08-24),
  [dejavuln-autoroot](https://github.com/throwaway96/dejavuln-autoroot) (AGPL-3.0), [RootMyTV](https://github.com/RootMyTV/RootMyTV.github.io) (MIT, patched since 2022).
- Helpers: [Razdva122 COMPATIBILITY.md](https://github.com/Razdva122/clean-your-tv-lg-webos/blob/main/docs/COMPATIBILITY.md),
  [LG-TV-HA-Home-Launcher HOME-BUTTON-HELPER.md](https://github.com/mbsintegrations/LG-TV-HA-Home-Launcher/blob/main/docs/HOME-BUTTON-HELPER.md).
- Root launcher: [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS), [tv-changes](https://lasharor.github.io/cleanyourtv-WebOS/tv-changes/).
- LG: [Reset to Initial Settings](https://www.lg.com/us/support/help-library/lg-tv-how-to-reset-your-tv--20154634935200).
- 37 CFR 201.40(b)(10) ([89 FR 85437](https://www.federalregister.gov/documents/2024/10/28/2024-24563/exemption-to-prohibition-on-circumvention-of-copyright-protection-systems-for-access-control-technologies)).
