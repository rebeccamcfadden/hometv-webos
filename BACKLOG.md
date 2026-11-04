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

## Answered 22:23

- **Rebecca, 22:23:** (1) **(b) leave LG's automatic updates on** and accept root may go. (2) No base picked yet:
  compare five LG launchers first (lasharor's, zzeppieri/webos-custom-home, Shantil-K/OpenLauncher,
  rudra-avatar/Hearth, Razdva122's): Home and power-on, install path, licence, activity, code quality, what HomeTV
  would reuse, and a plan for her to pick from. Done: [docs/launchers.md](docs/launchers.md) (22:34).

## Direction, 22:33-22:35 (Rebecca, via the lead)

- *"i mainly want to explore rooted options for lg, but i want to make sure that the ability to unroot is part of the
  backup process. if something goes wrong or my dad doesn't like it, i dont want to brick his tv."*
- *"a quick non-rooted test should be part of the initial setup installer (if possible). then go through the backup
  and unrooting configuration, then the root/full install"*
- So: root-first, as an installer flow: (1) a quick non-root check; (2) backup and the unroot path, proven on paper
  first, with what only the TV can prove; (3) root and the full install. Updates stay on (22:23): the plan covers an
  update removing root. The 22:34 plan question was withdrawn (superseded). Nothing on a TV without her go.
- **Rebecca, 22:35/22:39, the base: (a)**, in her words: *"build a custom launcher with the best pieces of the other
  repos that can be installed both un-rooted as a first check and finally rooted after rigorous backup and unrooting
  setup in case that's not desirable."* One launcher of our own; MIT pieces reused with credit; GPL/AGPL code only
  as ideas unless she decides otherwise.
- **Rebecca, 22:36 (Samsung and LG):** features in v0 (the first install test: layout, look and feel), v1, v2…;
  updates follow if her dad likes it. Draft: [docs/versions.md](docs/versions.md), sorted with her and the lead.

## Next

- docs/root-plan.md: the installer flow, the root's footprint and its undo, brick risk per step, "an update removed
  root", and a revised base pick (root-first) for Rebecca.
- The first-call test app is step (1) of that flow ([checks/](checks/README.md)).
- LG's TV emulator needs VirtualBox, not installed on the PC: ask before installing.
