# Backlog and decisions

Rebecca's decisions for the LG port, quoted with the time. Her Samsung answers don't carry over unless she says so.

## Decided

- **Rebecca, 21:54-22:09 (Q1-Q5):** her dad's LG is available for a TV call at most once a week; model unknown, the
  first call reads it; a Windows laptop at the house; the TV is in the US; the repo is
  `rebeccamcfadden/hometv-webos`, private until it works.
- **Rebecca, 22:10-22:15 (W1-W6):** W1 (a) a Developer Mode reminder in HomeTV now, automatic renewal later. The
  no-root rule is lifted **for this repo's research**: explore both, with the risks; test without root first, before
  she decides on root (no root on any TV until she picks it). W2 (a) title-link checks. W3 (a) the Home helper, now
  the model is known. W4 covered by the root research. W5 (a) key page and phone notes; phone remote on the back
  burner. W6 (a) page updates.
- **The TV** (22:1x): 43UT8000AUA, webOS 25, release 10.3.1-3001. Never write its serial number anywhere.

## Open (asked through the Decision proxy)

- (22:18) Turn off automatic updates on his TV now, to keep root possible until she decides? Delays LG's security
  fixes; undo by switching it back on.
- (22:18) Build HomeTV for LG on Razdva122's No-root base (MIT, credited), as she chose AeroTizen for Samsung?

## Next

- A test app for the first TV call: launch, list apps, the key page from a phone, title links, Developer Mode's time
  left, Back from Netflix. About half a day.
- LG's TV emulator needs VirtualBox, not installed on the PC: ask before installing.
