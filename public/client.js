'use strict';
/* global GAME */
const C = GAME;
const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), lobby: $('lobby'), game: $('game'), over: $('over') };
const show = (n) => { for (const k in screens) screens[k].classList.toggle('hidden', k !== n); if (n === 'game') resize(); };

const cv = $('cv'); const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------------------
// networking
// ---------------------------------------------------------------------------
let ws = null, myEnt = null, snaps = [], latest = null;
const RENDER_DELAY = 90;
let createdMode = 2;
function connect(then) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => then && then();
  ws.onclose = () => { $('menuErr').textContent = 'Disconnected.'; };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
function handle(m) {
  switch (m.type) {
    case 'lobby': renderLobby(m); show('lobby'); break;
    case 'error': $('menuErr').textContent = m.msg; break;
    case 'start': myEnt = null; snaps = []; latest = null; show('game'); break;
    case 'state': myEnt = m.youEnt; latest = m; snaps.push({ t: performance.now(), d: m }); if (snaps.length > 12) snaps.shift(); break;
    case 'gameover': showOver(m); break;
  }
}

// ---------------------------------------------------------------------------
// menu / lobby
// ---------------------------------------------------------------------------
const nameInput = $('nameInput');
nameInput.value = localStorage.getItem('pf_name') || '';
const myName = () => { const n = (nameInput.value || 'player').trim().slice(0, 12) || 'player'; localStorage.setItem('pf_name', n); return n; };
$('btnSolo').onclick = () => connect(() => send({ type: 'solo', name: myName() }));
$('btnCreate').onclick = () => connect(() => send({ type: 'create', name: myName(), perSide: createdMode }));
$('btnJoin').onclick = () => {
  const code = ($('codeInput').value || '').toUpperCase().trim();
  if (code.length !== 4) { $('menuErr').textContent = 'Enter a 4-letter code'; return; }
  connect(() => send({ type: 'join', code, name: myName() }));
};
$('btnStart').onclick = () => send({ type: 'start' });
$('btnLeave').onclick = () => { if (ws) ws.close(); show('menu'); };
$('btnAgain').onclick = () => { if (ws) ws.close(); show('menu'); };
$('mode1').onclick = () => send({ type: 'mode', perSide: 1 });
$('mode2').onclick = () => send({ type: 'mode', perSide: 2 });
function renderLobby(m) {
  $('lobbyCode').textContent = m.code; $('lobbyMode').textContent = `${m.perSide}v${m.perSide}`;
  $('mode1').classList.toggle('on', m.perSide === 1); $('mode2').classList.toggle('on', m.perSide === 2);
  const ul = $('playerList'); ul.innerHTML = '';
  m.players.forEach((p, i) => { const li = document.createElement('li'); li.innerHTML = `<span>${esc(p.name)}</span><span class="tagteam">${i % 2 === 0 ? 'YELLOW' : 'BLUE'}</span>`; ul.appendChild(li); });
  for (let i = m.players.length; i < m.perSide * 2; i++) { const li = document.createElement('li'); li.style.opacity = .45; li.innerHTML = `<span>— open —</span><span class="tagteam">CPU</span>`; ul.appendChild(li); }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showOver(m) { show('over'); $('overTitle').textContent = (m.winner === 0 ? 'YELLOW WINS' : 'BLUE WINS'); $('overScore').textContent = `${m.score[0]} - ${m.score[1]}`; }

// ---------------------------------------------------------------------------
// input  (A/D move · W/↑ stance up · S/↓ stance down · Space = juggle hit, hold to charge)
// ---------------------------------------------------------------------------
const input = { left: false, right: false, up: false, down: false, act: false };
let lastSent = '';
function pushInput() { const s = JSON.stringify(input); if (s !== lastSent) { lastSent = s; send(Object.assign({ type: 'input' }, input)); } }
const keyMap = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', Space: 'act',
};
addEventListener('keydown', (e) => {
  const k = keyMap[e.code]; if (!k) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!input[k]) { input[k] = true; pushInput(); }
});
addEventListener('keyup', (e) => { const k = keyMap[e.code]; if (!k) return; if (input[k]) { input[k] = false; pushInput(); } });

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) setupTouch();
function setupTouch() {
  $('touch').classList.remove('hidden'); const kb = $('keys'); if (kb) kb.classList.add('hidden');
  const bind = (id, key) => { const el = $(id); if (!el) return;
    el.addEventListener('touchstart', (e) => { input[key] = true; pushInput(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { input[key] = false; pushInput(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchcancel', () => { input[key] = false; pushInput(); }, { passive: false });
  };
  bind('tLeft', 'left'); bind('tRight', 'right'); bind('tUp', 'up'); bind('tDown', 'down'); bind('tAct', 'act');
}

// ---------------------------------------------------------------------------
// interpolation
// ---------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
function view() {
  if (!snaps.length) return latest;
  const rt = performance.now() - RENDER_DELAY;
  let o = snaps[0], n = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= rt && snaps[i + 1].t >= rt) { o = snaps[i]; n = snaps[i + 1]; break; }
  const span = n.t - o.t, t = span > 0 ? Math.max(0, Math.min(1, (rt - o.t) / span)) : 1;
  const A = o.d, B = n.d, byA = {}; A.players.forEach((p) => byA[p.id] = p);
  const players = B.players.map((pb) => { const pa = byA[pb.id] || pb;
    return { id: pb.id, team: pb.team, name: pb.name, npc: pb.npc, f: pb.f, st: pb.st, s: pb.s, a: pb.a, ch: pb.ch,
      x: lerp(pa.x, pb.x, t), h: lerp(pa.h, pb.h, t) }; });
  const ball = { x: lerp(A.ball.x, B.ball.x, t), h: lerp(A.ball.h, B.ball.h, t), touch: B.ball.touch };
  return { players, ball, score: B.score, flash: B.flash, kickoff: B.kickoff, target: B.target };
}

// ---------------------------------------------------------------------------
// camera + transform
// ---------------------------------------------------------------------------
const TEAM = [{ shirt: '#ffd23f', dark: '#9a6e08', short: '#3a2c00' }, { shirt: '#46a8ff', dark: '#1d6fbf', short: '#06294a' }];
const SKIN = '#f0bd92';
let camX = C.WORLD_W / 2, Z = 2, groundY = 400, cw = 960, ch = 540;
function resize() {
  cw = cv.width = Math.max(480, Math.floor(cv.clientWidth || window.innerWidth));
  ch = cv.height = Math.max(320, Math.floor(cv.clientHeight || window.innerHeight));
  Z = ch / C.VISIBLE_WORLD_H;
  if (cw / Z < C.MIN_VISIBLE_W) Z = cw / C.MIN_VISIBLE_W;
  groundY = ch * C.GROUND_FRAC; ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize);
const WX = (x) => (x - camX) * Z + cw / 2;
const WY = (h) => groundY - h * Z;
const visW = () => cw / Z;

function draw() {
  requestAnimationFrame(draw);
  if (screens.game.classList.contains('hidden')) return;
  const v = view(); if (!v) return;
  const half = visW() / 2;
  camX += (Math.max(half, Math.min(C.WORLD_W - half, v.ball.x)) - camX) * 0.12;

  drawBackground(); drawPitch(); drawGoal(0); drawGoal(C.WORLD_W);
  for (const p of v.players) drawPlayer(p, p.id === myEnt);
  drawBall(v.ball);
  for (const p of v.players) drawLabel(p, p.id === myEnt);
  drawHUD(v);
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, groundY);
  g.addColorStop(0, '#101f33'); g.addColorStop(1, '#284862');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  for (let i = 0; i < 50; i++) { const x = ((i * 167 - camX * 0.15) % cw + cw) % cw; ctx.fillRect(x, 18 + (i * 47) % (groundY * 0.5), 2, 2); }
  const standH = Math.max(80, groundY * 0.32), py = groundY - standH;
  ctx.fillStyle = '#0d1c2c'; ctx.fillRect(0, py, cw, standH);
  const off = -(camX * 0.35) % 70;
  const crowd = ['#1d3b56', '#34597e', '#7a4a4a', '#4a6f4a'];
  for (let x = off - 70; x < cw; x += 70) {
    ctx.fillStyle = '#15293c'; ctx.fillRect(x, py, 62, standH * 0.55);
    for (let cx = x + 4; cx < x + 60; cx += 10) for (let cy = py + 8; cy < py + standH * 0.46; cy += 10) {
      ctx.fillStyle = crowd[(((cx * 7 + cy * 13) | 0) % crowd.length + crowd.length) % crowd.length]; ctx.fillRect(cx, cy, 4, 4);
    }
  }
}
function drawPitch() {
  ctx.fillStyle = '#0e3a1e'; ctx.fillRect(0, groundY, cw, ch - groundY);
  for (let wx = 0; wx < C.WORLD_W; wx += 90) { const x = WX(wx), w = 90 * Z; if (x + w < 0 || x > cw) continue; ctx.fillStyle = ((wx / 90) | 0) % 2 ? '#0d3a1d' : '#0b3319'; ctx.fillRect(x, groundY, w + 1, ch - groundY); }
  ctx.fillStyle = '#1f7a3e'; ctx.fillRect(0, groundY - 2, cw, 3);
  const hx = WX(C.WORLD_W / 2); ctx.strokeStyle = 'rgba(220,255,230,.32)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(hx, groundY); ctx.lineTo(hx, groundY - 60 * Z); ctx.stroke();
}
function drawGoal(worldX) {
  const x = WX(worldX), top = WY(C.CROSSBAR_H), dir = worldX === 0 ? 1 : -1, depth = C.GOAL_DEPTH * Z;
  ctx.strokeStyle = '#eafff0'; ctx.lineWidth = Math.max(3, 2 * Z);
  ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, top); ctx.lineTo(x + dir * depth, top); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
  for (let yy = top; yy < groundY; yy += 11) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + dir * depth, yy + 5); ctx.stroke(); }
  for (let k = 0; k <= depth; k += 11) { ctx.beginPath(); ctx.moveTo(x + dir * k, top); ctx.lineTo(x + dir * k, groundY); ctx.stroke(); }
}

// ---- simple chunky pixel guy ----
function R(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function drawPlayer(p, isMe) {
  const col = TEAM[p.team];
  const X = WX(p.x), Y = WY(p.h);
  const ssc = Math.max(0.4, 1 - p.h / 160);
  ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(X, groundY + 2 * Z, 14 * Z * ssc, 4 * Z * ssc, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save(); ctx.translate(X, Y); ctx.scale((p.f || 1) * Z, Z); // local = world units, forward = +x, up = -y
  const ph = p.a * 9, sw = Math.sin(ph) * 4;
  // default legs
  let lfx = -5 + sw, lbx = 1 - sw, lLen = 22, frontLeg = null; // frontLeg overrides front leg pose [x,y,w,h]
  let bob = 0, headTilt = 0, armF = 5;
  switch (p.s) {
    case C.S_RUN: bob = Math.abs(Math.sin(ph)) * 2; break;
    case C.S_IDLE: lfx = -5; lbx = 1; bob = Math.sin(p.a * 2) * 0.8; armF = 1; break;
    case C.S_KICK: frontLeg = [6, -8, 5, 16]; headTilt = 1; armF = -4; break;      // foot kicks up-forward
    case C.S_KNEE: frontLeg = [3, -20, 6, 12]; headTilt = 1; armF = 7; break;       // knee raised
    case C.S_HEAD: headTilt = -3; armF = 8; bob = 1; break;                          // heading (hop via p.h)
    case C.S_WHIFF: frontLeg = [7, -2, 5, 20]; armF = -3; break;
    case C.S_AIR: lfx = -3; lbx = 3; lLen = 16; armF = 8; break;
  }
  ctx.translate(0, -bob);
  // back leg
  R(col.short, lbx, -22, 5, 11); R(col.dark, lbx, -11, 5, 11);
  // torso
  R(col.shirt, -7, -44, 14, 22);
  R(col.short, -7, -26, 14, 5); // shorts band
  // back arm
  R(SKIN, -9, -42, 4, 12);
  // front leg (over torso)
  if (frontLeg) { R(col.short, frontLeg[0], frontLeg[1], frontLeg[2], frontLeg[3] * 0.5); R(col.dark, frontLeg[0], frontLeg[1] + frontLeg[3] * 0.5, frontLeg[2], frontLeg[3] * 0.5); }
  else { R(col.short, lfx, -22, 5, 11); R(col.dark, lfx, -11, 5, 11); }
  // front arm
  R(SKIN, 5, -42 + Math.max(0, -armF) * 0.3, 4, 12);
  // head
  R(SKIN, -6, -57 - headTilt, 12, 13);
  R(col.dark, -6, -57 - headTilt, 12, 4); // hair
  R('#1a2530', 3, -52 - headTilt, 2, 2);  // eye (forward)
  ctx.restore();

  // charge ring while winding up
  if (p.ch > 0.02) {
    const w = 26, x0 = X - w / 2, y0 = Y - 64 * Z;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, 6);
    ctx.fillStyle = p.ch > 0.85 ? '#ff7a7a' : '#ffd23f'; ctx.fillRect(x0, y0, w * p.ch, 4);
  }
}

const STANCE_NAME = ['FEET', 'KNEE', 'HEAD'];
const STANCE_COL = ['#7CFFB2', '#ffd23f', '#ff7a7a'];
function drawLabel(p, isMe) {
  const X = WX(p.x), topY = WY(p.h) - 60 * Z;
  ctx.textAlign = 'center';
  if (!p.npc) { ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,.75)'; ctx.font = 'bold 13px "Courier New",monospace'; ctx.fillText(p.name, X, topY); }
  if (isMe) { ctx.fillStyle = STANCE_COL[p.st]; ctx.font = 'bold 12px "Courier New",monospace'; ctx.fillText('▾ ' + STANCE_NAME[p.st], X, topY - 15); }
}
function drawBall(b) {
  const X = WX(b.x), cy = WY(b.h + C.B_RADIUS), r = C.B_RADIUS * Z;
  const ssc = Math.max(0.35, 1 - b.h / 180);
  ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(X, groundY + 2 * Z, 8 * Z * ssc, 3 * Z * ssc, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbfbfb'; ctx.beginPath(); ctx.arc(X, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222'; const spin = b.x * 0.06;
  for (let i = 0; i < 3; i++) { const a = spin + i * 2.1; ctx.beginPath(); ctx.arc(X + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X, cy, r, 0, Math.PI * 2); ctx.stroke();
}
function drawHUD(v) {
  const w = 240, x0 = cw / 2 - w / 2;
  ctx.fillStyle = 'rgba(6,16,10,.85)'; ctx.fillRect(x0, 10, w, 48);
  ctx.strokeStyle = '#1f5e3a'; ctx.lineWidth = 2; ctx.strokeRect(x0, 10, w, 48);
  ctx.textAlign = 'center'; ctx.font = 'bold 32px "Courier New",monospace';
  ctx.fillStyle = TEAM[0].shirt; ctx.fillText(v.score[0], cw / 2 - 80, 46);
  ctx.fillStyle = TEAM[1].shirt; ctx.fillText(v.score[1], cw / 2 + 80, 46);
  ctx.fillStyle = '#9fb'; ctx.font = '11px "Courier New",monospace'; ctx.fillText(`FIRST TO ${v.target}`, cw / 2, 32);

  const me = v.players.find((p) => p.id === myEnt);
  if (me) {
    const bx = 18, bh = 30, by = ch - 18 - bh * 3 - 22;
    ctx.fillStyle = 'rgba(6,16,10,.72)'; ctx.fillRect(bx - 8, by - 24, 150, bh * 3 + 32);
    ctx.textAlign = 'left'; ctx.fillStyle = '#cfe'; ctx.font = 'bold 12px "Courier New",monospace'; ctx.fillText('STANCE  W / S', bx, by - 8);
    for (let i = 2; i >= 0; i--) { const yy = by + (2 - i) * bh, on = me.st === i;
      ctx.fillStyle = on ? STANCE_COL[i] : '#23402c'; ctx.fillRect(bx, yy, 22, bh - 6);
      ctx.fillStyle = on ? '#fff' : '#5f7d68'; ctx.font = (on ? 'bold ' : '') + '14px "Courier New",monospace'; ctx.fillText(STANCE_NAME[i], bx + 32, yy + bh - 12); }
  }
  if (v.flash) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 64px "Courier New",monospace'; ctx.fillText(v.flash, cw / 2, ch / 2 - 20); }
  else if (v.kickoff) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 26px "Courier New",monospace'; ctx.fillText('GET READY', cw / 2, ch / 2 - 20); }
}

resize(); requestAnimationFrame(draw); show('menu');
