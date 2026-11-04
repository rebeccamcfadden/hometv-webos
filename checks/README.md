# HomeTV checks (the first TV call's test app)

A Developer Mode app with one button per check, for the first call on her dad's LG. Nothing in it changes a TV
setting; deleting the app (or letting Developer Mode run out) removes it. **Not run on any TV yet: Rebecca's go first.**

| Check | What it answers |
|---|---|
| About this TV | Model, firmware, SDK and Chromium version, from LG's public `getSystemInfo` (no serial number asked for) |
| List the installed apps | Whether an app may list apps (`listApps`), and which streaming apps are there |
| Open Netflix … Hulu | Whether `luna://com.webos.applicationManager/launch` opens each app, by id (HBO Max: new id, then old) |
| YouTube video (two forms), Netflix title (old form) | Title links (W2): the person at the TV says whether the title opened |
| Start the phone page | Whether the app's background service can run a web server on port 8766 (W5) |
| Phone page: did the phone reach it? | Whether a phone on the Wi-Fi reached it (QR on screen, a code, a test note) and whether the service is still up (after standby, too) |
| Developer Mode: time left | Whether the app can read Developer Mode's session and ask LG for the time left (W1's reminder) |
| Send these results to the phone page | The results on the phone at `/report`, to copy rather than read out |

Results stay on the TV (localStorage), so they survive opening Netflix and coming back.

## Build, test, run on the PC

```powershell
npm test            # the phone server's routes and limits, ES5 check, QR vectors
npm run build       # dist/checks-app
node tools/dev.mjs  # http://localhost:5190/ with a pretend TV; the phone page on 127.0.0.1:8766
npm run package     # dist/com.hometv.checks_0.1.0_all.ipk (LG's ares-package, fetched by npx)
```

## The parts

- `app/`: the screen (plain JS for Chromium 68+; Luna calls through `PalmServiceBridge`, which LG's `webOSTV.js`
  wraps). The QR code is hometv-tizen's `qr.ts` (from the Android launcher's `Qr.java`, MIT), stripped to JS at build.
- `service/`: `service.js` (LG's `webos-service`: start, status, stop, report, devmode) and `phone.js` (the web server;
  ES5, Node built-ins only, tested on the PC). The phone page accepts only a 6-character code shown on the TV; ten
  wrong codes make a new one; notes are capped at 200 characters and the last ten.
- **Developer Mode's time left:** the service tries to read `/var/luna/preferences/devmode_enabled` (where webosbrew's
  Dev Manager reads the session) and asks LG's `CheckDevModeSession.dev`. The token never leaves the service. Whether
  an app's own service may read that file is the check.
