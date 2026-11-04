# HomeTV on LG: versions (draft)

**A draft for Rebecca and the lead to move lines between.** Rebecca (22:36, both Samsung and LG): v0 is the first
install test, to judge the layout and the look and feel; later versions ship as updates if her dad likes it. The
install order is hers (22:35): a quick non-root check, then backup and the unroot path, then root and the full install.

Each line: **feature** · cost (S about a day or less, M a few days, L a week or more) · what it depends on.
"Call" means a TV call with her dad (at most weekly). "Keys" means TMDB / Watchmode / Movie of the Night keys.

## v0: the first install test (layout, look and feel)

Install flow (Rebecca 22:39: one launcher of our own, installed unrooted first as the check, then rooted after a
rigorous backup and unroot setup)
- Quick check from the laptop before installing anything (model and firmware; open Netflix and YouTube; the app list; a YouTube title) · S · call 1, the TV's "Allow" prompt
- HomeTV installed **unrooted** through Developer Mode, opened from its tile: the look-and-feel check, plus the checks screen (key page from a phone, whether the app can see the remote) · S · LG developer account, Developer Mode, call 1
- Backup: the settings the laptop can read saved to a file, photos of the rest, the app list, the privacy switches as they were · S · call 1
- The unroot path, written and checked on paper before any root, with what only the TV can prove · M · research (running)
- Before root: HomeTV and the Developer Mode app removed (a rooted TV must not have the Developer Mode app) · S · -
- Root, if his firmware still allows it (SlopBro), Homebrew Channel, SSH key set and Telnet off · S · call 1 or 2, Rebecca's go
- HomeTV reinstalled through Homebrew Channel, on the Home key and at power-on · M · root; pieces from lasharor's / Hearth's methods
- If root isn't possible (an update closed it) or isn't wanted: HomeTV stays the Developer Mode app · S · Extend monthly
- The installer itself (Windows, one window, step by step, stops on any failed check) · M · the steps above

Screens (layout and navigation, real enough to judge)
- Home: clock, the app row with his real apps (they open), the main navigation · S · hometv-tizen's screens
- Movies and TV Shows grids · S · catalogue data (next line)
- Catalogue data: the mock catalogue (offline, no keys), or real TMDB with a key the installer puts on the TV (+S) · S · Rebecca's pick; keys if real
- Title page (preview): poster, details, Watch on · S · catalogue
- Watch on opens the app (YouTube opens the video) · S · app ids from call 1
- Search: the on-screen keyboard and results layout · S · catalogue
- Settings: the layout, with the panes that work in v0 · S · -
- One theme (the default look) · S · -
- Remote: D-pad, OK, Back everywhere; Back from an app returns to HomeTV · S · call (Back from Netflix)

## v1: the household's own data

- Keys by phone: QR on the TV, a page on the phone (key page) · M · hometv-tizen's ES5 service; call (phone reaches the TV)
- Real catalogue (TMDB) · S · keys
- Where to watch, Included services from the installed apps · M · keys, `packages/core`
- Prices (Watchmode, Movie of the Night, iTunes) · M · keys
- TMDB sign-in by QR; My list, Seen, Favorites; shown lists as chips · M · keys
- Pick for me · S · TMDB account
- Phone notes (Send to TV from the phone) · M · key-page service; TMDB account
- First-run checklist · S · the panes above
- Weather (Open-Meteo, city search, °F) · S · -
- Inputs (HDMI with device names) · S · the TV's input list (laptop check showed it)
- Netflix title link, if call 1 showed it works · S · call 1
- Page updates (a newer HomeTV page kept on the TV, signed) · M · hometv-tizen's W2 work
- "An update removed root": HomeTV notices, tells the family it's now an app on its tile, and how to get help · S · root (v0)
- Developer Mode reminder (only on the no-root path) · S · Developer Mode

## v2: polish and extras

- Themes, Seasonal themes, Motion settings · M · -
- Clock screensaver · S · -
- Privacy: a guided checklist screen for his TV's year, and a read-only check that the switches stay off · M · privacy.md
- Debloat with root (stop LG's ad and telemetry services; undoable) · M · root; the unroot path
- Home row apps settings (reorder, hide) · S · -
- Tile menu (hold OK: move, hide) · S · -
- Continue watching row (Rebecca's Samsung item; LG equivalent unknown) · M · research
- Developer Mode automatic renewal (no-root path only) · M · Developer Mode; call
- App shell updates without the laptop (root: Homebrew Channel's update list) · M · root

## Later or maybe

- Phone remote on LG (back burner, as on Samsung) · M · servers on the TV
- Cards per row / square cards; rename inputs and hide empty ports; fireplace tile (her F48 picks for Android) · S each · -
- Two regions (the TV is in the US; Samsung is one region) · - · Rebecca
- A row in upstream's SHOWCASE.md once it works and is public · S · Rebecca
