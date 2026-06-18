'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const C = require('./shared/constants');

// ---------------------------------------------------------------------------
// Static file server (serves /public)
// ---------------------------------------------------------------------------
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // shared constants are fetched by the client too
  let filePath;
  if (urlPath.startsWith('/shared/')) filePath = path.join(__dirname, urlPath);
  else filePath = path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len = (x, y) => Math.hypot(x, y);
const rand = (a, b) => a + Math.random() * (b - a);
function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

// ---------------------------------------------------------------------------
// Rooms / lobbies
// ---------------------------------------------------------------------------
const rooms = new Map(); // code -> room
let nextEntId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    members: [],     // {ws, name, id, ready}
    started: false,
    game: null,
    loop: null,
    snapAcc: 0,
  };
  rooms.set(code, room);
  return room;
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const m of room.members) {
    if (m.ws.readyState === 1) m.ws.send(msg);
  }
}

function lobbyState(room) {
  return {
    type: 'lobby',
    code: room.code,
    started: room.started,
    players: room.members.map((m) => ({ id: m.id, name: m.name, ready: m.ready })),
  };
}

// ---------------------------------------------------------------------------
// Game construction
// ---------------------------------------------------------------------------
function newPlayer(team, isNPC, name, controllerId) {
  return {
    id: nextEntId++,
    name: name || (isNPC ? 'CPU' : 'P'),
    team, isNPC, controllerId: controllerId || null,
    x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0,
    facing: team === 0 ? 0 : Math.PI,
    state: C.S_IDLE, stateTimer: 0, anim: 0,
    stun: 0, kickImm: 0,
    input: { up: false, down: false, left: false, right: false, primary: false, special: false },
    prev: { primary: false, special: false },
    ai: { target: null, retarget: 0, actCd: 0 },
  };
}

function spawnPositions(team) {
  // formation: 3 across, defenders near own goal-ish; team 0 attacks +x, team 1 attacks -x
  const left = team === 0;
  const baseX = left ? C.FIELD_W * 0.28 : C.FIELD_W * 0.72;
  const ys = [C.FIELD_H * 0.3, C.FIELD_H * 0.5, C.FIELD_H * 0.7];
  return ys.map((y, i) => ({ x: baseX + (left ? -1 : 1) * (i === 1 ? -40 : 0), y }));
}

function createGame(room) {
  const humans = room.members.slice(); // order matters for team assignment
  const players = [];
  // assign humans alternating to balance teams
  let t0 = 0, t1 = 0;
  for (const m of humans) {
    const team = t0 <= t1 ? 0 : 1;
    if (team === 0) t0++; else t1++;
    const p = newPlayer(team, false, m.name, m.id);
    players.push(p);
    m.entId = p.id;
  }
  // fill with NPCs
  while (t0 < C.TEAM_SIZE) { players.push(newPlayer(0, true, 'CPU')); t0++; }
  while (t1 < C.TEAM_SIZE) { players.push(newPlayer(1, true, 'CPU')); t1++; }

  const game = {
    players,
    ball: { x: C.FIELD_W / 2, y: C.FIELD_H / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: null, juggling: false, lastTouch: null, immTeam: null, immTimer: 0 },
    score: [0, 0],
    clock: C.MATCH_SECONDS,
    over: false,
    kickoffTimer: 1.0,
    flash: null, // {text, t}
  };
  resetKickoff(game, 0);
  return game;
}

function resetKickoff(game, towardTeam) {
  for (const p of game.players) {
    const pos = spawnPositions(p.team);
    // give each teammate a distinct slot
    const mates = game.players.filter((q) => q.team === p.team);
    const idx = mates.indexOf(p);
    const slot = pos[idx % pos.length];
    p.x = slot.x; p.y = slot.y; p.vx = 0; p.vy = 0; p.z = 0; p.vz = 0;
    p.state = C.S_IDLE; p.stateTimer = 0; p.stun = 0; p.kickImm = 0;
    p.facing = p.team === 0 ? 0 : Math.PI;
  }
  const b = game.ball;
  b.x = C.FIELD_W / 2; b.y = C.FIELD_H / 2; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
  b.owner = null; b.juggling = false; b.immTeam = null; b.immTimer = 0;
  game.kickoffTimer = 0.8;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function findPlayer(game, id) { return game.players.find((p) => p.id === id); }

function attackDir(team) { return team === 0 ? 1 : -1; } // +x or -x
function ownGoalX(team) { return team === 0 ? C.WALL : C.FIELD_W - C.WALL; }
function targetGoalX(team) { return team === 0 ? C.FIELD_W - C.WALL : C.WALL; }

function stepGame(game, dt) {
  if (game.over) return;

  // clock
  if (game.kickoffTimer > 0) game.kickoffTimer -= dt;
  else {
    game.clock -= dt;
    if (game.clock <= 0) { game.clock = 0; game.over = true; }
  }
  if (game.flash) { game.flash.t -= dt; if (game.flash.t <= 0) game.flash = null; }

  for (const p of game.players) {
    if (p.isNPC) aiThink(game, p, dt);
    stepPlayer(game, p, dt);
  }
  stepBall(game, dt);
  resolvePlayerCollisions(game);
  checkGoals(game);
}

function stepPlayer(game, p, dt) {
  p.anim += dt;
  if (p.kickImm > 0) p.kickImm -= dt;

  // jump physics (player z)
  if (p.z > 0 || p.vz !== 0) {
    p.z += p.vz * dt;
    p.vz -= C.GRAVITY * dt;
    if (p.z <= 0) { p.z = 0; p.vz = 0; }
  }

  // down/stunned: lie there
  if (p.stun > 0) {
    p.stun -= dt;
    p.vx = approach(p.vx, 0, 600 * dt);
    p.vy = approach(p.vy, 0, 600 * dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.state = C.S_DOWN;
    confinePlayer(p);
    if (p.stun <= 0) { p.state = C.S_IDLE; }
    return;
  }

  // timed states (slide / body / bicycle / shoot)
  if (p.stateTimer > 0) {
    p.stateTimer -= dt;
    if (p.state === C.S_SLIDE) {
      // keep momentum, decelerate
      p.vx = approach(p.vx, 0, 520 * dt);
      p.vy = approach(p.vy, 0, 520 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      tackleProbe(game, p, C.SLIDE_REACH, 'slide');
      confinePlayer(p);
      if (p.stateTimer <= 0) p.state = C.S_IDLE;
      return;
    }
    if (p.state === C.S_BODY) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx = approach(p.vx, 0, 400 * dt);
      p.vy = approach(p.vy, 0, 400 * dt);
      tackleProbe(game, p, C.BODY_REACH, 'body');
      confinePlayer(p);
      if (p.stateTimer <= 0) p.state = C.S_IDLE;
      return;
    }
    if (p.state === C.S_BICYCLE || p.state === C.S_SHOOT) {
      // brief lock; movement frozen-ish
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx = approach(p.vx, 0, 800 * dt);
      p.vy = approach(p.vy, 0, 800 * dt);
      confinePlayer(p);
      if (p.stateTimer <= 0) p.state = (p.z > 0 ? p.state : C.S_IDLE);
      if (p.stateTimer <= 0 && p.z <= 0) p.state = C.S_IDLE;
      return;
    }
  }

  // normal movement from input
  const inx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
  const iny = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
  let dvx = 0, dvy = 0;
  const l = len(inx, iny);
  if (l > 0) {
    dvx = (inx / l) * C.P_SPEED;
    dvy = (iny / l) * C.P_SPEED;
    p.facing = Math.atan2(iny, inx);
  }
  p.vx = approach(p.vx, dvx, C.P_ACCEL * dt);
  p.vy = approach(p.vy, dvy, C.P_ACCEL * dt);
  p.x += p.vx * dt; p.y += p.vy * dt;
  confinePlayer(p);

  const hasBall = game.ball.owner === p.id;
  if (game.ball.juggling && hasBall) p.state = C.S_JUGGLE;
  else p.state = l > 0 ? C.S_RUN : C.S_IDLE;

  // ---- actions (edge triggered) ----
  const primEdge = p.input.primary && !p.prev.primary;
  const specEdge = p.input.special && !p.prev.special;
  p.prev.primary = p.input.primary;
  p.prev.special = p.input.special;

  if (primEdge) doPrimary(game, p);
  if (specEdge) doSpecial(game, p);
}

function confinePlayer(p) {
  p.x = clamp(p.x, C.WALL + C.P_RADIUS, C.FIELD_W - C.WALL - C.P_RADIUS);
  p.y = clamp(p.y, C.WALL + C.P_RADIUS, C.FIELD_H - C.WALL - C.P_RADIUS);
}

function kickImmunity(game, p) {
  p.kickImm = C.KICK_IMMUNITY;
  game.ball.immTeam = null; // anyone can pick up
}

// Primary: shoot / juggle pass / slide tackle / trap
function doPrimary(game, p) {
  const b = game.ball;
  const hasBall = b.owner === p.id;
  if (hasBall && b.juggling) {
    // juggle pass: pop ball up & forward
    b.owner = null; b.juggling = false;
    b.vx = Math.cos(p.facing) * C.JUGGLE_PASS_FWD;
    b.vy = Math.sin(p.facing) * C.JUGGLE_PASS_FWD;
    b.vz = C.JUGGLE_PASS_VZ;
    b.lastTouch = p.id;
    kickImmunity(game, p);
    p.state = C.S_SHOOT; p.stateTimer = 0.2;
    return;
  }
  if (hasBall) {
    // shoot along the ground/low
    b.owner = null; b.juggling = false;
    b.vx = Math.cos(p.facing) * C.SHOOT_SPEED;
    b.vy = Math.sin(p.facing) * C.SHOOT_SPEED;
    b.vz = C.SHOOT_LIFT;
    b.lastTouch = p.id;
    kickImmunity(game, p);
    p.state = C.S_SHOOT; p.stateTimer = 0.22;
    return;
  }
  // no ball: try to trap an airborne ball nearby, else slide tackle
  if (b.owner === null && len(b.x - p.x, b.y - p.y) < C.COLLECT_RADIUS + 10 && b.z < C.JUGGLE_HIGH + 20) {
    // soft trap -> begin dribbling
    if (canCollect(game, p)) { giveBall(game, p, false); return; }
  }
  // slide tackle
  p.state = C.S_SLIDE; p.stateTimer = C.SLIDE_TIME;
  p.vx = Math.cos(p.facing) * C.SLIDE_SPEED;
  p.vy = Math.sin(p.facing) * C.SLIDE_SPEED;
}

// Special: start juggling / bicycle kick / body tackle
function doSpecial(game, p) {
  const b = game.ball;
  const hasBall = b.owner === p.id;
  if (hasBall && !b.juggling) {
    // flick ball up to begin juggling
    b.juggling = true; b.z = C.JUGGLE_LOW; b.vz = C.JUGGLE_BOUNCE_VZ * 0.8;
    p.state = C.S_JUGGLE;
    return;
  }
  if (hasBall && b.juggling) {
    // bicycle kick: jump and smash down-forward
    b.owner = null; b.juggling = false;
    b.vx = Math.cos(p.facing) * C.BICYCLE_SHOT_SPEED;
    b.vy = Math.sin(p.facing) * C.BICYCLE_SHOT_SPEED;
    b.vz = C.BICYCLE_SHOT_DOWN;
    b.lastTouch = p.id;
    kickImmunity(game, p);
    p.vz = C.BICYCLE_JUMP_VZ; p.z = Math.max(p.z, 1);
    p.state = C.S_BICYCLE; p.stateTimer = 0.5;
    return;
  }
  // no ball: body tackle (hop + bump)
  p.state = C.S_BODY; p.stateTimer = C.BODY_TIME;
  p.vz = C.BODY_JUMP_VZ; p.z = Math.max(p.z, 1);
  p.vx = Math.cos(p.facing) * C.BODY_FWD;
  p.vy = Math.sin(p.facing) * C.BODY_FWD;
}

function canCollect(game, p) {
  if (p.kickImm > 0) return false;
  const b = game.ball;
  if (b.immTeam !== null && b.immTeam === p.team && b.immTimer > 0) return false;
  return true;
}

function giveBall(game, p, juggling) {
  const b = game.ball;
  b.owner = p.id; b.juggling = !!juggling; b.lastTouch = p.id;
  b.vx = 0; b.vy = 0; b.vz = 0;
  if (!juggling) b.z = 0;
}

// Tackle probe: while sliding/body-tackling, check for an opponent to dispossess
function tackleProbe(game, p, reach, kind) {
  const b = game.ball;
  for (const o of game.players) {
    if (o === p || o.team === p.team || o.stun > 0) continue;
    const d = len(o.x - p.x, o.y - p.y);
    if (d > reach + C.P_RADIUS) continue;
    // slide steals from a dribbler; body steals from a juggler
    const oHasBall = b.owner === o.id;
    const oDribbling = oHasBall && !b.juggling;
    const oJuggling = oHasBall && b.juggling;
    if (kind === 'slide') {
      // knock the opponent down regardless; steal if they were dribbling
      knockDown(o, p);
      if (oDribbling) {
        // ball pops loose toward tackler, slight pickup chance
        b.owner = null; b.juggling = false; b.z = 0;
        b.vx = Math.cos(p.facing) * 90; b.vy = Math.sin(p.facing) * 90;
        b.lastTouch = p.id;
        game.ball.immTeam = o.team; game.ball.immTimer = 0.25;
      }
    } else if (kind === 'body') {
      knockDown(o, p);
      if (oJuggling || oDribbling) {
        // bump the ball loose, pops up a little
        b.owner = null; b.juggling = false;
        b.vx = Math.cos(p.facing) * 120; b.vy = Math.sin(p.facing) * 120; b.vz = 200;
        b.lastTouch = p.id;
        game.ball.immTeam = o.team; game.ball.immTimer = 0.25;
      }
    }
  }
}

function knockDown(o, by) {
  o.stun = C.STUN_TIME;
  o.state = C.S_DOWN;
  const a = Math.atan2(o.y - by.y, o.x - by.x);
  o.vx = Math.cos(a) * 140;
  o.vy = Math.sin(a) * 140;
}

function stepBall(game, dt) {
  const b = game.ball;
  if (b.immTimer > 0) b.immTimer -= dt;

  if (b.owner !== null) {
    const p = findPlayer(game, b.owner);
    if (!p || p.stun > 0) { b.owner = null; b.juggling = false; }
    else if (b.juggling) {
      // ball bounces on top of the juggler
      b.x = approach(b.x, p.x, 600 * dt);
      b.y = approach(b.y, p.y, 600 * dt);
      b.z += b.vz * dt; b.vz -= C.GRAVITY * dt;
      if (b.z <= C.JUGGLE_LOW && b.vz < 0) { b.z = C.JUGGLE_LOW; b.vz = C.JUGGLE_BOUNCE_VZ; }
      if (b.z > C.JUGGLE_HIGH && b.vz > 0) b.vz = 0;
      return;
    } else {
      // dribbling: ball sits just ahead of the player's feet
      const tx = p.x + Math.cos(p.facing) * C.DRIBBLE_AHEAD;
      const ty = p.y + Math.sin(p.facing) * C.DRIBBLE_AHEAD;
      b.x = approach(b.x, tx, 900 * dt);
      b.y = approach(b.y, ty, 900 * dt);
      b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
      return;
    }
  }

  // free ball physics
  b.z += b.vz * dt;
  b.vz -= C.GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // ground bounce
  if (b.z <= 0) {
    b.z = 0;
    if (b.vz < -30) { b.vz = -b.vz * C.GROUND_RESTITUTION; }
    else b.vz = 0;
    // rolling friction
    const f = Math.max(0, 1 - C.GROUND_FRICTION * dt);
    b.vx *= f; b.vy *= f;
    if (len(b.vx, b.vy) < 5) { b.vx = 0; b.vy = 0; }
  } else {
    // mild air drag
    const f = Math.max(0, 1 - C.AIR_DRAG * dt);
    b.vx *= f; b.vy *= f;
  }

  // wall bounce (top/bottom always; left/right except goal mouth)
  if (b.y < C.WALL + C.B_RADIUS) { b.y = C.WALL + C.B_RADIUS; b.vy = Math.abs(b.vy) * 0.6; }
  if (b.y > C.FIELD_H - C.WALL - C.B_RADIUS) { b.y = C.FIELD_H - C.WALL - C.B_RADIUS; b.vy = -Math.abs(b.vy) * 0.6; }
  const inGoalMouth = b.y > C.GOAL_TOP && b.y < C.GOAL_BOT;
  if (b.x < C.WALL + C.B_RADIUS && !(inGoalMouth && b.z < C.CROSSBAR_Z)) { b.x = C.WALL + C.B_RADIUS; b.vx = Math.abs(b.vx) * 0.6; }
  if (b.x > C.FIELD_W - C.WALL - C.B_RADIUS && !(inGoalMouth && b.z < C.CROSSBAR_Z)) { b.x = C.FIELD_W - C.WALL - C.B_RADIUS; b.vx = -Math.abs(b.vx) * 0.6; }

  // collection. fast-moving shots are hard to corral (gives shooters a chance vs keepers)
  if (game.kickoffTimer <= 0) {
    const speed = len(b.vx, b.vy);
    const grabR = speed > 320 ? C.COLLECT_RADIUS * 0.55 : C.COLLECT_RADIUS;
    let best = null, bestD = 1e9;
    for (const p of game.players) {
      if (p.stun > 0) continue;
      if (!canCollect(game, p)) continue;
      const d = len(b.x - p.x, b.y - p.y);
      if (d < grabR && b.z < C.COLLECT_HEIGHT && d < bestD) { best = p; bestD = d; }
    }
    if (best) giveBall(game, best, false);
  }
}

function resolvePlayerCollisions(game) {
  const ps = game.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = len(dx, dy);
      const min = C.P_RADIUS * 2;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        // downed players get shoved more, standing ones resist
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        confinePlayer(a); confinePlayer(b);
      }
    }
  }
}

function checkGoals(game) {
  const b = game.ball;
  if (b.z >= C.CROSSBAR_Z) return;
  if (!(b.y > C.GOAL_TOP && b.y < C.GOAL_BOT)) return;
  let scorer = -1;
  if (b.x <= C.WALL + 2) scorer = 1;             // into team 0's goal -> team 1 scores
  else if (b.x >= C.FIELD_W - C.WALL - 2) scorer = 0; // into team 1's goal -> team 0 scores
  if (scorer >= 0) {
    game.score[scorer]++;
    game.flash = { text: 'GOAL!', t: 2.2 };
    resetKickoff(game, scorer === 0 ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// NPC AI  (writes into p.input so it shares the same movement code)
// ---------------------------------------------------------------------------
function setMoveTo(p, tx, ty, deadzone) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = len(dx, dy);
  const dz = deadzone || 6;
  p.input.up = dy < -dz;
  p.input.down = dy > dz;
  p.input.left = dx < -dz;
  p.input.right = dx > dz;
  return d;
}

function clearActions(p) { p.input.primary = false; p.input.special = false; }

function aiThink(game, p, dt) {
  clearActions(p);
  if (p.stun > 0 || p.stateTimer > 0) { p.input.up = p.input.down = p.input.left = p.input.right = false; return; }
  if (p.ai.actCd > 0) p.ai.actCd -= dt;
  if (game.kickoffTimer > 0) { p.input.up = p.input.down = p.input.left = p.input.right = false; return; }

  const b = game.ball;
  const goalX = targetGoalX(p.team);
  const goalY = C.FIELD_H / 2;
  const owner = b.owner !== null ? findPlayer(game, b.owner) : null;
  const dBall = len(b.x - p.x, b.y - p.y);

  // role: closest field player to ball on the team becomes the "chaser"
  const mates = game.players.filter((q) => q.team === p.team);
  let chaser = mates[0], cd = 1e9;
  for (const m of mates) { const d = len(b.x - m.x, b.y - m.y); if (d < cd) { cd = d; chaser = m; } }
  const amChaser = chaser === p;
  // keeper-ish: the player whose spawn slot is deepest stays back when defending
  const mateIdx = mates.indexOf(p);
  const isKeeper = mateIdx === 1; // middle slot guards

  if (owner && owner.id === p.id) {
    // won the ball deep in my own third -> clear it upfield instead of dribbling into trouble
    const ownThird = p.team === 0 ? p.x < C.FIELD_W * 0.34 : p.x > C.FIELD_W * 0.66;
    if (ownThird && p.ai.actCd <= 0) {
      p.facing = Math.atan2((goalY + rand(-120, 120)) - p.y, goalX - p.x);
      p.input.primary = true; // hoof
      p.ai.actCd = 0.5;
      return;
    }
    // I have the ball -> head to goal, shoot when close, occasionally trickery
    const d = setMoveTo(p, goalX - attackDir(p.team) * 30, goalY, 6);
    const distGoal = len(goalX - p.x, goalY - p.y);
    // aim at a random spot inside the mouth (not always dead-center) so keepers get beaten
    const aimY = goalY + rand(-C.GOAL_H * 0.32, C.GOAL_H * 0.32);
    p.facing = Math.atan2(aimY - p.y, goalX - p.x);
    if (distGoal < 300 && p.ai.actCd <= 0) {
      if (Math.random() < 0.82) { p.input.primary = true; } // shoot
      else { p.input.special = true; } // start juggle to set up
      p.ai.actCd = 0.5;
    }
    // if a defender is right on me, sometimes juggle-pop to escape
    let pressured = false;
    for (const o of game.players) if (o.team !== p.team && o.stun <= 0 && len(o.x - p.x, o.y - p.y) < 34) pressured = true;
    if (pressured && p.ai.actCd <= 0 && Math.random() < 0.25) {
      if (b.juggling) p.input.primary = true; else p.input.special = true;
      p.ai.actCd = 0.7;
    }
  } else if (owner && owner.team === p.team) {
    // teammate has ball -> spread forward to support
    const supX = clamp(owner.x + attackDir(p.team) * 120, C.WALL + 40, C.FIELD_W - C.WALL - 40);
    const supY = clamp(goalY + (mateIdx - 1) * 130, C.WALL + 30, C.FIELD_H - C.WALL - 30);
    setMoveTo(p, supX, supY, 10);
  } else if (owner && owner.team !== p.team) {
    // opponent has ball -> defend
    if (amChaser) {
      const d = setMoveTo(p, b.x, b.y, 4);
      p.facing = Math.atan2(b.y - p.y, b.x - p.x);
      if (d < 40 && p.ai.actCd <= 0) {
        // pick the right tackle: body if they're juggling, slide if dribbling
        if (b.juggling) p.input.special = true; else p.input.primary = true;
        p.ai.actCd = 0.8;
      }
    } else {
      // mark space between ball and own goal
      const ogx = ownGoalX(p.team);
      const mx = (b.x + ogx) / 2;
      const my = clamp(b.y + (mateIdx - 1) * 90, C.WALL + 30, C.FIELD_H - C.WALL - 30);
      setMoveTo(p, mx, my, 10);
    }
  } else {
    // loose ball
    if (amChaser || dBall < 160) {
      const d = setMoveTo(p, b.x, b.y, 4);
      p.facing = Math.atan2(b.y - p.y, b.x - p.x);
    } else {
      // hold a sensible position
      const hx = clamp((b.x + (isKeeper ? ownGoalX(p.team) : goalX)) / 2, C.WALL + 40, C.FIELD_W - C.WALL - 40);
      const hy = clamp(goalY + (mateIdx - 1) * 120, C.WALL + 30, C.FIELD_H - C.WALL - 30);
      setMoveTo(p, hx, hy, 14);
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot for clients
// ---------------------------------------------------------------------------
function snapshot(room) {
  const g = room.game;
  return {
    type: 'state',
    t: Date.now(),
    clock: g.clock,
    score: g.score,
    over: g.over,
    kickoff: g.kickoffTimer > 0,
    flash: g.flash ? g.flash.text : null,
    ball: { x: r1(g.ball.x), y: r1(g.ball.y), z: r1(g.ball.z), owner: g.ball.owner, juggling: g.ball.juggling },
    players: g.players.map((p) => ({
      id: p.id, team: p.team, name: p.name, npc: p.isNPC,
      x: r1(p.x), y: r1(p.y), z: r1(p.z), f: r2(p.facing), s: p.state, a: r2(p.anim),
      me: false, // filled per-recipient below
    })),
  };
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Loop management
// ---------------------------------------------------------------------------
function startMatch(room) {
  if (room.started) return;
  room.started = true;
  room.game = createGame(room);
  broadcast(room, { type: 'start' });

  const dt = 1 / C.TICK_HZ;
  let last = Date.now();
  room.loop = setInterval(() => {
    const now = Date.now();
    let acc = (now - last) / 1000;
    last = now;
    if (acc > 0.25) acc = 0.25; // avoid spiral of death
    // fixed steps
    room._acc = (room._acc || 0) + acc;
    while (room._acc >= dt) { stepGame(room.game, dt); room._acc -= dt; }

    // send snapshots (each human is told which entity is theirs)
    const snap = snapshot(room);
    for (const m of room.members) {
      if (m.ws.readyState !== 1) continue;
      // tell each human which entity is theirs
      m.ws.send(JSON.stringify(Object.assign({}, snap, { youEnt: m.entId || null })));
    }

    if (room.game.over) {
      broadcast(room, { type: 'gameover', score: room.game.score });
      clearInterval(room.loop); room.loop = null;
      // allow a rematch: reset to lobby after a few seconds
      setTimeout(() => {
        if (!rooms.has(room.code)) return;
        room.started = false; room.game = null; room._acc = 0;
        broadcast(room, lobbyState(room));
      }, 6000);
    }
  }, 1000 / C.TICK_HZ);
}

function destroyRoom(room) {
  if (room.loop) clearInterval(room.loop);
  rooms.delete(room.code);
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------
wss.on('connection', (ws) => {
  let member = { ws, name: 'Player', id: nextEntId++, ready: false, entId: null };
  let room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      case 'create': {
        member.name = (msg.name || 'Player').slice(0, 12);
        room = createRoom();
        member.room = room;
        room.members.push(member);
        ws.send(JSON.stringify(lobbyState(room)));
        break;
      }
      case 'join': {
        const code = (msg.code || '').toUpperCase();
        const r = rooms.get(code);
        if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby not found' })); break; }
        if (r.started) { ws.send(JSON.stringify({ type: 'error', msg: 'Match already started' })); break; }
        if (r.members.length >= 3) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby full (max 3)' })); break; }
        member.name = (msg.name || 'Player').slice(0, 12);
        room = r; member.room = room;
        room.members.push(member);
        broadcast(room, lobbyState(room));
        break;
      }
      case 'solo': {
        // quick play vs NPCs (single-member room, start instantly)
        member.name = (msg.name || 'Player').slice(0, 12);
        room = createRoom();
        member.room = room;
        room.members.push(member);
        ws.send(JSON.stringify(lobbyState(room)));
        startMatch(room);
        break;
      }
      case 'start': {
        if (room && !room.started) startMatch(room);
        break;
      }
      case 'input': {
        if (!room || !room.game || !member.entId) break;
        const p = findPlayer(room.game, member.entId);
        if (!p) break;
        const i = p.input;
        i.up = !!msg.up; i.down = !!msg.down; i.left = !!msg.left; i.right = !!msg.right;
        i.primary = !!msg.primary; i.special = !!msg.special;
        break;
      }
      case 'name': {
        member.name = (msg.name || 'Player').slice(0, 12);
        if (room && !room.started) broadcast(room, lobbyState(room));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.members = room.members.filter((m) => m !== member);
    // turn a disconnected human's player into an NPC mid-match
    if (room.game && member.entId) {
      const p = findPlayer(room.game, member.entId);
      if (p) { p.isNPC = true; p.controllerId = null; p.name = 'CPU'; }
    }
    if (room.members.length === 0) destroyRoom(room);
    else if (!room.started) broadcast(room, lobbyState(room));
  });
});

// Export internals for testing; only listen when run directly.
module.exports = {
  createRoom, createGame, stepGame, resetKickoff, doPrimary, doSpecial,
  giveBall, findPlayer, tackleProbe, newPlayer, C,
};

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`⚽ Pixel Footy server running on http://localhost:${PORT}`);
  });
}
