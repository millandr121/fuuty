# ⚽ NIDHOGG FOOTY

A side-on **tug-of-war football** game — *Nidhogg, but soccer*. Push the ball to
the far goal; the camera follows the **ball** (wherever the ball goes, the screen
goes). Win it back by matching its **height** in a stance duel.

Online multiplayer, **1v1 or 2v2**, with NPCs filling any empty slots. **First to
5 goals wins.**

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Open in a couple of browser tabs, or share the lobby code across machines.

- **Quick Play** — instant 1v1 vs a CPU.
- **Create Lobby** — pick 1v1 / 2v2, share the 4-letter code, hit START. Empty
  slots fill with CPUs.
- **Join** — enter a friend's code.

## Controls

| Key | Action |
|-----|--------|
| **A / D** (or ← / →) | move left / right |
| **W** | jump |
| **↑ / ↓** | change **stance** — feet ↔ knee ↔ head (a raised stance settles back down) |
| **Space** | **act at your stance** |
| **Shift** | **bicycle kick** (desperate forward smash) |

### Stances are everything
Your stance is the **height of the ball** when you control it, and the **height
you challenge at** when you don't:

| Stance | With the ball | Without the ball |
|--------|---------------|------------------|
| **Low** (feet) | dribble · ground shot | slide tackle (running) / low block (still) |
| **Mid** (knee) | knee juggle · volley | charging flying leg-kick |
| **High** (head)| head juggle · header | header duel |

You only win the ball if your challenge **meets the ball at its height**. Slide
at a head-height juggler and you'll whiff; raise to a header and you take it.
Juggle the ball up to dodge a low slide, or **bicycle kick** to smash past a
defender when you're cornered.

## How it works

- **Server-authoritative** (`server.js`): a Node + `ws` server runs the entire
  side-on simulation (platformer physics, stance duels, possession, goals, and
  NPC AI) at 30 Hz and broadcasts snapshots; clients send only input.
- **Client** (`public/client.js`): HTML5 canvas. The camera tracks the ball
  across a long pitch (parallax crowd + mowed stripes), pixel players animate per
  stance/state (run, knee-juggle, header, slide, flying kick, bicycle, faceplant),
  with snapshot interpolation.
- **Shared tuning** (`shared/constants.js`): one source of truth for both Node and
  the browser — pitch size, physics, stance heights, shot power, duel reach.

## Tuning

Everything lives in `shared/constants.js` (physics, stances, shot/duel numbers,
`GOAL_TARGET`, `WORLD_W`). NPC behaviour is the `aiThink` function in `server.js`.
