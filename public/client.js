'use strict';
/* global GAME */
const C = GAME;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), lobby: $('lobby'), game: $('game'), over: $('over') };
function show(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
}

const cv = $('cv');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
let ws = null;
let myEnt = null;
let snaps = [];           // interpolation buffer: {t(recv), data}
const RENDER_DELAY = 90;  // ms behind to interpolate smoothly
let latest = null;        // most recent snapshot data
let gameOverData = null;

function connect(then) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => then && then();
  ws.onclose = () => { $('menuErr').textContent = 'Disconnected.'; };
  ws.onmessage = (ev) => handleMsg(JSON.parse(ev.data));
}

function sendRaw(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function handleMsg(m) {
  switch (m.type) {
    case 'lobby':
      myCode = m.code;
      renderLobby(m);
      show('lobby');
      break;
    case 'error':
      $('menuErr').textContent = m.msg;
      break;
    case 'start':
      myEnt = null; snaps = []; latest = null; gameOverData = null;
      show('game'); resize();
      break;
    case 'state':
      myEnt = m.youEnt;
      latest = m;
      snaps.push({ t: performance.now(), data: m });
      if (snaps.length > 12) snaps.shift();
      break;
    case 'gameover':
      gameOverData = m;
      showGameOver(m);
      break;
  }
}

// ---------------------------------------------------------------------------
// Menu / lobby wiring
// ---------------------------------------------------------------------------
let myCode = null;
const nameInput = $('nameInput');
nameInput.value = localStorage.getItem('pf_name') || '';
function myName() {
  const n = (nameInput.value || 'player').trim().slice(0, 12) || 'player';
  localStorage.setItem('pf_name', n);
  return n;
}

$('btnSolo').onclick = () => connect(() => sendRaw({ type: 'solo', name: myName() }));
$('btnCreate').onclick = () => connect(() => sendRaw({ type: 'create', name: myName() }));
$('btnJoin').onclick = () => {
  const code = ($('codeInput').value || '').toUpperCase().trim();
  if (code.length !== 4) { $('menuErr').textContent = 'Enter a 4-letter code'; return; }
  connect(() => sendRaw({ type: 'join', code, name: myName() }));
};
$('btnStart').onclick = () => sendRaw({ type: 'start' });
$('btnLeave').onclick = () => { if (ws) ws.close(); show('menu'); };
$('btnAgain').onclick = () => { if (ws) ws.close(); show('menu'); };

function renderLobby(m) {
  $('lobbyCode').textContent = m.code;
  const ul = $('playerList');
  ul.innerHTML = '';
  m.players.forEach((p, i) => {
    const li = document.createElement('li');
    const team = i % 2 === 0 ? 'YELLOW' : 'BLUE';
    li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="tagteam">${team}</span>`;
    ul.appendChild(li);
  });
  for (let i = m.players.length; i < 3; i++) {
    const li = document.createElement('li');
    li.style.opacity = .45;
    li.innerHTML = `<span>— open —</span><span class="tagteam">CPU fills</span>`;
    ul.appendChild(li);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showGameOver(m) {
  show('over');
  const [a, b] = m.score;
  $('overScore').textContent = `${a} - ${b}`;
  $('overTitle').textContent = a === b ? 'DRAW!' : (a > b ? 'YELLOW WINS' : 'BLUE WINS');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { up: false, down: false, left: false, right: false, primary: false, special: false };
let lastSent = '';
function pushInput() {
  const s = JSON.stringify(input);
  if (s !== lastSent) { lastSent = s; sendRaw(Object.assign({ type: 'input' }, input)); }
}

const keyMap = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'primary', ShiftLeft: 'special', ShiftRight: 'special',
};
window.addEventListener('keydown', (e) => {
  const k = keyMap[e.code];
  if (!k) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!input[k]) { input[k] = true; pushInput(); }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (!k) return;
  if (input[k]) { input[k] = false; pushInput(); }
});

// touch controls
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) setupTouch();
function setupTouch() {
  $('touch').classList.remove('hidden');
  const stick = $('stick'), nub = $('nub');
  let sid = null, cx = 0, cy = 0;
  function setDir(dx, dy) {
    const dead = 14;
    input.up = dy < -dead; input.down = dy > dead;
    input.left = dx < -dead; input.right = dx > dead;
    const mag = Math.min(40, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    nub.style.left = (35 + Math.cos(a) * mag) + 'px';
    nub.style.top = (35 + Math.sin(a) * mag) + 'px';
    pushInput();
  }
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; sid = t.identifier;
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    setDir(t.clientX - cx, t.clientY - cy); e.preventDefault();
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === sid) setDir(t.clientX - cx, t.clientY - cy);
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === sid) {
      sid = null; input.up = input.down = input.left = input.right = false;
      nub.style.left = '35px'; nub.style.top = '35px'; pushInput();
    }
  };
  stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
  const btn = (el, key) => {
    el.addEventListener('touchstart', (e) => { input[key] = true; pushInput(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { input[key] = false; pushInput(); e.preventDefault(); }, { passive: false });
  };
  btn($('btnA'), 'primary'); btn($('btnB'), 'special');
}

function resize() {
  // canvas keeps internal 960x600; CSS scales it. nothing needed but kept for hooks.
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function interpState() {
  if (snaps.length === 0) return latest;
  const renderT = performance.now() - RENDER_DELAY;
  // find two snaps around renderT
  let older = snaps[0], newer = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].t <= renderT && snaps[i + 1].t >= renderT) { older = snaps[i]; newer = snaps[i + 1]; break; }
  }
  const span = newer.t - older.t;
  const t = span > 0 ? Math.max(0, Math.min(1, (renderT - older.t) / span)) : 1;
  const A = older.data, B = newer.data;
  // build interpolated view based on B's roster
  const byIdA = {};
  A.players.forEach((p) => (byIdA[p.id] = p));
  const players = B.players.map((pb) => {
    const pa = byIdA[pb.id] || pb;
    return {
      id: pb.id, team: pb.team, name: pb.name, npc: pb.npc, s: pb.s, a: pb.a,
      x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), z: lerp(pa.z, pb.z, t),
      f: lerpAngle(pa.f, pb.f, t),
    };
  });
  const ball = {
    x: lerp(A.ball.x, B.ball.x, t), y: lerp(A.ball.y, B.ball.y, t), z: lerp(A.ball.z, B.ball.z, t),
    owner: B.ball.owner, juggling: B.ball.juggling,
  };
  return { players, ball, clock: B.clock, score: B.score, flash: B.flash, kickoff: B.kickoff };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const COL = {
  grass1: '#0e3a1e', grass2: '#0c331b', line: 'rgba(220,255,230,.55)',
  teamA: '#ffd23f', teamAd: '#b8870a', teamB: '#3fa9ff', teamBd: '#1c6fb0',
  skin: '#f0b890', shadow: 'rgba(0,0,0,.30)',
};

function drawField() {
  const W = C.FIELD_W, H = C.FIELD_H, B = C.BLOCK;
  for (let y = 0; y < H; y += B) {
    for (let x = 0; x < W; x += B) {
      ctx.fillStyle = ((x / B + y / B) & 1) ? COL.grass1 : COL.grass2;
      ctx.fillRect(x, y, B, B);
    }
  }
  ctx.strokeStyle = COL.line; ctx.lineWidth = 3;
  ctx.strokeRect(C.WALL, C.WALL, W - C.WALL * 2, H - C.WALL * 2);
  // halfway line
  ctx.beginPath(); ctx.moveTo(W / 2, C.WALL); ctx.lineTo(W / 2, H - C.WALL); ctx.stroke();
  // center circle
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 66, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = COL.line; ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();
  // penalty boxes
  const boxH = C.GOAL_H + 90, boxW = 90;
  ctx.strokeRect(C.WALL, (H - boxH) / 2, boxW, boxH);
  ctx.strokeRect(W - C.WALL - boxW, (H - boxH) / 2, boxW, boxH);
  // goals
  drawGoal(0);
  drawGoal(1);
}

function drawGoal(side) {
  const W = C.FIELD_W;
  const x = side === 0 ? C.WALL : W - C.WALL;
  const depth = side === 0 ? -16 : 16;
  ctx.save();
  ctx.strokeStyle = '#eafff0'; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, C.GOAL_TOP); ctx.lineTo(x + depth, C.GOAL_TOP);
  ctx.lineTo(x + depth, C.GOAL_BOT); ctx.lineTo(x, C.GOAL_BOT);
  ctx.stroke();
  // net hatch
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  for (let yy = C.GOAL_TOP; yy <= C.GOAL_BOT; yy += 9) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + depth, yy); ctx.stroke();
  }
  ctx.restore();
}

// the little pixel guy
function drawPlayer(p, isMe) {
  const dark = p.team === 0 ? COL.teamAd : COL.teamBd;
  const main = p.team === 0 ? COL.teamA : COL.teamB;
  const sx = p.x, gy = p.y;          // ground position
  const sy = gy - p.z;               // sprite lifted by jump height

  // shadow (shrinks with height)
  const sh = Math.max(0.35, 1 - p.z / 220);
  ctx.fillStyle = COL.shadow;
  ctx.beginPath();
  ctx.ellipse(sx, gy + 11, 13 * sh, 5 * sh, 0, 0, Math.PI * 2);
  ctx.fill();

  const faceLeft = Math.cos(p.f) < 0;
  const phase = p.a * 9;
  ctx.save();
  ctx.translate(sx, sy);
  if (faceLeft) ctx.scale(-1, 1);

  if (p.s === C.S_DOWN) {
    // lying down, dizzy
    ctx.rotate(Math.PI / 2);
  } else if (p.s === C.S_SLIDE) {
    ctx.rotate(0.9);
  } else if (p.s === C.S_BICYCLE) {
    ctx.rotate(-phase % (Math.PI * 2));
  }

  // legs
  let swing = 0;
  if (p.s === C.S_RUN) swing = Math.sin(phase) * 5;
  else if (p.s === C.S_JUGGLE) swing = Math.abs(Math.sin(phase)) * 7;
  else if (p.s === C.S_IDLE) swing = Math.sin(p.a * 2) * 1;
  px(dark, -5 + swing * 0.2, 4, 4, 9);   // left leg
  px(dark, 1 - swing * 0.2, 4, 4, 9);    // right leg
  // a kicking leg for juggle/shoot
  if (p.s === C.S_JUGGLE || p.s === C.S_SHOOT || p.s === C.S_BICYCLE) {
    px(dark, 3, 2 - swing, 4, 9);
  }

  // body
  px(main, -6, -8, 12, 13);
  // arms
  const arm = p.s === C.S_RUN ? Math.sin(phase + Math.PI) * 4 : (p.s === C.S_BICYCLE ? 6 : 1);
  px(main, -8, -6 + arm * 0.3, 3, 8);
  px(main, 5, -6 - arm * 0.3, 3, 8);
  // head
  px(COL.skin, -4, -17, 8, 8);
  // hair/cap accent
  px(dark, -4, -17, 8, 3);

  ctx.restore();

  // name tag for humans
  if (!p.npc) {
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,.7)';
    ctx.font = 'bold 11px "Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, sx, sy - 26);
    if (isMe) { ctx.fillStyle = main; ctx.fillText('▼', sx, sy - 36); }
  }
}
function px(color, x, y, w, h) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

function drawBall(b, time) {
  const sh = Math.max(0.4, 1 - b.z / 240);
  ctx.fillStyle = COL.shadow;
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 7 * sh, 3 * sh, 0, 0, Math.PI * 2); ctx.fill();
  const sy = b.y - b.z;
  // ball
  ctx.fillStyle = '#fbfbfb';
  ctx.beginPath(); ctx.arc(b.x, sy, C.B_RADIUS, 0, Math.PI * 2); ctx.fill();
  // spin spots
  ctx.fillStyle = '#222';
  const spin = (b.x + b.y) * 0.05;
  for (let i = 0; i < 3; i++) {
    const a = spin + i * 2.1;
    ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * 3, sy + Math.sin(a) * 3, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(b.x, sy, C.B_RADIUS, 0, Math.PI * 2); ctx.stroke();
}

function fmtClock(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

function drawHUD(view) {
  const W = C.FIELD_W;
  // scoreboard panel
  ctx.fillStyle = 'rgba(6,16,10,.85)';
  ctx.fillRect(W / 2 - 110, 8, 220, 42);
  ctx.strokeStyle = '#1f5e3a'; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - 110, 8, 220, 42);
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px "Courier New",monospace';
  ctx.fillStyle = COL.teamA; ctx.fillText(view.score[0], W / 2 - 70, 38);
  ctx.fillStyle = COL.teamB; ctx.fillText(view.score[1], W / 2 + 70, 38);
  ctx.fillStyle = '#eafff0'; ctx.font = 'bold 20px "Courier New",monospace';
  ctx.fillText(fmtClock(view.clock), W / 2, 36);

  if (view.flash) {
    ctx.fillStyle = COL.teamA;
    ctx.font = 'bold 64px "Courier New",monospace';
    ctx.fillText(view.flash, W / 2, C.FIELD_H / 2 - 30);
  }
  if (view.kickoff && !view.flash) {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = 'bold 30px "Courier New",monospace';
    ctx.fillText('GET READY', W / 2, C.FIELD_H / 2 - 30);
  }
}

function render(time) {
  requestAnimationFrame(render);
  if (screens.game.classList.contains('hidden')) return;
  const view = interpState();
  if (!view) return;

  drawField();

  // draw entities sorted by ground-y for fake depth
  const ents = view.players.map((p) => ({ kind: 'p', y: p.y, p }));
  ents.push({ kind: 'b', y: view.ball.y, b: view.ball });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) {
    if (e.kind === 'p') drawPlayer(e.p, e.p.id === myEnt);
    else drawBall(e.b, time);
  }

  drawHUD(view);
}
requestAnimationFrame(render);

show('menu');
