# Third-party notices

Code copied or adapted from other projects, with their licences. Projects only read for research, or linked from the
docs, are not listed; no GPL or AGPL code is copied here (SlopBro, faultmanager-autoroot, dejavuln-autoroot,
LG-TV-HA-Home-Launcher and OpenLauncher are only described and linked).

## lasharor/cleanyourtv-WebOS (MIT)

`root/` (all of it) is adapted from its `scripts/10-cleanyourtv-home`, `stage-home.sh`, `undo-home.sh`,
`after-sam.sh`, `watchdog.sh`, `jtool.js` and `helper/tvprofile.js` (read at `3b2158f`). Compared again at `2debe62`
(B8): `root/after-sam.sh` and `decide.js aftersam` (the webOS 25 list, issue 122, and the state logged after each
restart). From its `install.sh` (also at `2debe62`): `root/install.sh`'s webOS 5 checks (luna-send, systemd, a Node
that runs) and `hometv-lg install`'s root-install step trying LG's installer up to 4 times, counting an install only once
it reports "installed" and the app is registered (`tools/lib/install-steps.mjs`). From its `scripts/bootstrap.sh` (also
at `2debe62`): the check after the install's restart that the new Home came up, and the roll back when it didn't
(`homeCameUp` and `rollBack` in `tools/lib/install-steps.mjs`, used by `hometv-lg install`/`root` and `--home-again`).

`service/update.js` and `service/update-apply.js` (the root edition's Settings › Updates) are adapted from its
`helper/updates.js`, `helper/selfupdate.js` and `scripts/bootstrap.sh` (read at `2debe62`): the release check, the
refusal of an unchecked file, swap in and wait 40 s, keep the previous version and swap back, and the note that stops a
failed version being tried again. Our Ed25519 signature check replaces its `.sha256` files. Not copied: its LAN pages and
tokens, MCP, the dev channel, and its bundled `libinputhookpp.so` (GPL-3.0).

```
MIT License

Copyright (c) 2026 cleanyourtv-WebOS contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## QR code generator (MIT)

`src/qr.ts` (from hometv-tizen, ported from the Android launcher's `Qr.java`): Project Nayuki's QR Code generator
library and Matheus Caldeira's cleanyourtv-ui, both MIT; the full notice is at the top of the file.

## Ideas, no code copied

- rudra-avatar/Hearth (MIT): the page heartbeat file the watchdog checks (`/tmp/launcher-alive` there).
- zzeppieri/webos-custom-home (MIT): the shape of the Luna wrapper in `app/src/webos/luna.ts`.
- home-assistant-libs/aiowebostv (Apache-2.0): the names of LG's remote-control permissions in `tools/lib/ssap.mjs`.
- webosbrew/dev-manager-desktop (Apache-2.0): where Developer Mode's session is read, for the checks app's time-left check.
- webosbrew/webos-homebrew-channel (MIT): its `elevate-service` is run (not copied) by `root/10-hometv-home`, so
  HomeTV's service can write the heartbeat. Its repository format (read in its source) is what `tools/hbc-repo.mjs`
  writes, and `tests/hbc-repo.test.mjs` reads it back the way its source does.
- webosbrew/apps-repo (Apache-2.0): the field names of a repository's packages and manifests (`repogen/`).

## TweetNaCl (public domain, The Unlicense)

`vendor/tweetnacl/` is tweetnacl@1.0.3 from npm, unmodified (https://github.com/dchest/tweetnacl-js); its licence is
beside it. The page updater uses it to check signatures and hashes.

## HomeTV's screens

`app/` (all but the LG platform files) is copied from [rebeccamcfadden/hometv-tizen](https://github.com/rebeccamcfadden/hometv-tizen)
(MIT, same author); `app/SOURCE.md` names the commit. The page-update loader (`app/loader/`) and its tools
(`tools/page-*.mjs`, `tests/fake-browser.mjs`, `tests/page-updates.test.mjs`) are ported from the same repository.

## The shared package

`vendor/hometv-launcher` is a git submodule of [rebeccamcfadden/hometv-launcher](https://github.com/rebeccamcfadden/hometv-launcher),
under its own licence.
