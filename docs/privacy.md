# LG TV: turning off tracking, analytics and ads

Research for Rebecca, 2026-11-04. Nothing here has been run on any TV. Upstream's guide
([cleanyour.tv/not-android](https://cleanyour.tv/not-android)) already covers LG's main switches for 2020-2026 and a
short DNS table; this goes further: every webOS year back to 2017, which agreements are optional, Always Ready and
Quick Start+, LG Channels, a longer DNS table with what each name does, and what can be scripted. Every step says
what it stops, what it can break, and how to undo it. Paths are for US TVs in English.

## The short version

1. **Settings with the remote** (15-20 minutes, no risk): Live Plus off, the optional User Agreements withdrawn,
   Limit Ad Tracking on and the ad ID reset, Home Promotion and Content Recommendation off, Screen Saver Promotion
   off (2024+), "Hi LG" off if nobody uses voice. A 2024 university study measured that LG's ACR opt-out really
   stops the TV sending what's on screen.
2. **Optional:** Always Ready off (2022+, on by default: the TV listens for "Hi LG" while "off"); LG Channels off if
   nobody watches it.
3. **A DNS blocker** (optional, more effort): blocks LG's ad, ACR and telemetry servers for the whole TV. **Never
   block** the update servers, the Content Store, or `us.lgtvsdp.com` (the clock: Plex, Max and YouTube fail without
   it).
4. **What stays, whatever you do:** ads inside apps, the account and terms needed for the Content Store, update
   check-ins, the TV scanning the home network.
5. **Check again after a factory reset** (everything comes back on) **and after a firmware update** (several reports
   of switches back on).
6. **Scripts:** no script can set these switches without root (verified from Home Assistant's library). What's worth
   scripting is a **read-only check**, not the clicking.

## 0. Before changing anything

- **Photograph each settings screen first.** LG TVs have no settings export; the photos are the backup.
- **Find the TV's year:** press Mute three times (Quick Launch shows the webOS version), or Settings › All Settings ›
  Support › About This TV. The model code says it too:

| Year | webOS | LCD letter (e.g. 55**N**ANO…, 55UQ…) | OLED |
|---|---|---|---|
| 2017 | 3.5 | J | B7, C7, E7, W7 |
| 2018 | 4.0 | K | B8, C8, E8, W8 |
| 2019 | 4.5 | M | B9, C9, E9, W9 |
| 2020 | 5.0 | N | BX, CX, GX, WX |
| 2021 | 6.0 | P | A1, B1, C1, G1 |
| 2022 | 22 | Q | A2, B2, C2, G2 |
| 2023 | 23 | R | A3, B3, C3, G3 |
| 2024 | 24 | T | B4, C4, G4 |
| 2025 | 25 | A | B5, C5, G5 |
| 2026 | 26 | B | B6, C6, G6 |

(Medium confidence for the LCD letters: an aggregator's table of LG's naming. The OLED names are LG's own.)

## 1. Settings with the remote

"Gear" is the Settings button; then **All Settings**. LG moves things between years: if a path doesn't match, look
one level up or down, or use the settings search on 2023+ TVs.

### Where things are, by year

| Year (webOS) | Live Plus | Home Promotion, Content Recommendation | Quick Start+ |
|---|---|---|---|
| 2017-2018 (3.5, 4.0) | General › Live Plus (low confidence: LG's manuals for these years are offline) | General › Home Settings (low confidence) | General › Quick Start+ |
| 2019 (4.5) | General › Additional Settings › Live Plus | General › Additional Settings › Home Settings | General › Quick Start+ |
| 2020 (5.0) | General › Additional Settings › Live Plus (missing on some 2020 sets) | General › Additional Settings › Home Settings | General › Additional Settings › Quick Start+ |
| 2021-2022 (6.0, 22) | General › Additional Settings › Live Plus | General › System › Additional Settings › Home Settings | General › Devices › TV Management › Quick Start+ |
| 2023-2025 (23-25) | General › System › Additional Settings › Live Plus | General › System › Additional Settings › Home Settings | General › System › Additional Settings › Quick Start+ |
| 2026 (26) | System › Additional Settings › Live Plus (System is now top level) | System › Additional Settings › Home Settings | System › Additional Settings › Quick Start+ |

**User Agreements** (every year from 2019): Support › Privacy & Terms › User Agreements.
**Advertising** (2021+): Support › Privacy & Terms › Advertising (2026: System › Additional Settings › Support ›
Privacy & Terms › Advertisement); 2020 and older: General › Additional Settings › Advertising Cookies, if present.

### The switches

| Switch | Turn it | What it stops | What it breaks | Undo |
|---|---|---|---|---|
| **Live Plus** (LG's ACR) | Off | The TV recognising what's on screen (live TV, HDMI, apps) and reporting it to LG Ad Solutions (formerly Alphonso) | "Recommended for you" and Who.Where.What? pop-ups. Apps, inputs and updates keep working | On |
| **User Agreements: the optional ones** | Untick all but **Terms of Use** and **Privacy Policy**, Agree; the TV restarts | Viewing Information (the data Live Plus sends), Voice Information, Interest-Based Advertising, Marketing pop-ups; Who.Where.What? and Do Not Sell where listed | Voice search; personal rows. Nothing else | Tick them again, Agree |
| **Terms of Use, Privacy Policy** | **Leave agreed** | - | **The Content Store and most smart features stop** (LG: "the TV may restrict access to Smart features until acceptance is completed") | Agree again |
| **Limit AD Tracking** | On | Ads chosen from the ad ID's profile | Nothing: ads still show, untargeted | Off |
| **Reset AD ID** (same screen) | Press once | Cuts off the profile built so far | Nothing | Nothing to undo |
| **Do Not Sell My Personal Information** (US) | On | Sale or sharing of data with third parties | Nothing. **Doesn't stop LG's own collection**: pair it with Live Plus off (Consumer Reports) | Off |
| **Home Promotion** | Off | The sponsored banner on Home | Nothing: a plain background instead | On |
| **Content Recommendation** | Off | The recommended-content row on Home | Nothing | On |
| **Screen Saver Promotion** (2024+) | Off: System › Additional Settings › Screen Saver Settings | Ads on the screensaver | Nothing | On |
| **AI Recommendations** (2026) | Off: General › AI Service › LG AI Settings | AI-picked rows | Nothing | On |
| **"Hi LG" hands-free voice** | Off, if nobody uses it (General › Voice, or Additional Settings, by year) | The TV's microphone listening for its wake word | "Hi LG"; the remote's microphone button still works | On |
| **Hardware microphone switch** (some models) | Off | The TV's built-in microphone, in hardware | Hands-free voice | Switch it back |
| **Always Ready** (2022+, on by default) | Off: General › Always Ready | The TV staying half on (wallpaper, music, listening for "Hi LG") when switched off | Ambient mode and voice wake | On |
| **Quick Start+** | The household's choice | Off: a true standby, nothing running while off | Off: slower start; and the "start on the last input" setting needs it on (LG). **Keep it on if HomeTV relies on waking where it was** | Back as it was |
| **Power On Screen** (2023+) / **Home Auto Launch** (2019-2022) | "Last input" / Off | The TV starting on LG's Home | Nothing | Back as it was |
| **LG Channels** | Off, if nobody watches it: Settings › Channels › LG Channels (medium confidence on the path) | LG's free ad-supported channels in the channel list | Those channels | On |
| **LG account / ThinQ** | Sign out, if nobody uses ThinQ | Account-linked recommendations, phone-app links | ThinQ phone remote, sync | Sign in |

**Copilot on Home** (a Microsoft shortcut added in December 2025): Microsoft retires it from LG TVs on
1 December 2026 (PCMag, October 2026). Until then, delete it like any home-row icon if the TV offers it.

### Apps on the home row

| Step | How | Effect | Undo |
|---|---|---|---|
| **Apps nobody uses** | Home › the app list › far right › Edit App List › the app › bin icon | Removes store apps (and their local data; accounts stay with the service) | Reinstall from the Content Store |
| **LG's own apps without a bin icon** | Leave them; hide by moving them to the end | They're system apps; LG doesn't allow removing them | - |

Whether removing an app from the row also stops its background parts: unknown.

## 2. Network: blocking LG's tracking servers

The switches only turn off what LG lets you. A DNS blocker stops the TV finding the servers at all. Three ways, as
upstream explains them, easiest first: a blocking DNS typed into the TV (Settings › Network › Wi-Fi or Wired ›
Advanced › DNS, enter manually; e.g. AdGuard's `94.140.14.14`; undo: back to automatic), a blocking DNS for the
whole home (NextDNS, Pi-hole, AdGuard Home), and a router rule catching TVs that go around it.

| Names | What they do | Block? | Breaks if blocked |
|---|---|---|---|
| `lgsmartad.com` and its `us.`, `us.ad.`, `info.`, `us.info.` names; `lgads.tv` | LG's ad servers | **Block** | Nothing that works |
| `alphonso.tv` (all names) | ACR: where Live Plus's data goes (the IMC 2024 study traced LG's ACR traffic here) | **Block** | Nothing |
| `ad.lgappstv.com`, `ibis.lgappstv.com`, `us.ibs.lgappstv.com` | Ads in the store and on Home | **Block** | Nothing |
| `cdpbeacon.lgtvcommon.com`, `us.cdpbeacon.…`, `us.cdpsvc.…`, `aic.cdpsvc.…`, `aic.cdpbeacon.…` | Usage telemetry ("customer data platform") | **Block** | None reported |
| `homeprv.lgtvcommon.com`, `us.homeprv.lgtvcommon.com` | The Home Promotion banner | **Block** | The banner (the point) |
| `recommend.lgtvcommon.com`, `us.recommend.lgtvcommon.com` | The recommendation row | **Block** | The row (the point) |
| `nudge.`, `us.nudge.`, `rdl.`, `us.rdl.lgtvcommon.com` | Pop-up "nudges" and pushed settings | Block | None reported (low confidence) |
| `yumenetworks.com`, `smartclip.com`, `smartclip.net` | Third-party ad networks in LG's ads | **Block** | None reported |
| `us.lgtvsdp.com` | **The clock** and some app services | **Never** | Clock resets to 2019 after a restart; Plex, Max and YouTube fail (Perflyst [#117](https://github.com/Perflyst/PiHoleBlocklist/issues/117), upstream) |
| `lgtvsdp.com`, `lgappstv.com` (the bare names) | The Content Store | **Never** | Store and installs |
| `ngfts.lge.com`, `aic-ngfts.lge.com` | Store pictures, some AI features | **Never** (Perflyst) | Blank store tiles |
| `snu.lge.com`, `su.lge.com`, `nsu.lge.com` | Firmware updates | **Never** | Security updates |

**Lists:**

| List | Notes |
|---|---|
| [Perflyst `SmartTV.txt`](https://github.com/Perflyst/PiHoleBlocklist) | **Recommended to start**: short, all brands, its comments mark what *not* to block |
| [HaGeZi `native.lgwebos`](https://github.com/hagezi/dns-blocklists) | Maintained, broad (~1,700 names incl. every country's `nextlgsdp.com`); check it leaves the never-block names alone |
| [furkan-bayrak/lg-tv-blocklist](https://github.com/furkan-bayrak/lg-tv-blocklist) | Newer, safe and strict tiers; less established |

**Catch the TV going around it:** if the blocker's log shows nothing from the TV, it's asking another DNS; a router
rule fixes that: send all outgoing port 53 to the blocker and block port 853 (DNS over TLS); upstream links guides for
pfSense, OpenWrt, OPNsense, MikroTik and UniFi. Most internet-provider routers can't. HaGeZi's `doh-vpn-proxy-bypass`
list stops devices going around it over DNS-over-HTTPS or VPNs. **A guest or IoT network** for the TV keeps it apart
from the home's computers (LG TVs scan the home network, with no switch for it; CyberInsider, Sep 2026); casting then
needs the phone on that network too, unless the router passes mDNS between them.

**NextDNS, if used:** its "Native Tracking Protection" has **no LG entry** (upstream checked its list): add HaGeZi's
`native.lgwebos` from the Blocklists tab. Its free plan (300,000 queries a month) **stops blocking without saying so**
once a TV plus a household passes it.

**Check it from a phone:** upstream's page has a network check (run on a phone on the TV's Wi-Fi) that asks the home's
DNS for LG's tracking names and says whether they're blocked: [cleanyour.tv/not-android#check](https://cleanyour.tv/not-android#check).
It replaces the DNS check this note planned to build.

## 3. What can be scripted

| Script | How | Worth it? |
|---|---|---|
| **Set the privacy switches** | LG's remote connection (SSAP, port 3000/3001, the TV's "Allow" prompt) can only **read** settings (`settings/getSystemSettings`); writing (`com.webos.settingsservice/setSystemSettings`) is a privileged internal call (Home Assistant's `aiowebostv`, webosbrew's notes) | **Not possible** without root |
| **Press the keys through the menus** | SSAP's remote-key socket | **No**: menus differ by year, a script can't see the screen |
| **A read-only check** | Read the settings over SSAP and say which are back on (after an update or reset) | **Yes**: small, safe. Could live in HomeTV's Settings later (a question for Rebecca then) |
| **A guided checklist** | This page's tables, for the family's year only, with a photo per step | **Yes**: fits a family call |
| **A DNS check** | Ask the home's DNS for the tracking names (blocked?) and the never-block names (still there?) | **Yes, already exists**: upstream's phone check ([cleanyour.tv/not-android#check](https://cleanyour.tv/not-android#check)) |
| **Root: block firmware updates, stop LG's ad services** | Homebrew Channel's own "Block system updates" switch (verified in its source); lasharor's optional debloat | **Not for a family TV**: see [jailbreak.md](jailbreak.md). Blocking updates also blocks security fixes |

**Avoid:** brand-new "LG debloat" or "own your TV" root scripts outside webosbrew that turned up in searches. They're
unreviewed, run as root, and two of them match this research's wording suspiciously closely.

**Recommendation:** the checklist for the family's year, Perflyst's list (or AdGuard's DNS typed into the TV) as the
one network step, and a read-only check later. No key-pressing script.

## What can't be removed

- Ads inside apps (YouTube, Tubi, Pluto, Netflix's ad plan): the app's own.
- The Terms of Use and Privacy Policy, for the store and apps.
- Update check-ins: blocking them stops security updates.
- The TV scanning the home network: only a separate network stops it.
- After a factory reset everything is back on; after a firmware update, check again.
- **Last resort (upstream):** keep the TV offline and use a separate streaming box (upstream suggests an Apple TV:
  no ACR). An offline TV gets no security updates; fine while it stays offline.

## Compared with upstream's LG section (cleanyour.tv/not-android#lg, read 2026-11-04)

Upstream has five LG steps (Live Plus, optional agreements, ad tracking, home promotions, "Hi LG"), each checked on
real TVs by contributors (a 2019 C9, a 2022 50UQ75006LG, a 2021-2024 set), a short LG DNS table, and the network
check. Taken from it into this note: NextDNS's missing LG entry and quota, DNS redirection and the bypass list, the
network check, the hardware mic switch, the offline last resort, and two details: if Privacy & Terms has no
Advertisement entry, the agreement in step 2 is the switch; and in Texas, LG agreed in May 2026 to ask for consent
(Texas's December 2025 lawsuit), which covers Texas only. This note adds what upstream doesn't have: 2017-2019 paths,
Always Ready, Quick Start+, LG Channels, the longer DNS table with what each name does, and what can be scripted.

## Sources

- Upstream: [cleanyour.tv/not-android](https://cleanyour.tv/not-android).
- IMC 2024: Ghosh et al., [Watching TV with the Second-Party](https://arxiv.org/abs/2409.06203) (ACR opt-out stops ACR traffic on LG and Samsung).
- LG: [User Agreements](https://www.lg.com/uk/support/product-support/troubleshoot/help-library/cs-CT00008333-20155142857269/),
  [Home Page update, webOS 22 and 6.0](https://www.lg.com/ca_en/support/product-support/troubleshoot/help-library/cs-CT52001643-20153529296666/),
  [Quick Start+ by year](https://www.lg.com/my/support/product-support/troubleshoot/help-library/cs-CT52009126-20155512837498/),
  [Always Ready](https://www.lg.com/ph/support/product-support/troubleshoot/help-library/cs-CT20192009-20153870948774/),
  [Power On Screen / Home Auto Launch](https://www.lg.com/in/support/product-support/troubleshoot/help-library/cs-CT52006899-20155412187966/),
  [Reset to Initial Settings](https://www.lg.com/us/support/help-library/lg-tv-how-to-reset-your-tv--20154634935200),
  [Remove apps (2024)](https://www.lg.com/us/simroom/tvs/user-guide/2024/remove-apps).
- [Consumer Reports: turn off smart TV snooping](https://www.consumerreports.org/electronics/privacy/how-to-turn-off-smart-tv-snooping-features-a4840102036/) (Oct 2025);
  Pocket-lint: [Live Plus](https://www.pocket-lint.com/lg-tv-turn-off-live-plus/), [five settings](https://www.pocket-lint.com/i-stopped-my-lg-tv-from-spying-on-me-by-adjusting-these-settings/),
  [Always Ready](https://www.pocket-lint.com/how-to-completely-turn-off-an-lg-tv/);
  [optoutof.com: LG B6 (2026)](https://optoutof.com/tv/lg/b6-2026/); [glassback.app: LG ACR by year](https://glassback.app/turn-off-acr/lg).
- Copilot: [PCWorld, Dec 2025](https://www.pcworld.com/article/3018846/lg-will-let-tv-owners-remove-microsofts-copilot-app-after-backlash.html),
  [PCMag UK, Oct 2026](https://uk.pcmag.com/ai/168142/lg-tvs-to-remove-copilot-app-after-complaints).
- DNS: [Perflyst SmartTV.txt](https://raw.githubusercontent.com/Perflyst/PiHoleBlocklist/master/SmartTV.txt),
  [HaGeZi native.lgwebos](https://raw.githubusercontent.com/hagezi/dns-blocklists/refs/heads/main/domains/native.lgwebos.txt).
- Scripting: [aiowebostv endpoints.py](https://github.com/home-assistant-libs/aiowebostv/blob/main/aiowebostv/endpoints.py),
  [webosbrew: hidden settings](https://github.com/webosbrew/pages/blob/main/content/pages/hacking/settings.md),
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) (`SettingsPanel.js`, Block system updates).
