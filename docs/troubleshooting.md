# Troubleshooting the root edition

Light problems with HomeTV as LG's Home on a rooted TV, before any of the ways back in
[root-plan.md](root-plan.md) › The way back. The heavy ones (factory reset, failsafe start, USB recovery) are in
[recovery.md](recovery.md). Over SSH means `ssh -i %USERPROFILE%\HomeTV\lg-root-key root@<tv ip>` from the laptop.

**Research only:** nothing here has been seen on the test TV yet. The first three entries are adapted from
[lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS)'s `docs/troubleshooting.md` (MIT, read at
`2debe62`; notice in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)), whose launcher takes Home over the same
way.

- **A black screen after a restart.** Wait a minute. At each start HomeTV's start-up hook restarts LG's app manager
  (sam), which blanks the picture, HDMI included, for about ten seconds. If HomeTV's page then doesn't answer, the
  watchdog gives LG's Home back about a minute after the start. Still black: restart the TV (unplug it for 30 seconds).
  Right after the install, `hometv-lg install` / `hometv-lg root` check that HomeTV came up after the restart and, if
  it didn't, roll it back by themselves (its start-up hooks out, LG's Home back) and say so in the report.
- **The Home button opens LG's full-screen Home, not HomeTV.** Some TVs have a Home Style setting and a second, full-screen
  Home that the takeover doesn't replace. Set Settings › General › Home Settings › Home Style to **Basic**.
- **`FAILED_IPKG_INSTALL` when HomeTV is installed again** (the `root-install` step, or Homebrew Channel). An earlier
  install was cut short and LG's package list still marks HomeTV `half-installed`. Over SSH, keep a copy of the list,
  then look for HomeTV's entry:

  ```sh
  cp /media/developer/apps/var/lib/opkg/status /media/developer/apps/var/lib/opkg/status.hometv-bak
  grep -n -A 8 'Package: com.hometv.app' /media/developer/apps/var/lib/opkg/status
  ```

  If its `Status:` line says `half-installed`, delete that whole entry (from `Package: com.hometv.app` to the blank line
  after it) with `vi`, leaving every other entry as it is, then install again (`hometv-lg root <tv ip> --from root-install`).
  Undo: `cp /media/developer/apps/var/lib/opkg/status.hometv-bak /media/developer/apps/var/lib/opkg/status`.
- **Video apps play with a black picture after the takeover** (webOS 25; lasharor's issue 122, on 33.31.75). HomeTV's
  `after-sam.sh` restarts `videooutputd` and then `umediaserver` after each sam restart for that. Its steps are in the
  start-up notes: over SSH, `cat /tmp/hometv-boot.log` (lines starting `after-sam:`, each with the service's state).
  If the list doesn't suit this TV, a file `/media/developer/hometv/after-sam-services` replaces it (service names
  separated by spaces; an empty file: none). Delete the file to go back to the built-in list.
- **HomeTV stopped being Home after an LG update, and Homebrew Channel still opens.** The software changed to one not in
  `root/compat.json`, so the start-up hook left LG's Home alone (the start-up notes say so). `hometv-lg root <tv ip>
  --home-again` explains it, asks, and puts HomeTV back if you agree. If Homebrew Channel is gone too, the update ended
  root: [updates.md](updates.md).
- **`hometv-lg unroot-home` says LG's Home isn't back yet.** HomeTV's mount over LG's Home was busy, or something else
  is mounted there. Its start-up hooks are already gone and its folder is kept on purpose: restart the TV, then run
  `hometv-lg unroot-home <tv ip>` again.
