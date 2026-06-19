# ⚽ KEEPIE FOOTY

A side-on **keep-up / keep-away** football game. The ball is never "held" — it's a
free physics object you keep alive by **timing touches** at the right stance
(feet, knee, or head). Juggle it down the pitch and punt it into the far goal; the
camera always follows the **ball**.

Online multiplayer, **1v1 or 2v2**, NPCs fill empty slots. **First to 5 goals.**

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Open in a couple of browser tabs, or share the lobby code.

- **Quick Play** — instant 1v1 vs CPU.
- **Create Lobby** — pick 1v1 / 2v2, share the code, hit START. Empty slots fill with CPUs.
- **Join** — enter a friend's code.

## Controls

| Key | Action |
|-----|--------|
| **A / D** (or ← / →) | move left / right |
| **W / ↑** | stance **up** (feet → knee → head) |
| **S / ↓** | stance **down** |
| **Space** | **touch the ball** — tap for a gentle juggle, **hold to charge** a bigger launch |

On touch devices, on-screen buttons appear automatically.

## How it plays

- The ball is always live and bouncing. **Time a touch** when it's in your strike
  zone at your current stance:
  - **Feet** — kick it up (and drive it forward)
  - **Knee** — a controlled pop, mostly upward
  - **Head** — a little hop and a nod forward
- **Hold Space to charge.** A light tap keeps the ball up close (keepie-uppie); a
  full charge punts it far — that's your shot.
- **Steal by out-timing** your opponent's touch at the right height. Mistime it and
  you whiff (brief recovery).
- A **dead ball on the ground** can only be revived with a **feet** kick-up — you
  can't just run it in.
- Bounces die quickly and rolls stop fast, so **you can't score from distance** —
  you have to juggle the ball close and finish.

## How it works

- **Server-authoritative** (`server.js`): Node + `ws` runs the whole side-on
  simulation (ball physics, charge-timed touches, stance matching, goals, NPC AI)
  at 30 Hz; clients send only input.
- **Client** (`public/client.js`): HTML5 canvas that fills the window with a
  ball-following zoom, simple chunky pixel players with juggle animations, a charge
  bar, a stance indicator, and snapshot interpolation.
- **Shared tuning** (`shared/constants.js`): one source of truth for Node and the
  browser — pitch size, stance heights, ball physics, hit power, charge.

## Tuning

Almost everything is in `shared/constants.js` (`HIT_*`, `CHARGE_MAX`, `STANCE_H`,
ball `B_*`, `WORLD_W`, `GOAL_TARGET`). NPC behaviour is the `aiThink` function in
`server.js`.
