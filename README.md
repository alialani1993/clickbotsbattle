# 🤖 ClickBots PvP: Playable Prototype

A 2-minute competitive clicker built from the *ClickBots PvP* GDD. Click the enemy bot to attack, click your own bot to repair, and click the crystal to mine resources. Spend resources on random Bronze, Silver and Gold upgrades. You win by destroying the enemy bot, or by having the most HP when the timer runs out.

**Modes**
- **vs CPU**: offline, with three difficulty levels.
- **Online 1v1**: one player hosts and shares a 5-letter room code or an invite link. The other player joins with it.

**Match length**: Blitz (1:00), Standard (2:00, the default) or Marathon (5:00). Pick it on the menu. In online matches the host's choice applies.

**Reading your opponent**
- **Live CPS**: next to each name, an average of clicks per second over the last 5 seconds (the CPU's too).
- **Activity bars** under the crystal: for damage, repair and mining, your column (teal) sits beside your opponent's (red). Each shows output per second over the last 10 seconds. The striped part is auto-clicker output. The taller of the two columns in a pair is full height, so you're always comparing yourself with your opponent.
- The **results screen** adds average and peak CPS for both players.

It's plain HTML, CSS and JS with no build step, so it runs on GitHub Pages as-is.

---

## Put it on GitHub Pages

1. Create a new **public** repository on GitHub (for example `clickbots`).
2. Upload everything in this folder to the root of the repo, including the hidden `.nojekyll` file. You can drag and drop on github.com or use git:
   ```bash
   git init && git add . && git commit -m "ClickBots prototype"
   git branch -M main
   git remote add origin https://github.com/<you>/clickbots.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click **Save**.
4. After about a minute the game is live at `https://<you>.github.io/clickbots/`.

To test locally, open `index.html` directly for vs-CPU. For online play, serve the folder with something like `python3 -m http.server`.

---

## How the GDD's networking maps to a static site

The GDD calls for a server-authoritative model: clients send ServerRPCs, the server calculates every outcome, and the server broadcasts state. GitHub Pages can't run a server, so the **host player's browser runs the authoritative server** and the guest connects to it peer-to-peer over WebRTC (via [PeerJS](https://peerjs.com/)).

| GDD requirement | Where it lives |
|---|---|
| Clicks sent as ServerRPCs | `GameServer.rpc(pid, msg)` in `js/server.js`. Guest inputs travel as `{t:'in', m:{a:'attack'}}` |
| Server calculates damage, repair and gain | `rpc()` and `tick()` in `js/server.js` |
| Server tracks upgrades, auto-clickers, buffs and temporary effects | the player object in `newPlayer()` |
| Clients only render and send inputs | `js/ui.js` never changes game state |
| Server broadcasts state | `snapshot()` is sent 20×/sec (`TICK_MS`) |
| Your bot on the LEFT, enemy on the RIGHT, same screen for both | each client renders the snapshot from its own player's point of view |
| See each other's clicks 🔴🟢 | click events in each snapshot become green (yours) or red (opponent's) pips |
| Reset after each match | `GameServer.reset()` runs on rematch |
| CPS and activity bars | the server records clicks and output in 0.5s buckets (`record()`, `rate()`) and sends rolling rates in each snapshot |

The same `GameServer` drives vs-CPU mode. The CPU plays through `rpc()` like a human would, so it can't cheat.

The server also caps each player at 20 clicks/sec (`MAX_CLICKS_PER_SEC`) to blunt macros.

---

## Tuning

All the numbers are in **`js/config.js`**: match modes, HP, per-click values, tier prices and price growth, the CPS and activity-bar windows, and the full upgrade pool, including the timed Shield and Overclock effects. Add an upgrade by adding one line to `UPGRADES`. To give a mode its own starting HP, add `startHp` to that mode in `MATCH_MODES`.

To check balance after a change, run the headless simulator:

```bash
node tools/balance-sim.js            # standard
node tools/balance-sim.js blitz
node tools/balance-sim.js marathon
```

It plays 200 CPU-vs-CPU matches per pairing and reports win rates, knockout rate, average match length and average CPS. With 2,500 HP in every mode, Normal vs Normal comes out about 50/50 in each.

| Mode | Avg length | Ended by knockout |
|---|---|---|
| Blitz | 60s | ~0% (almost always decided on HP at time-up) |
| Standard | ~95s | ~90% |
| Marathon | ~95s | 100% (auto-clickers end it before the clock matters) |

To make Marathon run closer to 5 minutes, slow the late game in that mode, for example with steeper upgrade price growth. Raising HP alone doesn't do it: even 15,000 HP only stretched matches to about 3 minutes.

---

## Files

```
index.html          screens: menu, lobby, game
css/style.css       layout and FX (responsive: desktop, phone portrait and landscape)
js/config.js        tuning and upgrade pool
js/server.js        authoritative simulation (also runs in Node)
js/ai.js            CPU opponent
js/net.js           PeerJS host/guest transport
js/ui.js            renderer, robot art (inline SVG), floating numbers and pips
js/sfx.js           procedural sound effects (WebAudio, no asset files)
js/main.js          menus and wiring
tools/balance-sim.js
```

## Fixed-size game area on desktop (fairness)

Clicking speed depends on how far the mouse travels between targets (Fitts's law). If the game stretched to fill the window, players on big monitors would have to move further between Repair, Mine, Attack and the shop. On mouse-driven devices the game area is therefore fixed at **1120×700** (`CONFIG.STAGE`). It's centered, and it never scales up.

| Monitor | Repair → Attack travel (stretched layout) | Fixed 1120×700 |
|---|---|---|
| 1366 laptop | 845px | 689px |
| 1920 monitor | 1,194px | 689px |
| 3440 ultrawide | 2,151px | 689px |

- In windows smaller than the stage, the whole game shrinks evenly, so distances and target sizes shrink together.
- Touch devices (phones and tablets) stay full-screen.
- Layout inside the game uses container-relative units (`cqw`, `cqh`, `@container game`), so it depends on the game area, not the window.
- To preview another size, add `?stage=1280x720` to the URL.
- A fixed size can't control browser zoom, OS display scaling or mouse sensitivity.

## Online connection problems

The join screen and lobby now report which step failed:

| Message | Meaning | Fix |
|---|---|---|
| *Room … not reachable yet, retrying* | The host's page isn't connected to matchmaking right now (usually the host switched apps). | The host returns to the game tab. The guest keeps retrying for about 30 seconds. |
| *Room … not found* | Retries ran out, or the code is wrong. | Check the code. The host should have the game open in front. |
| *Found the room, but your two networks blocked a direct connection* | Matchmaking worked, but the two browsers couldn't reach each other. This is common for phone-on-cellular vs PC-on-Wi-Fi, school or work networks, and some home routers. | Put both devices on the same Wi-Fi, or add a TURN relay (below). |
| *Timed out connecting to the host* | The host page froze partway through the handshake. | The host keeps the page in front and the guest tries again. |

### Checking the relay
- **Menu → Test connection** shows how many TURN servers the loaded `config.js` has, and whether the relay accepted the login. Run it on both devices.
- Open the game with **`?relay=1`** (e.g. `https://<you>.github.io/clickbots/?relay=1`) on both devices to force all traffic through the relay. If that connects on the same Wi-Fi, the relay works.
- In a match, the HUD shows whether you're connected **direct** or **via relay**.
- The **build number** at the bottom of the menu tells you whether GitHub Pages is serving the latest files.

### Adding a TURN relay (recommended for real playtests)

A TURN server relays game traffic when a direct connection is impossible. Several providers have free tiers. Sign up with one (for example ExpressTURN or Metered), then paste the credentials into `js/config.js`:

```js
TURN_SERVERS: [{
  urls: ['turn:YOUR_HOST:3478?transport=udp', 'turn:YOUR_HOST:3478?transport=tcp', 'turns:YOUR_HOST:443?transport=tcp'],
  username: 'YOUR_USERNAME',
  credential: 'YOUR_PASSWORD',
}],
```

Anyone can read these credentials in the page source. That's fine for a prototype; most providers let you cap usage.

### Mobile behavior
- A phone host can switch apps to send the invite (there's a **Share invite** button). The room code stays reserved, and the lobby reconnects when you come back.
- While the host's page is in the background, nobody can join. Guests keep retrying until the host returns.
- During a match, the host's page must stay in front. If it doesn't, the guest sees "⚠ waiting for host…" and is dropped after 15 seconds.

## QA hook

In the browser console, `ClickBotsDebug().server` gives you the live server object, so you can inspect or change state while you test.

## Known prototype limits

- **The host is the authority.** A host who edits the JS could cheat. A dedicated server would fix this later, and `server.js` has no DOM dependencies, so it would port to Node with little work.
- **Keep the host's tab in the foreground.** Browsers throttle timers in background tabs, which makes the game stutter for both players.
- **Some networks block peer-to-peer connections.** See "Online connection problems" above for adding a TURN relay (`CONFIG.TURN_SERVERS`).
- Online play loads PeerJS from unpkg and fonts from Google Fonts, so it needs internet access. vs-CPU works offline.
