# Third-party notices

Code copied or adapted from other projects, with their licences. Projects only read for research, or linked from the
docs, are not listed; no GPL or AGPL code is copied here (SlopBro, faultmanager-autoroot, dejavuln-autoroot,
LG-TV-HA-Home-Launcher and OpenLauncher are only described and linked).

## lasharor/cleanyourtv-WebOS (MIT)

`root/` (all of it) is adapted from its `scripts/10-cleanyourtv-home`, `stage-home.sh`, `undo-home.sh`,
`after-sam.sh`, `watchdog.sh`, `jtool.js` and `helper/tvprofile.js` (read at `3b2158f`).

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
  HomeTV's service can write the heartbeat.

## HomeTV's screens

`app/` (all but the LG platform files) is copied from [rebeccamcfadden/hometv-tizen](https://github.com/rebeccamcfadden/hometv-tizen)
(MIT, same author); `app/SOURCE.md` names the commit.

## The shared package

`vendor/hometv-launcher` is a git submodule of [rebeccamcfadden/hometv-launcher](https://github.com/rebeccamcfadden/hometv-launcher),
under its own licence.
