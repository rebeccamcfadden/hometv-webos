> [!WARNING]
> **Work in progress, not tested on a real TV.** Don't install anything from here unless you're helping test it.
> The root steps are **research only**: nothing here roots a TV, and nothing should be run on one without the owner's
> agreement and the backup and way back in [docs/root-plan.md](docs/root-plan.md).

# HomeTV on LG webOS

Can [HomeTV](https://github.com/rebeccamcfadden/hometv-launcher), a TV home screen (catalogue, where to watch, prices,
your apps), run on an LG TV with webOS, and how? This repository is the research and the first tools.

**Status (November 2026):** research done; a read-only laptop check (v-1) and a test app built and tested against a
pretend TV only; HomeTV's own LG app (v0: Home, the app row, All apps) builds and runs in a browser preview, not yet
on a TV.

## What's here

| | |
|---|---|
| [docs/research.md](docs/research.md) | What works on LG, what doesn't, the risks |
| [docs/privacy.md](docs/privacy.md) | LG's tracking and ad settings for each year, DNS blocking, how to undo each step |
| [docs/jailbreak.md](docs/jailbreak.md) | Developer Mode and root options, safest first, with their risks |
| [docs/root-plan.md](docs/root-plan.md) | Research: rooting with a way back (backup, what root changes, undo levels, an LG update ending root) |
| [docs/launchers.md](docs/launchers.md), [docs/launcher-replacement.md](docs/launcher-replacement.md) | Other LG home screens compared, and ways to replace LG's Home |
| [tools/](tools/tv-check.mjs) | `hometv-lg check`: the read-only laptop check over LG's remote-control connection |
| [checks/](checks/README.md) | The test app for the first call (a Developer Mode app) |
| [root/](root/README.md) | Research: HomeTV's root edition scripts, adapted from lasharor/cleanyourtv-WebOS; untested |
| [app/](app/SOURCE.md) | HomeTV's LG app: the screens copied from hometv-tizen, with LG's platform files (`src/bridge.ts`, `src/platform.ts`, `src/pageChecks.ts`, `src/webos/`) and the loader for page updates (`loader/`) |
| [service/](service/service.js) | HomeTV's LG service: the heartbeat the root edition's watchdog reads |
| [docs/updates.md](docs/updates.md) | Updates without the laptop: signed page updates, and the Homebrew Channel repository for a new .ipk |

## Build and test

Node 22+ (the laptop exe is built with Node 26's `--build-sea`).

```
npm test            # all tests, against pretend TVs
npm run build       # the test app, dist/checks-app
node tools/dev.mjs  # the test app in a browser with a pretend TV: http://localhost:5190/
npm run package     # the test app as an .ipk (LG's ares-package, fetched by npx)
npm run dev:app     # HomeTV's page in a browser (preview: no TV, no loader): http://localhost:5181/
npm run package:app # HomeTV as an .ipk (v0; refuses a v1 build with the sample catalogue)
node tools/page-release.mjs --key <key outside the repo>   # a signed page update (docs/updates.md)
npm run hbc-repo    # the Homebrew Channel repository for that .ipk, in dist/hbc (publishes nothing)
npm run exe         # dist/hometv-lg.exe, the laptop check in one Windows file
node tests/fake-ssap.mjs   # a pretend TV for trying hometv-lg check by hand
```

## Credits

Code and ideas from other projects, with their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
