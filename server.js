'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const C = require('./shared/constants');

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = urlPath.startsWith('/shared/') ? path.join(__dirname, urlPath) : path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = (v) => (v < 0 ? -1 : 1);
const rand = (a, b) => a + Math.random() * (b - a);
const absd = (a, b) => Math.abs(a - b);
function approach(cur, target, maxDelta) { const d = target - cur; return Math.abs(d) <= maxDelta ? target : cur + sign(d) * maxDelta; }
const ACTION_STATES = new Set([C.S_SHOOT, C.S_VOLLEY, C.S_HEADER, C.S_SLIDE, C.S_BLOCK, C.S_FLY, C.S_BIKE]);

// ---------------------------------------------------------------------------
// rooms / lobbies
// ---------------------------------------------------------------------------
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += ch[Math.floor(Math.random() * ch.length)]; } while (rooms.has(c));
  return c;
}
function createRoom(perSide) {
  const code = makeCode();
  const room = { code, perSide: perSide || 2, members: [], started: false, game: null, loop: null, acc: 0 };
  rooms.set(code, room);
  return room;
}
function broadcast(room, obj) { const m = JSON.stringify(obj); for (const x of room.members) if (x.ws.readyState === 1) x.ws.send(m); }
function lobbyState(room) {
  return { type: 'lobby', code: room.code, perSide: room.perSide, started: room.started,
    players: room.members.map((m) => ({ id: m.id, name: m.name })) };
}

// ---------------------------------------------------------------------------
// game construction
// ---------------------------------------------------------------------------
function newPlayer(team, isNPC, name, controllerId) {
  return {
    id: nextId++, name: name || (isNPC ? 'CPU' : 'P'), team, isNPC, controllerId: controllerId || null,
    x: 0, h: 0, vx: 0, vh: 0, grounded: true, face: C.attackDir(team),
    stance: 0, stanceTimer: 0,
    state: C.S_IDLE, stateTimer: 0, anim: Math.random() * 10,
    stun: 0, kickImm: 0, hitDone: false,
    input: { left: false, right: false, jump: false, up: false, down: false, act: false, bike: false },
    prev: { jump: false, up: false, down: false, act: false, bike: false },
    ai: { cd: 0, stanceCd: 0, readStance: 0, readCd: 0, lazy: rand(0.12, 0.3) },
  };
}
function createGame(room) {
  const perSide = room.perSide;
  const players = [];
  let t0 = 0, t1 = 0;
  for (const m of room.members) {
    const team = t0 <= t1 ? 0 : 1;
    if (team === 0) t0++; else t1++;
    const p = newPlayer(team, false, m.name, m.id);
    players.push(p); m.entId = p.id;
  }
  while (t0 < perSide) { players.push(newPlayer(0, true, 'CPU')); t0++; }
  while (t1 < perSide) { players.push(newPlayer(1, true, 'CPU')); t1++; }
  const game = {
    perSide, players,
    ball: { x: C.WORLD_W / 2, h: 10, vx: 0, vh: 0, owner: null, stance: 0, lastTouch: null, immTeam: null, immTimer: 0 },
    score: [0, 0], over: false, winner: -1, kickoff: 1.0, flash: null,
  };
  resetKickoff(game, 0);
  return game;
}
function teammates(game, team) { return game.players.filter((p) => p.team === team); }
function spawn(game) {
  for (const p of game.players) {
    const mates = teammates(game, p.team); const idx = mates.indexOf(p);
    const side = p.team === 0 ? -1 : 1; // team0 starts left of center
    const base = C.WORLD_W / 2 + side * (180 + idx * 110);
    p.x = base; p.h = 0; p.vx = 0; p.vh = 0; p.grounded = true;
    p.stance = 0; p.stanceTimer = 0; p.state = C.S_IDLE; p.stateTimer = 0; p.stun = 0; p.kickImm = 0;
    p.face = C.attackDir(p.team);
  }
}
function resetKickoff(game) {
  spawn(game);
  const b = game.ball;
  b.x = C.WORLD_W / 2; b.h = 10; b.vx = rand(-40, 40); b.vh = 0; b.owner = null; b.stance = 0; b.immTeam = null; b.immTimer = 0;
  game.kickoff = 0.8;
}

// ---------------------------------------------------------------------------
// simulation
// ---------------------------------------------------------------------------
const findP = (game, id) => game.players.find((p) => p.id === id);

function stepGame(game, dt) {
  if (game.over) return;
  if (game.kickoff > 0) game.kickoff -= dt;
  if (game.flash) { game.flash.t -= dt; if (game.flash.t <= 0) game.flash = null; }
  for (const p of game.players) { if (p.isNPC) aiThink(game, p, dt); stepPlayer(game, p, dt); }
  stepBall(game, dt);
  separate(game);
  checkGoal(game);
}

function stanceH(s) { return C.STANCE_H[s]; }

function stepPlayer(game, p, dt) {
  p.anim += dt;
  if (p.kickImm > 0) p.kickImm -= dt;

  // vertical motion
  if (!p.grounded || p.vh > 0) {
    p.h += p.vh * dt; p.vh -= C.GRAVITY * dt;
    if (p.h <= 0) { p.h = 0; p.vh = 0; p.grounded = true; } else p.grounded = false;
  }

  // knocked down
  if (p.stun > 0) {
    p.stun -= dt; p.state = C.S_DOWN;
    p.vx = approach(p.vx, 0, 700 * dt); p.x += p.vx * dt; confine(p);
    if (p.stun <= 0) p.state = C.S_IDLE;
    return;
  }

  // timed action states
  if (p.stateTimer > 0 && ACTION_STATES.has(p.state)) {
    p.stateTimer -= dt;
    if (p.state === C.S_SLIDE) { p.vx = approach(p.vx, 0, 520 * dt); p.x += p.vx * dt; contest(game, p, 0, C.SLIDE_REACH); }
    else if (p.state === C.S_BLOCK) { p.vx = approach(p.vx, 0, 800 * dt); p.x += p.vx * dt; contest(game, p, 0, C.BLOCK_REACH); }
    else if (p.state === C.S_FLY) { p.x += p.vx * dt; contest(game, p, 1, C.FLY_REACH); }
    else if (p.state === C.S_HEADER) { p.x += p.vx * dt; contest(game, p, 2, C.HEAD_REACH); }
    else { p.x += p.vx * dt; p.vx = approach(p.vx, 0, 900 * dt); } // shoot/volley/bike lock
    confine(p);
    if (p.stateTimer <= 0 && p.grounded) p.state = C.S_IDLE;
    if (p.stateTimer <= 0 && !p.grounded) p.state = C.S_AIR;
    return;
  }

  // horizontal movement
  const dirIn = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
  p.vx = approach(p.vx, dirIn * C.P_SPEED, C.P_ACCEL * dt);
  p.x += p.vx * dt; confine(p);
  if (dirIn !== 0) p.face = dirIn;

  // jump
  const e = (k) => p.input[k] && !p.prev[k];
  if (e('jump') && p.grounded) { p.vh = C.JUMP_VH; p.grounded = false; }

  // stance changes (juggle up / settle down)
  const has = game.ball.owner === p.id;
  if (e('up')) { p.stance = Math.min(2, p.stance + 1); p.stanceTimer = C.STANCE_SETTLE; if (has) game.ball.vh = 120; }
  if (e('down')) { p.stance = Math.max(0, p.stance - 1); p.stanceTimer = C.STANCE_SETTLE; }
  if (p.stance > 0) { p.stanceTimer -= dt; if (p.stanceTimer <= 0) { p.stance--; p.stanceTimer = C.STANCE_SETTLE; } }

  // actions
  let started = false;
  if (e('act')) started = doAction(game, p) || started;
  if (e('bike')) started = doBicycle(game, p) || started;

  p.prev.jump = p.input.jump; p.prev.up = p.input.up; p.prev.down = p.input.down;
  p.prev.act = p.input.act; p.prev.bike = p.input.bike;

  if (started) return;

  // locomotion state for animation
  if (!p.grounded) p.state = C.S_AIR;
  else if (has) p.state = p.stance === 2 ? C.S_HEAD : p.stance === 1 ? C.S_KNEE : (Math.abs(p.vx) > 30 ? C.S_DRIBBLE : C.S_DRIBBLE);
  else p.state = Math.abs(p.vx) > 30 ? C.S_RUN : C.S_IDLE;
}

function confine(p) { p.x = clamp(p.x, 14, C.WORLD_W - 14); }

function kickImmunity(game, p) { p.kickImm = C.KICK_IMMUNITY; }

// Space — with ball: kick forward at stance; no ball: contest at stance
function doAction(game, p) {
  const b = game.ball;
  if (b.owner === p.id) {
    releaseShot(game, p);
    return true;
  }
  // start a stance-matched challenge
  if (p.stance === 0) {
    if (Math.abs(p.vx) > 60) { p.state = C.S_SLIDE; p.stateTimer = C.SLIDE_TIME; p.vx = p.face * C.SLIDE_VX; }
    else { p.state = C.S_BLOCK; p.stateTimer = C.BLOCK_TIME; }
  } else if (p.stance === 1) {
    p.state = C.S_FLY; p.stateTimer = C.FLY_TIME; p.vx = p.face * C.FLY_VX; p.vh = C.FLY_VH; p.grounded = false;
  } else {
    p.state = C.S_HEADER; p.stateTimer = C.HEAD_TIME; p.vh = C.HEAD_VH; p.grounded = false;
  }
  p.hitDone = false;
  return true;
}

function releaseShot(game, p) {
  const b = game.ball; const dir = p.face;
  let vx, vh, st;
  if (p.stance === 0) { vx = dir * C.SHOT_LOW_VX; vh = C.SHOT_LOW_VH; st = C.S_SHOOT; }
  else if (p.stance === 1) { vx = dir * C.SHOT_MID_VX; vh = C.SHOT_MID_VH; st = C.S_VOLLEY; }
  else { vx = dir * C.SHOT_HIGH_VX; vh = C.SHOT_HIGH_VH; st = C.S_HEADER; }
  b.owner = null; b.vx = vx; b.vh = vh; b.lastTouch = p.id; b.immTeam = p.team; b.immTimer = 0.16;
  kickImmunity(game, p);
  p.state = st; p.stateTimer = 0.22;
}

function doBicycle(game, p) {
  const b = game.ball;
  if (b.owner !== p.id) return false;
  b.owner = null; b.vx = p.face * C.BIKE_VX; b.vh = C.BIKE_VH; b.lastTouch = p.id; b.immTeam = p.team; b.immTimer = 0.16;
  kickImmunity(game, p);
  p.vh = C.BIKE_JUMP; p.grounded = false;
  p.state = C.S_BIKE; p.stateTimer = 0.5;
  return true;
}

// during a challenge, look for a ball to win at this stance height
function contest(game, p, stanceKind, reach) {
  if (p.hitDone) return;
  const b = game.ball;
  const hitX = p.x + p.face * reach;
  const hitH = stanceH(stanceKind);
  // take it off a carrier — connects when your move's height physically meets the ball
  if (b.owner !== null) {
    const o = findP(game, b.owner);
    if (o && o.team !== p.team && o.stun <= 0) {
      if (absd(b.x, hitX) < reach && absd(b.h, hitH) < C.HMATCH) {
        knockDown(o, p); giveBall(game, p, stanceKind); p.hitDone = true; return;
      }
    }
  } else {
    // win a loose ball at matching height
    if (absd(b.x, hitX) < reach && absd(b.h, hitH) < C.HMATCH && (b.immTeam !== p.team || b.immTimer <= 0)) {
      giveBall(game, p, stanceKind); p.hitDone = true;
    }
  }
}

function knockDown(o, by) {
  o.stun = C.STUN_TIME; o.state = C.S_DOWN;
  o.vx = sign((o.x - by.x) || by.face) * 160; o.vh = 120; o.grounded = false;
}
function giveBall(game, p, stance) {
  const b = game.ball;
  b.owner = p.id; b.stance = stance == null ? p.stance : stance; b.lastTouch = p.id;
  b.vx = 0; b.vh = 0; p.stance = b.stance;
  if (b.stance > 0) p.stanceTimer = C.STANCE_SETTLE; // don't instantly settle a trapped high ball
  if (p.ai) p.ai.cd = 0;
}

function stepBall(game, dt) {
  const b = game.ball;
  if (b.immTimer > 0) b.immTimer -= dt;

  if (b.owner !== null) {
    const p = findP(game, b.owner);
    if (!p || p.stun > 0) { b.owner = null; }
    else {
      // glue to carrier so the ball actually meets the foot / knee / head
      b.stance = p.stance;
      const bob = (p.stance > 0 ? Math.sin(p.anim * 11) * C.JUGGLE_BOB : 0);
      const off = C.STANCE_OFF[p.stance] || 10;
      b.x = approach(b.x, p.x + p.face * off, 1600 * dt);
      b.h = approach(b.h, stanceH(p.stance) + bob, 1600 * dt);
      b.vx = 0; b.vh = 0;
      return;
    }
  }

  // free ball
  b.h += b.vh * dt; b.vh -= C.B_GRAVITY * dt; b.x += b.vx * dt;
  if (b.h <= 0) {
    b.h = 0;
    if (b.vh < -25) b.vh = -b.vh * C.B_RESTITUTION; else b.vh = 0;
    const f = Math.max(0, 1 - C.B_FRICTION * dt); b.vx *= f;
    if (Math.abs(b.vx) < 4) b.vx = 0;
  } else { const f = Math.max(0, 1 - C.B_AIRDRAG * dt); b.vx *= f; }

  // end walls: bounce only above the crossbar (below = it's a goal, handled elsewhere)
  if (b.x < C.B_RADIUS && b.h >= C.CROSSBAR_H) { b.x = C.B_RADIUS; b.vx = Math.abs(b.vx) * 0.5; }
  if (b.x > C.WORLD_W - C.B_RADIUS && b.h >= C.CROSSBAR_H) { b.x = C.WORLD_W - C.B_RADIUS; b.vx = -Math.abs(b.vx) * 0.5; }
  b.x = clamp(b.x, -40, C.WORLD_W + 40);

  // passive pickup of a slow loose ball
  if (game.kickoff <= 0) {
    const sp = Math.abs(b.vx);
    if (sp < C.COLLECT_VMAX) {
      let best = null, bd = 1e9;
      for (const p of game.players) {
        if (p.stun > 0 || p.kickImm > 0) continue;
        if (b.immTeam === p.team && b.immTimer > 0) continue;
        // is the ball within reach of one of this player's stance heights?
        const stanceNear = nearestStance(b.h);
        if (absd(b.h, stanceH(stanceNear)) > C.HMATCH + 12) continue;
        const d = absd(b.x, p.x);
        if (d < C.COLLECT_R && d < bd) { best = p; bd = d; best._st = stanceNear; }
      }
      if (best) giveBall(game, best, best._st);
    }
  }
}
function nearestStance(h) {
  let bi = 0, bd = 1e9;
  for (let i = 0; i < 3; i++) { const d = absd(h, C.STANCE_H[i]); if (d < bd) { bd = d; bi = i; } }
  return bi;
}

function separate(game) {
  const ps = game.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], c = ps[j];
    if (absd(a.h, c.h) > C.P_H) continue;
    const dx = c.x - a.x, d = Math.abs(dx), min = C.P_RADIUS * 2;
    if (d > 0.01 && d < min) { const push = (min - d) / 2 * sign(dx); a.x -= push; c.x += push; confine(a); confine(c); }
  }
}

function checkGoal(game) {
  const b = game.ball;
  if (b.owner !== null || b.h >= C.CROSSBAR_H) return;
  let scorer = -1;
  if (b.x <= C.GOAL_L) scorer = 1;
  else if (b.x >= C.GOAL_R) scorer = 0;
  if (scorer < 0) return;
  game.score[scorer]++;
  if (game.score[scorer] >= C.GOAL_TARGET) { game.over = true; game.winner = scorer; game.flash = { text: 'GOAL!', t: 2.5 }; }
  else { game.flash = { text: 'GOAL!', t: 2.0 }; resetKickoff(game); }
}

// ---------------------------------------------------------------------------
// NPC AI
// ---------------------------------------------------------------------------
function clearAI(p) { const i = p.input; i.left = i.right = i.jump = i.up = i.down = i.act = i.bike = false; }
function pressTowardStance(p, target) {
  // NPCs match stance with a human-like delay, not instantly
  if (p.ai.stanceCd > 0) return;
  if (p.stance < target) { p.stance++; p.stanceTimer = C.STANCE_SETTLE; p.ai.stanceCd = 0.2; }
  else if (p.stance > target) { p.stance--; p.stanceTimer = C.STANCE_SETTLE; p.ai.stanceCd = 0.2; }
}
function aiThink(game, p, dt) {
  clearAI(p);
  if (p.ai.cd > 0) p.ai.cd -= dt;
  if (p.ai.stanceCd > 0) p.ai.stanceCd -= dt;
  if (p.ai.readCd > 0) p.ai.readCd -= dt;
  if (p.stun > 0 || (p.stateTimer > 0 && ACTION_STATES.has(p.state)) || game.kickoff > 0) return;

  const b = game.ball;
  const dir = C.attackDir(p.team);
  const goalX = C.targetGoalX(p.team);
  const owner = b.owner !== null ? findP(game, b.owner) : null;

  // delayed, occasionally-wrong read of the ball's height — this is what makes
  // the defender beatable: switch stance (or bicycle) at the last moment and it whiffs.
  if (p.ai.readCd <= 0) {
    const truth = owner ? b.stance : nearestStance(b.h);
    p.ai.readStance = (Math.random() < 0.2) ? clamp(truth + (Math.random() < 0.5 ? -1 : 1), 0, 2) : truth;
    p.ai.readCd = p.ai.lazy; // reaction time before re-reading
  }

  if (owner && owner.id === p.id) {
    // I HAVE THE BALL — drive toward goal
    p.face = dir;
    if (dir > 0) p.input.right = true; else p.input.left = true;
    const distGoal = Math.abs(goalX - p.x);
    // nearest opponent ahead of me
    let opp = null, od = 1e9;
    for (const o of game.players) if (o.team !== p.team && o.stun <= 0) { const dd = (o.x - p.x) * dir; if (dd > -20 && dd < od) { od = dd; opp = o; } }
    if (p.ai.cd <= 0) {
      if (distGoal < 320) { p.input.act = true; p.ai.cd = 0.55; }      // shoot at goal
      else if (opp && od < 70) {
        const r = Math.random();
        if (r < 0.5) { p.input.bike = true; p.ai.cd = 0.9; }           // smash past
        else { pressTowardStance(p, 1 + (Math.random() < 0.5 ? 1 : 0)); p.ai.cd = 0.7; } // raise height to dodge a slide
      }
    }
  } else if (owner && owner.team === p.team) {
    // support: get ahead of the ball toward goal
    const tx = clamp(owner.x + dir * 150, 30, C.WORLD_W - 30);
    moveTo(p, tx, 26);
  } else if (owner && owner.team !== p.team) {
    // DEFEND — close down and challenge at its *believed* height (delayed/imperfect)
    moveTo(p, b.x - p.face * 20, 8);
    p.face = sign(b.x - p.x) || p.face;
    pressTowardStance(p, p.ai.readStance);
    // only commits when its (lagged) stance genuinely matches the ball — so late
    // stance changes by the attacker make it whiff
    if (absd(b.x, p.x) < 46 && p.stance === b.stance && p.ai.cd <= 0) { p.input.act = true; p.ai.cd = 0.7; }
  } else {
    // loose ball — go get it, set stance to its believed height
    moveTo(p, b.x, 4);
    p.face = sign(b.x - p.x) || p.face;
    pressTowardStance(p, p.ai.readStance);
    if (absd(b.x, p.x) < 40 && b.h > C.STANCE_H[1] - 6 && p.stance === nearestStance(b.h) && p.ai.cd <= 0) {
      p.input.act = true; p.ai.cd = 0.5;
    }
  }
}
function moveTo(p, tx, dead) {
  const dx = tx - p.x;
  if (dx > (dead || 6)) p.input.right = true; else if (dx < -(dead || 6)) p.input.left = true;
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------
const r1 = (v) => Math.round(v * 10) / 10;
function snapshot(game) {
  return {
    type: 'state',
    score: game.score, over: game.over, winner: game.winner, target: C.GOAL_TARGET,
    kickoff: game.kickoff > 0, flash: game.flash ? game.flash.text : null,
    ball: { x: r1(game.ball.x), h: r1(game.ball.h), owner: game.ball.owner, stance: game.ball.stance },
    players: game.players.map((p) => ({
      id: p.id, team: p.team, name: p.name, npc: p.isNPC,
      x: r1(p.x), h: r1(p.h), f: p.face, st: p.stance, s: p.state, a: r1(p.anim),
    })),
  };
}

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------
function startMatch(room) {
  if (room.started) return;
  room.started = true; room.game = createGame(room); room.acc = 0;
  broadcast(room, { type: 'start', perSide: room.perSide });
  const dt = 1 / C.TICK_HZ; let last = Date.now();
  room.loop = setInterval(() => {
    const now = Date.now(); let acc = (now - last) / 1000; last = now; if (acc > 0.25) acc = 0.25;
    room.acc += acc;
    while (room.acc >= dt) { stepGame(room.game, dt); room.acc -= dt; }
    const snap = snapshot(room.game);
    for (const m of room.members) if (m.ws.readyState === 1) m.ws.send(JSON.stringify(Object.assign({}, snap, { youEnt: m.entId || null })));
    if (room.game.over) {
      broadcast(room, { type: 'gameover', score: room.game.score, winner: room.game.winner });
      clearInterval(room.loop); room.loop = null;
      setTimeout(() => { if (!rooms.has(room.code)) return; room.started = false; room.game = null; broadcast(room, lobbyState(room)); }, 6000);
    }
  }, 1000 / C.TICK_HZ);
}
function destroyRoom(room) { if (room.loop) clearInterval(room.loop); rooms.delete(room.code); }

// ---------------------------------------------------------------------------
// websocket
// ---------------------------------------------------------------------------
wss.on('connection', (ws) => {
  const member = { ws, name: 'Player', id: nextId++, entId: null, room: null };
  let room = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    switch (msg.type) {
      case 'solo': {
        member.name = (msg.name || 'Player').slice(0, 12);
        room = createRoom(1); member.room = room; room.members.push(member);
        ws.send(JSON.stringify(lobbyState(room))); startMatch(room); break;
      }
      case 'create': {
        member.name = (msg.name || 'Player').slice(0, 12);
        room = createRoom(msg.perSide === 1 ? 1 : 2); member.room = room; room.members.push(member);
        ws.send(JSON.stringify(lobbyState(room))); break;
      }
      case 'mode': { if (room && !room.started && room.members[0] === member) { room.perSide = msg.perSide === 1 ? 1 : 2; broadcast(room, lobbyState(room)); } break; }
      case 'join': {
        const r = rooms.get((msg.code || '').toUpperCase());
        if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby not found' })); break; }
        if (r.started) { ws.send(JSON.stringify({ type: 'error', msg: 'Match already started' })); break; }
        if (r.members.length >= r.perSide * 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby full' })); break; }
        member.name = (msg.name || 'Player').slice(0, 12);
        room = r; member.room = room; room.members.push(member); broadcast(room, lobbyState(room)); break;
      }
      case 'start': { if (room && !room.started && room.members[0] === member) startMatch(room); break; }
      case 'input': {
        if (!room || !room.game || !member.entId) break;
        const p = findP(room.game, member.entId); if (!p) break;
        const i = p.input;
        i.left = !!msg.left; i.right = !!msg.right; i.jump = !!msg.jump;
        i.up = !!msg.up; i.down = !!msg.down; i.act = !!msg.act; i.bike = !!msg.bike;
        break;
      }
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.members = room.members.filter((m) => m !== member);
    if (room.game && member.entId) { const p = findP(room.game, member.entId); if (p) { p.isNPC = true; p.name = 'CPU'; } }
    if (room.members.length === 0) destroyRoom(room);
    else if (!room.started) broadcast(room, lobbyState(room));
  });
});

module.exports = { createRoom, createGame, stepGame, resetKickoff, doAction, doBicycle, giveBall, findP, newPlayer, snapshot, C };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`⚽ Nidhogg Footy on http://localhost:${PORT}`));
}
