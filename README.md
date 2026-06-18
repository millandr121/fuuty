# ⚽ PIXEL FOOTY

Online multiplayer pixel-guy soccer. Up to **3 players per lobby**, NPCs fill the
rest of a **3v3**, 6-minute matches, with arcade mechanics: juggling, juggle
passes, bicycle kicks, slide tackles and body tackles.

Top-down pitch with a real **ball-height (z) axis** — like the classic arcade
soccer games — so lobs, juggles and bicycle kicks actually arc through the air
and cast shadows.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a few browser tabs (or share the lobby
code across machines on the same network).

- **Quick Play** — start instantly against CPUs (great for tuning mechanics).
- **Create Lobby** — get a 4-letter code, share it, hit START. Empty slots fill
  with CPUs.
- **Join** — enter a friend's code (max 3 humans per lobby).

## Controls

| Key | No ball | Dribbling | Juggling |
|-----|---------|-----------|----------|
| **Move** | `WASD` / Arrows | — | — |
| **Space** | Slide tackle (steals from a dribbler) | Shoot | Juggle pass (pop the ball up) |
| **Shift** | Body tackle (steals from a juggler) | Start juggling | **Bicycle kick** (jump + smash down) |

Touch controls (on-screen stick + A/B buttons) appear automatically on phones/tablets.

### Combos
- **Shift → Shift** while you have the ball: flick it up to juggle, then launch a
  bicycle kick that fires downward toward goal.
- **Space** while juggling: pop the ball into the air to escape pressure, buy
  time, or set up a teammate / a bicycle kick.
- **Body tackle** beats a juggler; **slide tackle** beats a dribbler. Pick the
  right one.

## How it works

- **Server-authoritative** (`server.js`): a Node + `ws` server runs the whole
  simulation — physics, possession, tackles, goals and NPC AI — at 30 Hz and
  broadcasts snapshots. Clients send only input. This keeps everyone in sync and
  makes it easy to tune mechanics in one place.
- **Client** (`public/client.js`): HTML5 canvas renderer with snapshot
  interpolation, pixel-rect players with squash/stretch animations, shadows for
  ball/jump height, and a HUD (score + 6:00 clock).
- **Shared constants** (`shared/constants.js`): one source of truth for field
  size, physics and tuning, loaded by both Node and the browser.

The match is **6 minutes**. Yellow attacks right, Blue attacks left. Most goals
wins.

## Tuning

Almost everything lives in `shared/constants.js` — speeds, gravity, shot power,
tackle reach, juggle heights, match length, team size. NPC behaviour is in the
`aiThink` function in `server.js`.
