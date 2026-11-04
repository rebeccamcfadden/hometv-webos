# Getting HomeTV onto an LG TV

> [!WARNING]
> **Work in progress, not tested on a real TV.** Nothing here has been run on any TV yet. Only follow it if you're
> helping test HomeTV, and only on a TV whose owner agrees.

HomeTV v0 (the Home screen, the app row, All apps) reaches an LG TV as an app, an `.ipk` file. LG TVs have no store
for it, so there are two ways to put it there. **Path 1 is the one to use.**

| | Path 1: Developer Mode | Path 2: rooted |
|---|---|---|
| What it is | LG's own switch for app makers | Using a software bug to get full control of the TV |
| Needs | A free LG Developer account, a laptop on the same Wi-Fi, the `.ipk` | A TV on firmware LG hasn't fixed, a backup, a way back |
| Risk | Very low | Real: see the warning below |
| Keeps working | Until Developer Mode runs out (about every 1,000 hours) | Until an LG update ends root |
| Undo | Delete the app, or delete the Developer Mode app | A factory reset (clears everything on the TV) |
| Status | The way to test now | Research only |

## Path 1: Developer Mode

Developer Mode is a feature LG built for people who make TV apps. It lets a computer on your Wi-Fi install an app. It
doesn't change LG's software.

1. **Switch Developer Mode on.** On the TV, install LG's **Developer Mode** app from the LG Content Store, open it,
   sign in with an LG Developer account, press **Dev Mode Status** (the TV restarts), then open the app again and
   press **Key Server**. The app now shows a 6-letter **passphrase**.
2. **Get the laptop tools.** On a Windows laptop, `hometv-lg get dev-manager` downloads webosbrew's free
   [Dev Manager](https://github.com/webosbrew/dev-manager-desktop) and starts its installer. The download is checked
   against a pinned SHA-256 first. (Step-by-step, for someone who isn't technical:
   [docs/check/index.html](check/index.html#install).)
3. **Add the TV in Dev Manager:** *Add new device...*, the TV's IP address (for example `192.168.1.50`), and the
   passphrase from the TV.
4. **Install HomeTV:** on the Apps page click *Install* and pick the `.ipk`. To make one from this repository:
   `npm run package:app` (it refuses a build that still has the sample catalogue).
5. **Open HomeTV** from the TV's app list.

**The catch: Developer Mode runs out.** A session lasts about 1,000 hours (about 41 days). Before then, open the
Developer Mode app and press **Extend**. If it runs out, LG removes the apps installed this way and HomeTV has to be
installed again. Developer Mode also switches off after 10 restarts without a network. HomeTV can't press Extend for
you yet.

**Undo:** delete HomeTV from the TV's app list, or delete the Developer Mode app (its apps go with it).

What this path can't do: replace LG's Home, or start HomeTV when the TV switches on. HomeTV is an app you open.
More in [jailbreak.md](jailbreak.md) and [launcher-replacement.md](launcher-replacement.md).

## Path 2: rooted (research only)

> [!CAUTION]
> **Research only. Do not do this unless the TV's owner agrees, and never without a backup and a way back.**
> Rooting uses a bug in LG's software. It can leave a TV that won't start, it usually ends LG's updates (which
> blocks security fixes too), it may void the warranty, and **there is no "unroot" button**: the full undo is LG's
> *Reset to Initial Settings*, which clears all settings, apps and sign-ins. A TV can't go back to older firmware.
> Rooted TVs must not have the Developer Mode app installed, so the two paths don't mix.

With root, HomeTV's own scripts (in [`root/`](../root/README.md)) can show HomeTV in place of LG's Home, in memory
only, so a start without them gives LG's Home back. None of it has been run on a TV.

Read [root-plan.md](root-plan.md) first: what root changes, the backup, the undo levels, and the order (an unrooted
test first, then the backup, then root).

## The laptop tool's install steps

Coming soon.
