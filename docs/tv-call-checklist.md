# First TV call: what to do on her dad's LG

For Rebecca, on the phone with her dad at the TV. About 45 minutes. Each step says what to press, what to look at,
and how to undo it. **This call is steps 1-4 of [root-plan.md](root-plan.md): nothing is rooted.** Root waits for her
answers (Q-R1 to Q-R4) and, if she picks it, a second call.

**What changes on his TV, in plain words:**

- **Nothing in Parts A, B and D.** The laptop asks the TV's permission once ("Allow") to read its model, apps and some
  settings, and to open Netflix and YouTube when he says yes.
- **Part C turns on LG's Developer Mode** (LG's own switch for app makers) and installs one app, HomeTV, from the
  laptop. Both are removed again by deleting the two apps. Developer Mode runs out by itself after ~41 days and takes
  HomeTV with it.
- **Nothing to do with his accounts, channels or picture changes.**

## Before the call (Rebecca)

1. **An LG developer account** for the Developer Mode app (free, at webostv.developer.lge.com). Q-L1 below: hers, or a
   new one just for this.
2. **Send him, a day ahead:** the HomeTV tool for Windows (`hometv-lg.exe`, the laptop check in one file, built with `npm run exe`;
   Windows will warn that it's from an unknown publisher: More info › Run anyway) and **webOS Dev Manager**
   ([webosbrew/dev-manager-desktop](https://github.com/webosbrew/dev-manager-desktop/releases), free, Apache-2.0, the
   installer most LG app makers use), plus the HomeTV app file (`.ipk`). Laptop on the same Wi-Fi as the TV, plugged in.
3. Keep this list open, and a note for the answers marked ✍. **Never write down or read out the serial number.**

## Part A: look, change nothing (10 minutes)

1. ✍ **Confirm the TV:** Settings › All Settings › Support › TV Information: **Model** (43UT8000AUA?), **Software
   Version** (33.31.61?) and **webOS TV Version** (10.3.1-3001?). If the software is newer, LG has updated it: root
   may no longer be possible; tell builder-5 before Part C.
2. ✍ **Is automatic update on?** Settings › All Settings › Support › Software Update › Allow Automatic Updates. Just
   note it; leave it as it is (Rebecca, 22:23).
3. **Photos for the backup**, one per screen, taken with his phone: Picture (mode and Expert
   Settings), Sound (Sound Out), General › System › Additional Settings › Home Settings, Power On Screen, Quick
   Start+, Support › Privacy & Terms › User Agreements, Advertising, Live Plus, and the home row of apps.
4. ✍ **His apps and their sign-ins:** which streaming apps he uses and which account each is (no passwords).

## Part B: the laptop check (10 minutes)

1. **The TV's address:** Settings › All Settings › General › Network › Wi-Fi Connection › the network › Advanced
   Wi-Fi Settings: **IP Address** (four numbers). ✍ For this call only; don't keep it.
2. On the laptop: open a command window in the folder with `hometv-lg.exe` and type
   `hometv-lg check <the four numbers> --backup --launch`.
3. **The TV shows "Allow"**: press OK on the remote.
4. The laptop asks before opening each app: say yes, watch the TV, say what happened ("Netflix home", "the video
   played", "an error"), then Back to leave it.
5. ✍ At the end it says **Report:** and a file name in his `HomeTV` folder. He emails it to Rebecca (no address, serial
   or device id in it).

**Undo:** nothing to undo. (The pairing stays in the TV; it lets only this laptop read and open apps.)

## Part C: HomeTV without root (20 minutes)

1. **Developer Mode app:** Home › Apps (LG Content Store) › search "Developer Mode" › Install › open it.
2. **Sign in** with the LG developer account (Q-L1).
3. **Dev Mode Status: On**. The TV restarts (a minute). Open the Developer Mode app again.
4. **Key Server: On.** ✍ It shows the TV's address and a **six-letter passphrase**.
5. On the laptop, **webOS Dev Manager** › Add device › the TV's address and the passphrase › Save.
6. **Install** › choose the HomeTV `.ipk` › Install. It appears at the end of the TV's app list.
7. **Open HomeTV** from its tile. ✍ First impressions: the look, the fonts at his distance, how the remote feels.
8. **The checks screen** (HomeTV › Checks, or the separate checks app before v0 is built), one button at a time, ✍
   each result:
   - Open Netflix, YouTube, Prime Video, Disney+, HBO Max, Hulu (each opens? Back returns where?)
   - YouTube video (two forms), Netflix title (old form): did the **title** open, or the app's home?
   - Start the phone page › scan the QR with his phone (same Wi-Fi) › type a test note › Send: does it show on the TV?
   - Remote: can the app see it? (the Home-key helper's test)
   - Developer Mode: time left
   - Send these results to the phone page › on the phone, "Show the TV's results" › screenshot to Rebecca
9. **Key Server: Off** in the Developer Mode app (it's only needed to install).

**Undo:** Home › the app list › edit › delete HomeTV; then delete the Developer Mode app (it removes Developer Mode and
anything installed through it).

**Leave it or remove it?** Q-L2 below. If root is planned for a second call, the Developer Mode app is deleted then,
with a restart, **before** root ([root-plan.md](root-plan.md), Q-R2).

## Part D: the way back, ready (5 minutes)

1. ✍ Rebecca has: the laptop report (Part B), the photos (Part A), the list of his apps and sign-ins.
2. If Q-R4 is yes: the USB stick with LG's firmware file for his model, prepared before the next call (Rebecca,
   from LG's US support page for 43UT8000AUA).
3. Read through the undo levels in [root-plan.md](root-plan.md) together, so he knows the three Home presses and the
   factory reset exist.

## Questions for Rebecca before the call

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q-L1 | **Whose LG developer account** signs in to the Developer Mode app on his TV? | (a) hers; (b) a new free one just for HomeTV | (b): it's typed on his TV, and its session is what LG's timer runs on |
| Q-L2 | **After the call, leave HomeTV installed unrooted** (it works until Developer Mode runs out, ~41 days, or root replaces it) **or remove it?** | (a) leave it, so he lives with it; (b) remove it | (a), if he likes it |
| Q-L3 | **The laptop tool**: our own `hometv-lg.exe` (unsigned: a Windows warning) for the check, plus webOS Dev Manager for the install, or everything in our tool? | (a) ours + Dev Manager (recommended for the first call: least to build); (b) everything in ours (~1-2 days more) | (a) |
