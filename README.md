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
| [docs/install.md](docs/install.md) | How HomeTV v0 gets onto an LG TV: Developer Mode (renew about every 1,000 hours) or rooted (research only) |
| [docs/backup.md](docs/backup.md) | The settings backup and `hometv-lg restore`: what is saved, where, what restore writes, its limits |
| [docs/launchers.md](docs/launchers.md), [docs/launcher-replacement.md](docs/launcher-replacement.md) | Other LG home screens compared, and ways to replace LG's Home |
| [tools/](tools/tv-check.mjs) | `hometv-lg check`: the read-only laptop check over LG's remote-control connection; `hometv-lg install`: the guided install, step by step ([docs/install.md](docs/install.md#the-laptop-tools-install-steps)) |
| [checks/](checks/README.md) | The test app for the first call (a Developer Mode app) |
| [root/](root/README.md) | Research: HomeTV's root edition scripts, adapted from lasharor/cleanyourtv-WebOS; untested |
| [app/](app/SOURCE.md) | HomeTV's LG app: the screens copied from hometv-tizen, with LG's platform files (`src/bridge.ts`, `src/platform.ts`, `src/pageChecks.ts`, `src/webos/`) |
| [service/](service/service.js) | HomeTV's LG service: the heartbeat the root edition's watchdog reads |

## Build and test

Node 22+ (the laptop exe is built with Node 26's `--build-sea`).

```
npm test            # all tests, against pretend TVs
npm run build       # the test app, dist/checks-app
node tools/dev.mjs  # the test app in a browser with a pretend TV: http://localhost:5190/
npm run package     # the test app as an .ipk (LG's ares-package, fetched by npx)
npm run dev:app     # HomeTV's page in a browser (preview: no TV): http://localhost:5181/
npm run package:app # HomeTV as an .ipk (v0; refuses a v1 build with the sample catalogue)
npm run exe         # dist/hometv-lg.exe, the laptop check in one Windows file
node tests/fake-ssap.mjs   # a pretend TV for trying hometv-lg check by hand
```

## Credits

Code and ideas from other projects, with their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
