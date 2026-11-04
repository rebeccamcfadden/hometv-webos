# HomeTV on LG webOS (spike)

Research spike: can [HomeTV](https://github.com/rebeccamcfadden/hometv-launcher) run on an LG TV (webOS), and how.
Private until it works (Rebecca, 2026-11-04).

- [docs/research.md](docs/research.md): what works, what doesn't, the questions for Rebecca, risks.
- [docs/privacy.md](docs/privacy.md): LG's tracking and ad settings per year, DNS blocking, undo.
- [docs/jailbreak.md](docs/jailbreak.md): Developer Mode and root options, safest first.
- [docs/launcher-replacement.md](docs/launcher-replacement.md): replacing LG's Home, per tier, and the projects to build on.
- [docs/launchers.md](docs/launchers.md): five LG home screens compared, and plans for Rebecca to pick from.
- [checks/](checks/README.md): the first TV call's test app (a Developer Mode app; not run on a TV yet).

Nothing here has been run on a TV. `npm test`, `npm run build`, `node tools/dev.mjs` (a pretend TV in the browser),
`npm run package` (the .ipk).
