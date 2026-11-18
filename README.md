# 🤖 ClickBots PvP: Playable Prototype

A 2-minute competitive clicker built from the *ClickBots PvP* GDD. Click the enemy bot to attack, click your own bot to repair, and click the crystal to mine resources. Spend resources on random Bronze, Silver and Gold upgrades. You win by destroying the enemy bot, or by having the most HP when the timer runs out.

**Modes**
- **vs CPU**: offline, with three difficulty levels.
- **Online 1v1**: one player hosts and shares a 5-letter room code or an invite link. The other player joins with it.

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

The same `GameServer` drives vs-CPU mode. The CPU plays through `rpc()` like a human would, so it can't cheat.

The server also caps each player at 20 clicks/sec (`MAX_CLICKS_PER_SEC`) to blunt macros.

---

## Tuning

All the numbers are in **`js/config.js`**: match length, HP, per-click values, tier prices and price growth, and the full upgrade pool, including the timed Shield and Overclock effects. Add an upgrade by adding one line to `UPGRADES`.

To check balance after a change, run the headless simulator:

```bash
node tools/balance-sim.js
```

It plays 200 CPU-vs-CPU matches per pairing and reports win rates, knockout rate and average match length. With the current numbers, Normal vs Normal is about 50/50, averages about 95 seconds, and roughly 10% of matches go to the timer.

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

## Known prototype limits

- **The host is the authority.** A host who edits the JS could cheat. A dedicated server would fix this later, and `server.js` has no DOM dependencies, so it would port to Node with little work.
- **Keep the host's tab in the foreground.** Browsers throttle timers in background tabs, which makes the game stutter for both players.
- **Some networks block peer-to-peer connections** (strict corporate or school NATs). PeerJS's free broker only provides STUN. If players on a locked-down network can't connect, add a TURN server to the `Peer` options in `js/net.js`.
- Online play loads PeerJS from unpkg and fonts from Google Fonts, so it needs internet access. vs-CPU works offline.
