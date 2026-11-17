# Updates on LG

How HomeTV on an LG TV gets new versions without the laptop. Two ways, for two different parts:

| What changes | How it reaches the TV | Needs |
|---|---|---|
| **The page**: HomeTV's screens, their styles and scripts (everything Vite builds into `dist/app/` except the loader) | **A page update**: HomeTV finds a newer, signed page; **Settings › Updates › Install update** downloads and checks it, and HomeTV starts again with it | Nothing on the TV; an update address and a signing key built into the app |
| **The app**: the loader, `appinfo.json`, icons, HomeTV's service (`service/`), the public keys, the update address; on a rooted TV also the root scripts (`root/`) | **A new .ipk**: on a rooted TV from **Settings › Updates › Install update** (HomeTV's service, as root) or Homebrew Channel; in Developer Mode from the laptop (webOS Dev Manager) | Root, or the laptop |

Most changes are page changes, so most updates need nothing but a press of Install update. A new .ipk is only needed
when the app part changes. Nothing is published yet: apps are built with both kinds of update **off**, and no Homebrew
Channel repository is online. All need the project lead's go (see [Open points](#open-points)).

## Settings › Updates

As on Android: the person decides, and nothing is downloaded before **Install update** is pressed.

- **Check for updates** (on by default): HomeTV looks at most **once a day while Home shows** (the time of the last
  look is kept, so restarts add none). A look reads only the signed manifest. **Check now** looks at once, on or off.
- **Install update** shows only when a newer version is on offer. On a page: it downloads and checks the page, then
  HomeTV starts again with it (below, [When a new page fails](#when-a-new-page-fails)). On a rooted TV with a new app:
  HomeTV's service installs the app and the root scripts ([The root edition's own updates](#the-root-editions-own-updates)).
- **In Developer Mode** only pages update from the TV: a page can't install an app. When the release names a newer app
  (`appVersion`), Updates says in plain words that it goes on from the laptop.
- Home's notice says **once per version** that an update is available (`app/src/ui/updateNotice.ts`).

The code: `app/src/screens/panes/updates.ts`, its words in `app/src/updates.ts` (tested in `tests/settings.test.mjs`).

**Not tested on a TV.** Everything here runs against a pretend TV on a PC (`npm test`); [What only a TV can
show](#what-only-a-tv-can-show) lists what's left.

## Versions

`package.json` holds both:

- `version`: the **page's** version. Raise it for every page release.
- `appVersion`: the **app's** version (the .ipk, `appinfo.json`). Raise it when the app part changes. Homebrew Channel
  offers an update whenever this differs from the installed one.

Both are three numbers (`1.2.3`). A page names the oldest app it works with (`minShell`, by default the app version it
was built with); an older app keeps its current page until it's updated.

## Page updates

The same design as HomeTV on Samsung (hometv-tizen's `docs/page-updates.md`), with LG's storage. `npm run build:app`
turns `dist/app/` into two parts:

- **The shell**, fixed until a new .ipk: `index.html`, `shell-config.js` (the app's version, the update address, the
  public keys), `boot.js` (`app/loader/boot.js`), `update.js` (`app/loader/update.js`) and TweetNaCl
  (`nacl-fast.min.js`, [vendor/tweetnacl](../vendor/tweetnacl/README.md)). A downloaded page can't change any of them.
- **The page**: everything else (`assets/app.js`, `assets/style.css`, any images). The .ipk comes with one; the TV can
  download newer ones.

### At every start

`boot.js` (plain ES5, no network) picks the newest good page the TV has:

1. a page downloaded last time and not tried yet, else
2. the last page that started fine, else
3. the one before it, else
4. the page inside the .ipk.

It uses a downloaded page only if it is newer than the app's own page, was signed with a key this app still trusts,
needs no newer app, and hasn't failed. It reads the page's files back and puts its styles and scripts into the
installed `index.html` (inline); its images get `blob:` addresses that its CSS is pointed at. The app never navigates
anywhere, so LG's `PalmServiceBridge` (the Luna calls) stays.

**Home never waits for the network.** Nothing is fetched until Home has shown. **Home never waits long for the
storage either**: if reading a downloaded page takes more than 5 seconds, the app's own page shows this time.

### After Home shows

The page calls `bridge.platform.started()` (in `app/src/main.ts`), which calls the loader's `HomeTVBoot.started()`
and then starts the heartbeat the rooted edition's watchdog reads (`app/src/platform.ts`; a loader error never stops
the heartbeat). The loader marks the page as good and tidies the store. Ten seconds later, when Check for updates is on
and a day has passed since the last look, `update.js` loads and **looks** (steps 1 to 3; it notes the version on offer
and, if the manifest names one, the newest app), then looks again each day while HomeTV stays open. Steps 4 and 5 run
only when the person presses **Install update** (`HomeTVBoot.installNow()`):

1. It fetches `manifest.json` and `manifest.json.sig` from the update address.
2. It checks the signature (Ed25519, over the manifest's exact bytes) against the app's public keys. A bad or missing
   signature: no update.
3. It refuses a page for another app (Samsung's `hometv-tizen` pages included), one that isn't newer than every page
   the TV has, one that failed before, or one that needs a newer app.
4. It downloads each file from `<version>/<path>` beside the manifest, checks its size and SHA-512, and saves it. One
   bad file and the whole download is deleted.
5. Only when every file is saved does it mark the page as ready. **It shows at the next start**, never in the middle
   of one; Settings › Updates starts HomeTV again at once (`HomeTVBoot.restart()`).

The TV keeps **at most two** downloaded pages: the one in use and one more.

### When a new page fails

- **It never reaches Home** (it hangs, or the TV goes off): after **20 seconds** the app reloads. The first failed
  start tries the same page again (people switch a TV off in the first seconds); after **two failed starts in a row**
  the next start uses the previous good page, or the app's own, and that version is **skipped** for good.
- **A script throws while it loads**: counted at once, without the 20-second wait, then the same two-tries rule.
- **Its files are missing or damaged on the TV**: skipped at once; the next best page shows in the same start.
- **The TV refuses inline scripts**: downloaded pages are off for that app version; its own page shows.
- **No IndexedDB, or one that won't open**: the app's own page, and no update checks.

A start that reaches Home clears the count. The 20 seconds (Samsung uses 30) keep two failed tries under the rooted
edition's watchdog, which gives LG's Home back after about a minute without a heartbeat (`root/watchdog.sh`).
`HomeTVBoot.status()` (in the page) says which page shows, why, and what the last check found.

### Where the TV keeps a downloaded page, and why

**The files in the page's own IndexedDB** (database `hometv-pages`, one entry per file, its bytes); **the small record**
of which pages there are and which is good **in localStorage** (`hometv.pages`), as on Samsung.

- **IndexedDB** stores bytes as they are and has room for megabytes; it is there on every LG web engine since 2016
  (Chromium 38) and only HomeTV's page can read it. The loader uses only its oldest parts (open, get, put, a cursor).
- **localStorage** is read without waiting, before anything shows, so the start stays as fast as without updates. But
  it holds only text (images would grow by a third), and about 5 MB in all: fine for the record, too small for pages.
- **The service's own folder** (as hometv-tizen's private storage): not used. The page would have to wait for HomeTV's
  service to start (seconds after a TV start) before showing anything, pass every file over Luna, and LG's Developer
  Mode jail may not let the service write there. It would also go with the app at each new .ipk.

LG clears a page's localStorage when its app is updated or removed (docs/research.md, section 2). After a new .ipk the
TV so forgets its downloaded pages and shows the new app's own page; leftover files are deleted once Home shows, and
the next check downloads a newer page again if there is one.

On a rooted TV HomeTV also runs **as LG's Home** (`root/`: its page mounted over `com.webos.app.home`). That page has
LG Home's storage, not the HomeTV tile's, so the two keep and download their pages separately. Both check the same
address.

## Releasing a page

Once, on the project lead's PC:

```sh
node tools/page-key.mjs
```

It saves the private key to `~/.hometv/webos-page-key.pem` (outside the repo; it refuses to write inside it or over an
existing file) and prints the public key. Paste that line into `app/loader/page-keys.txt`. Keep one more copy of the
private key offline (a USB stick in a drawer, or a password manager); never in git, a chat or a cloud folder: whoever
has it can send pages to the TV. Then build the app with the update address and install it as usual:

```sh
$env:HOMETV_UPDATE_URL='https://example.org/hometv/pages/manifest.json'; npm run package:app
```

For each page release:

1. Raise `version` in `package.json`.
2. `npm run build:app`, with the same `HOMETV_UPDATE_URL`.
3. `node tools/page-release.mjs --key $HOME\.hometv\webos-page-key.pem`. It writes `.data/page-release/`
   (git-ignored): `manifest.json`, `manifest.json.sig` and a `<version>/` folder. The key can also come from
   `HOMETV_PAGE_KEY_FILE` (a path) or `HOMETV_PAGE_PRIVATE_KEY` (the key's text). `--min-shell x.y.z` sets the oldest
   app the page needs.
4. Upload the folder's contents to the update address's folder, **`manifest.json` last**. The host must let the page
   read it (`Access-Control-Allow-Origin: *`): GitHub Pages does; GitHub release downloads don't (2026-11-04: no such
   header on github.com's redirect). Homebrew Channel isn't affected: its service, not a page, downloads the .ipk.

The release refuses a page whose scripts load one of its own image or font files by path: on the TV those files have
`blob:` addresses only its CSS is pointed at. Use them from the CSS, or inline them. (Today's page has none.)

**Trying it on a PC:** `node tools/page-serve.mjs --dev` makes a test key in `.data/` (never for a real release),
releases `dist/app/` with it, serves it on port 8790 and prints the build command for an app that trusts it.
`npm run dev:app` (the browser preview) runs without the loader.

## Undoing a page

- **It doesn't start:** nothing to do. After two failed starts the TV goes back by itself and skips that version.
- **It starts but is wrong:** release the previous code again **with a higher version** (TVs never go back to a lower
  number).
- **Everything off:** take `manifest.json` off the server. TVs keep the page they have and stop changing.
- **Back to the app's own page on one TV:** install an .ipk whose page `version` is at least the downloaded one's (and
  take the newer page off the server first, or it comes back).
- **A lost or leaked key:** make a new pair, replace the public key in `app/loader/page-keys.txt`, and install the new
  .ipk. Pages signed with the old key are no longer shown and are deleted once Home shows; release the page again with
  the new key (the same version is fine).

## Homebrew Channel repository (rooted TV)

On a rooted TV, [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) installs and updates apps
from repositories: JSON files at web addresses added in its settings. `tools/hbc-repo.mjs` makes HomeTV's:

```sh
npm run package:app
node tools/hbc-repo.mjs [--tag app-v0.0.1] [--base-url https://rebeccamcfadden.github.io/hometv-webos/hbc/]
```

It reads the .ipk (`dist/com.hometv.app_<appVersion>_all.ipk`), checks it is HomeTV's (one id and version in its
control file and `appinfo.json`, the right file name, no sample catalogue), and writes `dist/hbc/`:

- `apps.json`, the repository: `{ "paging": …, "packages": [ { id, title, iconUri, manifestUrl, manifest,
  shortDescription, pool } ] }`;
- `com.hometv.app.manifest.json`, the package's manifest: `id`, `version`, `type`, `title`, `appDescription`,
  `iconUri`, `sourceUrl`, `rootRequired` (`"optional"`: HomeTV runs without root, and is Home only with it), `ipkUrl`
  (the .ipk as a GitHub release asset, `https://github.com/rebeccamcfadden/hometv-webos/releases/download/<tag>/…`),
  `ipkHash.sha256` and `ipkSize`;
- `icon.png`, from the .ipk.

The format is Homebrew Channel's own, read in its source (webosbrew/webos-homebrew-channel at
[`6e928d0`](https://github.com/webosbrew/webos-homebrew-channel/tree/6e928d01b21f0282a945ae2c8d3c65d25c9c1578),
the same in release v0.7.3): `frontend/views/BrowserPanel.js` reads `packages` from each repository;
`frontend/views/DetailsPanel.js` uses a package's `manifest` (or fetches `manifestUrl`), resolves `ipkUrl` against
`manifestUrl` (`frontend/baseurl.js`), and asks its service to install with `ipkHash.sha256`; `services/service.ts`
(`install`) refuses a download whose SHA-256 differs. The field names follow webosbrew's own repository generator
(webosbrew/apps-repo at [`f3c6464`](https://github.com/webosbrew/apps-repo/tree/f3c64646459e9526832fcfc6e61d5c8d009decb4),
`repogen/pkg_info.py`, `repogen/pkg_manifest.py`), and repo.webosbrew.org's `apps.json` has the same shape. The tests
read the repository back with Homebrew Channel's own URL rules and checksum check (`tests/hbc-repo.test.mjs`).

**It publishes nothing.** Publishing is two uploads, each the project lead's call: the .ipk as a release asset under
the tag in `ipkUrl`, and the three files at `--base-url` (for example `docs/hbc/` on this repo's GitHub Pages).

### On the TV

Once: **Homebrew Channel › Settings (the gear, top right) › Add repository**, type the address of `apps.json`
(`https://rebeccamcfadden.github.io/hometv-webos/hbc/apps.json` if published there), **Add repository**. HomeTV then
shows in Homebrew Channel's list. The installer can open that box with the address already typed (the person still
presses Add): Homebrew Channel's `addRepository` launch mode (`frontend/views/MainView.js`), from the TV's root shell
or the laptop's launch call:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"org.webosbrew.hbchannel","params":{"launchMode":"addRepository","url":"<apps.json address>"}}'
```

Each update: **Homebrew Channel › HomeTV › Update** (the button reads Update when the listed version differs from
the installed one; in the source read, Homebrew Channel doesn't update apps by itself). It downloads the .ipk, checks
its SHA-256 and installs it. Homebrew Channel offers any *different* version, older too, so the repository only ever
lists the newest, and `appVersion` only goes up.

In Developer Mode (no root) there is no Homebrew Channel: a new .ipk goes on from the laptop with webOS Dev Manager,
as the first install did.

### What a new .ipk does on a rooted TV

- The app's files and HomeTV's service are replaced; LG clears the page's localStorage, so downloaded pages start
  over (above).
- HomeTV's service is registered jailed again; `root/10-hometv-home` elevates it again at the next start, so the
  heartbeat reaches the watchdog.
- **HomeTV as LG's Home shows the new version after the next restart**: `root/stage-home.sh` copies the installed page
  into the folder mounted over LG's Home at each start. Until then Home shows the previous app, and the HomeTV tile
  the new one.

## The root edition's own updates

On a rooted TV, **Settings › Updates › Install update** also brings a new app and its root scripts, with no laptop and
no Homebrew Channel. Adapted from [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (MIT,
read at `2debe62`: `helper/updates.js`, `helper/selfupdate.js`, `scripts/bootstrap.sh`; notice in
[../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)), with **our signature** instead of their `.sha256` beside each
file (a hash from the same server catches damage, not a hacked release).

- **The release**: `node tools/root-release.mjs --key <private key>` writes `.data/root-release/`: the .ipk, the root
  scripts (every file of `root/` but `README.md` and `package.json`, Unix line ends) and `hometv-root.json`, which lists
  each file's name, size and SHA-512 and is signed (`hometv-root.json.sig`) with **the same LG key as the page updates**.
  It refuses an .ipk whose service doesn't carry the app's version. Upload them as assets of one GitHub release,
  `hometv-root.json` and its `.sig` last. It publishes nothing.
- **The build**: `$env:HOMETV_ROOT_UPDATE_URL='https://github.com/rebeccamcfadden/hometv-webos/releases/latest/download/hometv-root.json'; npm run package:app`
  puts the address, the public keys (`app/loader/page-keys.txt`) and TweetNaCl into the service
  (`update-config.json`). Without the address it is off. Only https.
- **A look** (`updateCheck`, at most once a day while Home shows, or Check now): the service downloads the manifest and
  its signature only, checks the signature, and offers a version newer than the installed app that hasn't failed here.
- **Install update** (`updateInstall`; HomeTV's page only, the service running as root, the root edition on the TV,
  one at a time): the service downloads each file from the manifest's own release (its `tag`) into
  `/media/developer/hometv/updates/stage`, and **refuses any file whose size or SHA-512 differs**, or that the manifest
  doesn't list (only the .ipk and the known root scripts). Then `service/update-apply.js` runs on its own, as root:
  1. checks the stage **again** against the signed manifest, with the keys of the app installed now;
  2. keeps the running version in `updates/prev` (the root scripts, and the .ipk `hometv-lg root` or the last update
     left in `updates/current.ipk`);
  3. installs the .ipk with LG's installer (as Homebrew Channel and `hometv-lg root` do), copies the root scripts in, and
     refreshes HomeTV as LG's Home in place (`root/10-hometv-home`, which also elevates the new service);
  4. waits up to **40 seconds** for the new service to answer with the new version (`version`);
  5. if it doesn't, **swaps back**: the previous scripts and .ipk, and writes the version to `updates/failed`, so it is
     **never offered again**. The result is in `updates/last.json`; Settings › Updates says it in plain words.
- Without a kept .ipk (a TV rooted before this), a failed update still puts the scripts back, and says the previous app
  is reinstalled from Homebrew Channel if HomeTV doesn't open; the watchdog gives LG's Home back meanwhile.
- **Not taken from lasharor**, on purpose: its LAN pages and plain-HTTP tokens, its MCP and network notifications, the dev
  channel, and `libinputhookpp.so` (GPL-3.0). The TV only makes outbound HTTPS requests.

Tests: `tests/root-updates.test.mjs` (a good update, a bad signature, a bad checksum, a stage changed after download, a
version that doesn't answer and is swapped back, a failed version not offered again, no network), and
`tests/hbc-repo.test.mjs` for `tools/root-release.mjs`.

## Open points

For the project lead:

- **The page update address**, for example `https://rebeccamcfadden.github.io/hometv-webos/pages/manifest.json`
  (GitHub Pages, from this repo's `docs/`), and whether release builds use it.
- **The Homebrew Channel repository's address** (`--base-url`, default `https://rebeccamcfadden.github.io/hometv-webos/hbc/`)
  and **the release tag** for the .ipk (default `app-v<appVersion>`).
- **The signing key**: made on the project lead's PC with `tools/page-key.mjs`; one LG key (the default), or the
  Samsung one for both. The root edition's updates use the same key.
- **The root update address** (`HOMETV_ROOT_UPDATE_URL`, for example the latest release's `hometv-root.json`) and the
  release that carries it.

## What only a TV can show

- IndexedDB in an installed LG app (and in HomeTV mounted as LG's Home): it opens, keeps bytes across restarts, and
  how much room it has.
- Whether a new .ipk (Dev Manager or Homebrew Channel) clears localStorage, IndexedDB, both or neither (handled either
  way).
- Inline scripts and styles, and `blob:` images from CSS, in an installed app (a strict content security policy would
  stop them; the loader notices and keeps the app's own page).
- The page's requests to the update address from an installed app (LG's engine and CORS).
- Homebrew Channel on the test TV: adding the repository, Update, the `addRepository` launch, and HomeTV as Home after
  the restart.
- Times: reading a page back at start, and the 20-second limit against the watchdog's minute.
- Settings › Updates on a rooted TV: the elevated service's HTTPS downloads from GitHub (redirects, LG's certificates),
  LG's installer called from the detached `update-apply.js`, the service answering `version` within 40 s of a new
  .ipk, and HomeTV as LG's Home refreshed in place.
