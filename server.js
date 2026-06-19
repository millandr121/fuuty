'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const C = require('./shared/constants');

// ---------------------------------------------------------------------------
// static files
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
    charging: false, chargeT: 0, hitCd: 0,
    input: { left: false, right: false, up: false, down: false, act: false },
    prev: { up: false, down: false, act: false },
    ai: { cd: 0, stanceCd: 0, readStance: 0, readCd: 0, lazy: rand(0.1, 0.26) },
  };
}
function createGame(room) {
  const perSide = room.perSide;
  const players = [];
  let t0 = 0, t1 = 0;
  for (const m of room.members) {
    const team = t0 <= t1 ? 0 : 1; if (team === 0) t0++; else t1++;
    const p = newPlayer(team, false, m.name, m.id); players.push(p); m.entId = p.id;
  }
  while (t0 < perSide) { players.push(newPlayer(0, true, 'CPU')); t0++; }
  while (t1 < perSide) { players.push(newPlayer(1, true, 'CPU')); t1++; }
  const game = {
    perSide, players,
    ball: { x: C.WORLD_W / 2, h: 60, vx: 0, vh: 0, touch: -1 },
    score: [0, 0], over: false, winner: -1, kickoff: 1.0, flash: null,
  };
  spawn(game);
  return game;
}
function teammates(game, team) { return game.players.filter((p) => p.team === team); }
function spawn(game) {
  for (const p of game.players) {
    const mates = teammates(game, p.team); const idx = mates.indexOf(p);
    const side = p.team === 0 ? -1 : 1;
    p.x = C.WORLD_W / 2 + side * (200 + idx * 130);
    p.h = 0; p.vx = 0; p.vh = 0; p.grounded = true; p.stance = 0; p.stanceTimer = 0;
    p.state = C.S_IDLE; p.stateTimer = 0; p.charging = false; p.chargeT = 0; p.hitCd = 0;
    p.face = C.attackDir(p.team);
  }
}
function resetKickoff(game) {
  spawn(game);
  const b = game.ball;
  b.x = C.WORLD_W / 2; b.h = 60; b.vx = rand(-25, 25); b.vh = 0; b.touch = -1;
  game.kickoff = 0.8;
}

// ---------------------------------------------------------------------------
// simulation
// ---------------------------------------------------------------------------
const findP = (game, id) => game.players.find((p) => p.id === id);
const stanceH = (s) => C.STANCE_H[s];

function stepGame(game, dt) {
  if (game.over) return;
  if (game.kickoff > 0) game.kickoff -= dt;
  if (game.flash) { game.flash.t -= dt; if (game.flash.t <= 0) game.flash = null; }
  for (const p of game.players) { if (p.isNPC) aiThink(game, p, dt); stepPlayer(game, p, dt); }
  stepBall(game, dt);
  separate(game);
  checkGoal(game);
}

function stepPlayer(game, p, dt) {
  p.anim += dt;
  if (p.hitCd > 0) p.hitCd -= dt;

  // vertical (only the header hop lifts the player)
  if (!p.grounded || p.vh > 0) {
    p.h += p.vh * dt; p.vh -= C.GRAVITY * dt;
    if (p.h <= 0) { p.h = 0; p.vh = 0; p.grounded = true; } else p.grounded = false;
  }

  // brief swing/whiff animation lock (movement still allowed, just for visuals)
  if (p.stateTimer > 0) { p.stateTimer -= dt; if (p.stateTimer <= 0 && p.grounded) p.state = C.S_IDLE; }

  // movement
  const dirIn = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
  p.vx = approach(p.vx, dirIn * C.P_SPEED, C.P_ACCEL * dt);
  p.x += p.vx * dt; confine(p);
  if (dirIn !== 0) p.face = dirIn;

  // stance (juggle height) up/down, with slow settle back to feet
  const e = (k) => p.input[k] && !p.prev[k];
  if (e('up')) { p.stance = Math.min(2, p.stance + 1); p.stanceTimer = C.STANCE_SETTLE; }
  if (e('down')) { p.stance = Math.max(0, p.stance - 1); p.stanceTimer = C.STANCE_SETTLE; }
  if (p.stance > 0) { p.stanceTimer -= dt; if (p.stanceTimer <= 0) { p.stance--; p.stanceTimer = C.STANCE_SETTLE; } }

  // charge while Space held; strike on release
  if (e('act')) { p.charging = true; p.chargeT = 0; }
  if (p.charging) { p.chargeT = Math.min(C.CHARGE_MAX, p.chargeT + dt); }
  if (!p.input.act && p.prev.act) { // released
    if (p.charging) { doHit(game, p, p.chargeT / C.CHARGE_MAX); p.charging = false; }
  }

  p.prev.up = p.input.up; p.prev.down = p.input.down; p.prev.act = p.input.act;

  // locomotion state for animation (unless a swing is playing)
  if (p.stateTimer <= 0) {
    if (!p.grounded) p.state = C.S_AIR;
    else p.state = Math.abs(p.vx) > 25 ? C.S_RUN : C.S_IDLE;
  }
}
function confine(p) { p.x = clamp(p.x, 14, C.WORLD_W - 14); }

// the juggle hit: pop the ball up+forward if it's in the strike zone at this stance
function doHit(game, p, power) {
  if (p.hitCd > 0) return false;
  power = clamp(power, 0, 1);
  const b = game.ball;
  const zx = p.x + p.face * C.STANCE_OFF[p.stance];
  const zh = stanceH(p.stance);
  const inZone = absd(b.x, zx) < C.HIT_RX && absd(b.h, zh) < C.HIT_RH;
  if (!inZone) { p.state = C.S_WHIFF; p.stateTimer = 0.18; p.hitCd = C.WHIFF_CD; return false; }

  let up = C.HIT_UP_MIN + power * (C.HIT_UP_MAX - C.HIT_UP_MIN);
  let fwd = C.HIT_FWD_MIN + power * (C.HIT_FWD_MAX - C.HIT_FWD_MIN);
  if (p.stance === 0) { fwd *= 1.18; up *= 0.92; p.state = C.S_KICK; }       // foot: drive
  else if (p.stance === 1) { fwd *= 0.72; up *= 1.08; p.state = C.S_KNEE; }  // knee: control pop
  else { fwd *= 1.0; up *= 0.82; p.state = C.S_HEAD; p.vh = C.HOP_VH; p.grounded = false; } // head: little hop
  b.vx = p.face * fwd; b.vh = up; b.touch = p.team;
  p.stateTimer = 0.2; p.hitCd = C.HIT_CD;
  return true;
}

function stepBall(game, dt) {
  const b = game.ball;
  b.h += b.vh * dt; b.vh -= C.B_GRAVITY * dt; b.x += b.vx * dt;
  if (b.h > C.B_HMAX) { b.h = C.B_HMAX; if (b.vh > 0) b.vh = 0; }
  if (b.h <= 0) {
    b.h = 0;
    if (b.vh < -25) b.vh = -b.vh * C.B_RESTITUTION; else b.vh = 0;
    const f = Math.max(0, 1 - C.B_FRICTION * dt); b.vx *= f;
    if (Math.abs(b.vx) < 3) b.vx = 0;
  } else { const f = Math.max(0, 1 - C.B_AIRDRAG * dt); b.vx *= f; }

  // end walls bounce only above the crossbar (below the bar = goal, handled in checkGoal)
  if (b.x < C.B_RADIUS && b.h >= C.CROSSBAR_H) { b.x = C.B_RADIUS; b.vx = Math.abs(b.vx) * 0.4; }
  if (b.x > C.WORLD_W - C.B_RADIUS && b.h >= C.CROSSBAR_H) { b.x = C.WORLD_W - C.B_RADIUS; b.vx = -Math.abs(b.vx) * 0.4; }
  b.x = clamp(b.x, -30, C.WORLD_W + 30);
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
  if (b.h >= C.CROSSBAR_H) return;
  let scorer = -1;
  if (b.x <= C.GOAL_L) scorer = 1;
  else if (b.x >= C.GOAL_R) scorer = 0;
  if (scorer < 0) return;
  game.score[scorer]++;
  if (game.score[scorer] >= C.GOAL_TARGET) { game.over = true; game.winner = scorer; game.flash = { text: 'GOAL!', t: 2.5 }; }
  else { game.flash = { text: 'GOAL!', t: 2.0 }; resetKickoff(game); }
}

// ---------------------------------------------------------------------------
// NPC AI — play keepie-uppie: get under the ball, match its height, time a touch
// toward the opponent's goal. Reaction is delayed/imperfect so it's beatable.
// ---------------------------------------------------------------------------
function clearAI(p) { const i = p.input; i.left = i.right = i.up = i.down = i.act = false; }
function moveTo(p, tx, dead) { const dx = tx - p.x; if (dx > (dead || 6)) p.input.right = true; else if (dx < -(dead || 6)) p.input.left = true; }
function aiSetStance(p, target) {
  if (p.ai.stanceCd > 0) return;
  if (p.stance < target) { p.stance++; p.stanceTimer = C.STANCE_SETTLE; p.ai.stanceCd = 0.16; }
  else if (p.stance > target) { p.stance--; p.stanceTimer = C.STANCE_SETTLE; p.ai.stanceCd = 0.16; }
}
function aiThink(game, p, dt) {
  clearAI(p);
  if (p.ai.cd > 0) p.ai.cd -= dt;
  if (p.ai.stanceCd > 0) p.ai.stanceCd -= dt;
  if (p.ai.readCd > 0) p.ai.readCd -= dt;
  if (game.kickoff > 0) return;

  const b = game.ball;
  const dir = C.attackDir(p.team);
  const goalX = C.targetGoalX(p.team);

  // who on my team is closest to the ball -> the active juggler/contester
  const mates = teammates(game, p.team);
  let chaser = mates[0], cd = 1e9;
  for (const m of mates) { const d = absd(b.x, m.x); if (d < cd) { cd = d; chaser = m; } }
  const amChaser = chaser === p;
  const mateIdx = mates.indexOf(p);

  // delayed, occasionally-wrong read of the ball's height (beatable)
  if (p.ai.readCd <= 0) {
    const truth = C.nearestStance(b.h);
    p.ai.readStance = Math.random() < 0.18 ? clamp(truth + (Math.random() < 0.5 ? -1 : 1), 0, 2) : truth;
    p.ai.readCd = p.ai.lazy;
  }

  if (!amChaser) {
    // hang in a supporting spot ahead toward the attacking goal
    const tx = clamp((b.x + goalX) / 2 + dir * 40 * (mateIdx + 1), 40, C.WORLD_W - 40);
    moveTo(p, tx, 18);
    return;
  }

  // get under the ball so it drops into my strike zone in front of me
  p.face = dir;
  const want = b.x - dir * C.STANCE_OFF[p.ai.readStance];
  moveTo(p, want, 5);
  aiSetStance(p, p.ai.readStance);

  // attempt a touch when the ball is in range and on its way down
  const zx = p.x + dir * C.STANCE_OFF[p.stance], zh = stanceH(p.stance);
  const inZone = absd(b.x, zx) < C.HIT_RX * 0.9 && absd(b.h, zh) < C.HIT_RH;
  if (inZone && p.hitCd <= 0 && p.ai.cd <= 0) {
    const distGoal = absd(goalX, p.x);
    let power;
    if (distGoal < 240) power = rand(0.75, 1);     // close: shoot
    else power = rand(0.35, 0.6);                   // advance with a measured touch
    doHit(game, p, power);
    p.ai.cd = 0.12;
  }
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
    ball: { x: r1(game.ball.x), h: r1(game.ball.h), touch: game.ball.touch },
    players: game.players.map((p) => ({
      id: p.id, team: p.team, name: p.name, npc: p.isNPC,
      x: r1(p.x), h: r1(p.h), f: p.face, st: p.stance, s: p.state, a: r1(p.anim),
      ch: p.charging ? Math.round((p.chargeT / C.CHARGE_MAX) * 100) / 100 : 0,
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
      case 'solo': { member.name = (msg.name || 'Player').slice(0, 12); room = createRoom(1); member.room = room; room.members.push(member); ws.send(JSON.stringify(lobbyState(room))); startMatch(room); break; }
      case 'create': { member.name = (msg.name || 'Player').slice(0, 12); room = createRoom(msg.perSide === 1 ? 1 : 2); member.room = room; room.members.push(member); ws.send(JSON.stringify(lobbyState(room))); break; }
      case 'mode': { if (room && !room.started && room.members[0] === member) { room.perSide = msg.perSide === 1 ? 1 : 2; broadcast(room, lobbyState(room)); } break; }
      case 'join': {
        const r = rooms.get((msg.code || '').toUpperCase());
        if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby not found' })); break; }
        if (r.started) { ws.send(JSON.stringify({ type: 'error', msg: 'Match already started' })); break; }
        if (r.members.length >= r.perSide * 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Lobby full' })); break; }
        member.name = (msg.name || 'Player').slice(0, 12); room = r; member.room = room; room.members.push(member); broadcast(room, lobbyState(room)); break;
      }
      case 'start': { if (room && !room.started && room.members[0] === member) startMatch(room); break; }
      case 'input': {
        if (!room || !room.game || !member.entId) break;
        const p = findP(room.game, member.entId); if (!p) break;
        const i = p.input;
        i.left = !!msg.left; i.right = !!msg.right; i.up = !!msg.up; i.down = !!msg.down; i.act = !!msg.act;
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

module.exports = { createRoom, createGame, stepGame, resetKickoff, doHit, spawn, findP, newPlayer, snapshot, C };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`⚽ Keepie Footy on http://localhost:${PORT}`));
}
