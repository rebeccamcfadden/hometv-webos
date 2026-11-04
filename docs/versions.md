# Versions on LG (draft for Rebecca to sort)

**Draft, 2026-11-04.** Rebecca (22:36): "break all the features into v0 (first install test features), v1, v2, etc.
i want to get the gist of the layout and design in first and then ship updates to those launchers if my dad likes
the look/feel". Move rows between tables freely; nothing here is decided.

Her base and order (22:35, 22:39): one launcher of our own with the best pieces of the other LG projects, installed
**unrooted first as a check**, then **rooted only after a rigorous backup and unroot setup**. LG's automatic updates
stay on (22:23), so root may go away and HomeTV must carry on as an app.

Size: **S** half a day or less, **M** one or two days, **L** more. TV call: can only be checked on her dad's TV (at
most once a week). "Keys" = needs the household's API keys on the TV. "In hometv-tizen" = built for Samsung, to be
ported (the screens are web pages, so most carry over).

Open points for Rebecca: v0's catalogue, the sample one (no keys) or real TMDB with a key the installer puts on the
TV? Is root (steps 5-7) on the first call, or a second call once the unroot path is proven?

## v0: the first install, to judge the look and feel

| Description | Size | TV call needed | Built |
|---|---|---|---|
| **1. Laptop check**, nothing installed: model and firmware, his apps, Netflix and YouTube open, a YouTube title, the inputs (LG's "Allow" prompt) | S | Yes | Being built |
| **2. Install unrooted**: LG developer account, Developer Mode, HomeTV from the laptop; opened from its tile | S | Yes | Packaging works (test app) |
| **Checks screen**: the key page reached from a phone, can the app see the remote (for the Home key), Developer Mode time left | S | Yes | Built (test app, pretend TV) |
| **3. Backup**: the settings the laptop can read saved to a file, photos of the rest, his apps, the privacy switches as they were | S | Yes | Not built |
| **4. Unroot path** written and checked on paper (what root changes, how each part is undone, what a factory reset and an LG update do, USB recovery), and what only the TV can prove | M | No (paper); Yes (proof) | Research running |
| **5. Before root**: HomeTV and the Developer Mode app removed (a rooted TV must not have it) | S | Yes | Not built |
| **6. Root**, if his firmware still allows it (SlopBro), Homebrew Channel; SSH key set, Telnet off | S | Yes, with Rebecca's go | Not built |
| **7. HomeTV through Homebrew Channel**, on the Home key and at power-on (lasharor's / Hearth's methods, credited) | M | Yes | Not built |
| **If root isn't possible or not wanted**: HomeTV stays the Developer Mode app (Extend monthly) | S | No | Packaging works |
| **Installer**: one Windows window, step by step, stops on any failed check | M | No | Not built |
| **Home**: top bar (greeting, date, clock), nav (Home, Movies, TV Shows, Search), app row | S | No | In hometv-tizen |
| **App row**: his real apps (from the TV's list), opens each | S | Yes (app ids) | Launch built (test app) |
| **All apps**: the TV's apps; hold OK to add or remove from Home | M | No | In hometv-tizen |
| **Movies and TV Shows**: list chips, poster grid, Sort, Filters | M | No | In hometv-tizen |
| **Title page**: details, Watch, Where to watch with prices, Episodes, Cast & crew, More like this | M | No | In hometv-tizen |
| **Search**: on-screen keyboard, recents, results | M | No | In hometv-tizen |
| **Person page** | S | No | In hometv-tizen |
| **Sample catalogue**: real titles and posters (needs internet), mock prices, US | S | No | In hometv-tizen |
| **Midnight look** (the design's colours and type, shared package) | S | No | In hometv-tizen |
| **Watch** opens the app (YouTube opens the video) | S | Yes | Launch built (test app) |
| **Remote**: D-pad, OK, Back on every screen; Back from an app lands on HomeTV | S | Yes (Back from Netflix) | Not built |

## v1: real data and everyday use

| Description | Size | TV call needed | Built |
|---|---|---|---|
| **Key page**: a QR on the TV, keys typed on a phone | S | Yes | In hometv-tizen (W1); phone page built (test app) |
| **Live catalogue** from TMDB (needs keys) | L | No | Not built |
| **Live prices** and where to watch (Watchmode / Movie of the Night / iTunes; needs keys) | M | No | Not built |
| **Included services** from his installed apps | S | No | Not built |
| **Works offline**: last catalogue kept on the TV | M | No | Not built |
| **TMDB sign-in** by QR; My list, Seen, Favorites; shown lists as chips | M | No | Not built |
| **Pick for me** | S | No | Not built |
| **Phone notes** (Send to TV from a phone) | M | Yes | Not built |
| **First-run checklist** | S | No | Not built |
| **Weather** in the top bar (Open-Meteo, city, °F) | S-M | No | Not built |
| **Inputs**: HDMI with device names | S | Yes | Not built |
| **Nav buttons** Wi-Fi, Inputs, Settings and their dropdowns | M | No | Not built |
| **Netflix opens the title** (old link form), if the first call showed it works | S | Yes | Check built (test app) |
| **Page updates**: a newer, signed HomeTV page kept on the TV | M | No | In hometv-tizen (W2) |
| **"An update removed root"**: HomeTV notices, says it's now an app on its tile, how to get help | S | Yes (only when it happens) | Not built |
| **Developer Mode reminder** (only on the no-root path) | S | Yes | Check built (test app) |

## v2: polish and extras

| Description | Size | TV call needed | Built |
|---|---|---|---|
| **Themes**, Seasonal themes, Motion settings | M | No | Not built |
| **Clock screensaver** | S | No | Not built |
| **Privacy**: a guided checklist screen for his TV's year; a read-only check that the switches stay off | M | Yes | Research done (privacy.md) |
| **Debloat with root**: stop LG's ad and telemetry services, undoable | M | Yes | Not built |
| **Home row apps** settings (reorder, hide) | S | No | Not built |
| **Tile menu** (hold OK: move, hide) | S | No | Not built |
| **Continue watching** row (Rebecca's Samsung item; LG equivalent unknown) | M | Yes | Research needed |
| **Developer Mode automatic renewal** (no-root path only) | M | Yes | Not built |
| **App updates without the laptop** (root: Homebrew Channel's update list) | M | Yes | Not built |

## Later or maybe

| Description | Size | TV call needed | Built |
|---|---|---|---|
| **Phone remote** on LG (back burner, as on Samsung) | M | Yes | Not built |
| **Cards per row** / square cards; rename inputs, hide empty ports; fireplace tile (her F48 picks for Android) | S each | No | Not built |
| **A row in upstream's SHOWCASE.md**, once it works and is public | S | No | - |
