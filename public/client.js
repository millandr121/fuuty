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
const buildEl = $('build'); if (buildEl) buildEl.textContent = C.BUILD;
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

// ---- rounded little mascot ----
function ell(c, x, y, rx, ry) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function drawPlayer(p, isMe) {
  const col = TEAM[p.team];
  const X = WX(p.x), Y = WY(p.h);
  const ssc = Math.max(0.4, 1 - p.h / 140);
  ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.beginPath(); ctx.ellipse(X, groundY + 2 * Z, 15 * Z * ssc, 4.5 * Z * ssc, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save(); ctx.translate(X, Y); ctx.scale((p.f || 1) * Z, Z); // local = world units, forward = +x, up = -y
  const ph = p.a * 9, sw = Math.sin(ph) * 3.5;

  // pose: feet positions [backX, frontX, frontY], body bob/lean/tilt, squash
  let footB = -5, footF = 4, footFy = 0, bob = 0, lean = 0, tilt = 0, squash = 1, eyeUp = 0;
  switch (p.s) {
    case C.S_RUN: footB = -5 - sw; footF = 4 + sw; bob = Math.abs(Math.sin(ph)) * 2; lean = 2; break;
    case C.S_IDLE: { const s = Math.sin(p.a * 2.2); squash = 1 + s * 0.04; bob = Math.max(0, s) * 0.6; break; }
    case C.S_KICK: footF = 12; footFy = -8; lean = 3; squash = 1.04; break;       // foot kicks up-forward
    case C.S_KNEE: footF = 6; footFy = -24; lean = 1; eyeUp = -2; break;          // knee/foot raised to mid
    case C.S_HEAD: tilt = -0.16; eyeUp = -3; squash = 1.05; break;                // header (hop via p.h)
    case C.S_WHIFF: squash = 0.9; lean = -3; footF = 9; break;
    case C.S_AIR: footB = -3; footF = 3; footFy = -3; break;
  }
  if (p.ch > 0.02) { squash = 0.9 - p.ch * 0.06; bob = 0; }   // crouch/anticipate while charging

  ctx.translate(lean, -bob); ctx.rotate(tilt);
  ctx.scale(2 - squash, squash);   // squash & stretch around the feet

  // feet (little dark ovals)
  ell('#22303a', footB, -3, 4, 3);
  // body — one big rounded blob in team colour
  ell(col.dark, 0, -23, 13, 23);          // outline-ish darker base
  ell(col.shirt, 0, -24, 11.5, 21);       // body
  ell('rgba(255,255,255,.16)', -3, -30, 5, 8); // soft sheen
  // tiny stub arms
  ell(col.shirt, -11, -22, 3.5, 5); ell(col.shirt, 11, -22, 3.5, 5);
  // front foot (over body) — the one that juggles
  ell('#22303a', footF, -3 + footFy, 4, 3);
  // face: two eyes looking forward + a little smile
  ell('#fff', -3.5, -34 + eyeUp, 3, 3.6); ell('#fff', 4.5, -34 + eyeUp, 3, 3.6);
  ell('#1a2530', -2.5, -34 + eyeUp, 1.4, 1.8); ell('#1a2530', 5.5, -34 + eyeUp, 1.4, 1.8);
  ctx.strokeStyle = '#7a4a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(1, -27 + eyeUp, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();

  // charge bar while winding up
  if (p.ch > 0.02) {
    const w = 28, x0 = X - w / 2, y0 = Y - 66 * Z;
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
