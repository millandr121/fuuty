'use strict';
/* global GAME */
const C = GAME;
const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), lobby: $('lobby'), game: $('game'), over: $('over') };
const show = (n) => { for (const k in screens) screens[k].classList.toggle('hidden', k !== n); };

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
$('mode1').onclick = () => setMode(1);
$('mode2').onclick = () => setMode(2);
function setMode(m) { send({ type: 'mode', perSide: m }); }

function renderLobby(m) {
  $('lobbyCode').textContent = m.code;
  $('lobbyMode').textContent = `${m.perSide}v${m.perSide}`;
  $('mode1').classList.toggle('on', m.perSide === 1);
  $('mode2').classList.toggle('on', m.perSide === 2);
  const ul = $('playerList'); ul.innerHTML = '';
  m.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(p.name)}</span><span class="tagteam">${i % 2 === 0 ? 'YELLOW' : 'BLUE'}</span>`;
    ul.appendChild(li);
  });
  for (let i = m.players.length; i < m.perSide * 2; i++) {
    const li = document.createElement('li'); li.style.opacity = .45;
    li.innerHTML = `<span>— open —</span><span class="tagteam">CPU</span>`; ul.appendChild(li);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showOver(m) { show('over'); $('overTitle').textContent = (m.winner === 0 ? 'YELLOW WINS' : 'BLUE WINS'); $('overScore').textContent = `${m.score[0]} - ${m.score[1]}`; }

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
const input = { left: false, right: false, jump: false, up: false, down: false, act: false, bike: false };
let lastSent = '';
function pushInput() { const s = JSON.stringify(input); if (s !== lastSent) { lastSent = s; send(Object.assign({ type: 'input' }, input)); } }
const keyMap = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', KeyJ: 'jump',
  ArrowUp: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'act', ShiftLeft: 'bike', ShiftRight: 'bike',
};
addEventListener('keydown', (e) => {
  const k = keyMap[e.code]; if (!k) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!input[k]) { input[k] = true; pushInput(); }
});
addEventListener('keyup', (e) => { const k = keyMap[e.code]; if (!k) return; if (input[k]) { input[k] = false; pushInput(); } });

// touch
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) setupTouch();
function setupTouch() {
  $('touch').classList.remove('hidden');
  const bind = (id, key) => { const el = $(id); if (!el) return;
    el.addEventListener('touchstart', (e) => { input[key] = true; pushInput(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { input[key] = false; pushInput(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchcancel', (e) => { input[key] = false; pushInput(); }, { passive: false });
  };
  bind('tLeft', 'left'); bind('tRight', 'right'); bind('tJump', 'jump');
  bind('tUp', 'up'); bind('tDown', 'down'); bind('tAct', 'act'); bind('tBike', 'bike');
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
    return { id: pb.id, team: pb.team, name: pb.name, npc: pb.npc, f: pb.f, st: pb.st, s: pb.s, a: pb.a,
      x: lerp(pa.x, pb.x, t), h: lerp(pa.h, pb.h, t) }; });
  const ball = { x: lerp(A.ball.x, B.ball.x, t), h: lerp(A.ball.h, B.ball.h, t), owner: B.ball.owner, stance: B.ball.stance };
  return { players, ball, score: B.score, flash: B.flash, kickoff: B.kickoff, target: B.target };
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
const GROUND = C.GROUND_PX;
const TEAM = [{ shirt: '#ffd23f', dark: '#b8860b', short: '#3a2c00' }, { shirt: '#46a8ff', dark: '#1d6fbf', short: '#06294a' }];
const SKIN = '#f0bd92';
let camX = C.WORLD_W / 2;

function draw(time) {
  requestAnimationFrame(draw);
  if (screens.game.classList.contains('hidden')) return;
  const v = view(); if (!v) return;

  // camera follows the ball (priority)
  const targetCam = Math.max(C.VIEW_W / 2, Math.min(C.WORLD_W - C.VIEW_W / 2, v.ball.x));
  camX += (targetCam - camX) * 0.12;

  drawBackground();
  drawPitch();
  drawGoal(0); drawGoal(C.WORLD_W);

  // players, then the ball on top
  for (const p of v.players) drawPlayer(p, p.id === myEnt, time);
  drawBall(v.ball, time);

  drawHUD(v);
}

const sx = (x) => Math.round(x - camX + C.VIEW_W / 2);

function drawBackground() {
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#13243b'); g.addColorStop(1, '#26415f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
  // parallax stars/lights
  ctx.fillStyle = 'rgba(255,255,255,.15)';
  for (let i = 0; i < 40; i++) {
    const wx = (i * 137.5) % C.WORLD_W;
    const px = sx(wx) * 0.6 + 200;
    const x = ((px % C.VIEW_W) + C.VIEW_W) % C.VIEW_W;
    ctx.fillRect(x, 30 + (i * 53) % 160, 2, 2);
  }
  // distant crowd stand (parallax)
  const py = GROUND - 150;
  ctx.fillStyle = '#0e2030';
  const off = -(camX * 0.4) % 64;
  ctx.fillRect(0, py, C.VIEW_W, 150);
  ctx.fillStyle = '#152c42';
  for (let x = off - 64; x < C.VIEW_W; x += 64) { ctx.fillRect(x, py, 56, 60); }
  // crowd dots
  for (let x = off - 64; x < C.VIEW_W; x += 8) {
    ctx.fillStyle = (x | 0) % 16 === 0 ? '#33597e' : '#1d3b56';
    ctx.fillRect(x, py + 14 + ((x | 0) % 24), 4, 4);
  }
}

function drawPitch() {
  ctx.fillStyle = '#0e3a1e'; ctx.fillRect(0, GROUND, C.VIEW_W, C.VIEW_H - GROUND);
  // mowed stripes scrolling with camera
  for (let wx = 0; wx < C.WORLD_W; wx += 80) {
    const x = sx(wx);
    if (x < -80 || x > C.VIEW_W) continue;
    ctx.fillStyle = ((wx / 80) | 0) % 2 ? '#0d3a1d' : '#0b3319';
    ctx.fillRect(x, GROUND, 80, C.VIEW_H - GROUND);
  }
  // surface line
  ctx.fillStyle = '#1f7a3e'; ctx.fillRect(0, GROUND - 2, C.VIEW_W, 3);
  // halfway line
  const hx = sx(C.WORLD_W / 2);
  ctx.strokeStyle = 'rgba(220,255,230,.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(hx, GROUND); ctx.lineTo(hx, GROUND - 60); ctx.stroke();
}

function drawGoal(worldX) {
  const x = sx(worldX);
  const top = GROUND - C.CROSSBAR_H;
  const dir = worldX === 0 ? 1 : -1;
  ctx.strokeStyle = '#eafff0'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, top); ctx.lineTo(x + dir * C.GOAL_DEPTH, top); ctx.stroke();
  // net
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
  for (let yy = top; yy < GROUND; yy += 10) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + dir * C.GOAL_DEPTH, yy + 4); ctx.stroke(); }
  for (let k = 0; k <= C.GOAL_DEPTH; k += 8) { ctx.beginPath(); ctx.moveTo(x + dir * k, top); ctx.lineTo(x + dir * k, GROUND); ctx.stroke(); }
}

// ---- the little pixel guy (side view) ----
function R(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function drawPlayer(p, isMe, time) {
  const col = TEAM[p.team];
  const px = sx(p.x), feetY = GROUND - p.h;
  // shadow
  const ssc = Math.max(0.4, 1 - p.h / 200);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(px, GROUND + 3, 14 * ssc, 4 * ssc, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(px, feetY);
  ctx.scale(p.f || 1, 1); // face: +1 right, -1 left  (forward = +x in local space)
  const ph = p.a * 11;
  const swing = Math.sin(ph) * 7;

  // pose deltas
  let lean = 0, kneeUp = 0, headLift = 0, legA = swing, legB = -swing, torsoY = 0, rot = 0, armSwing = Math.sin(ph + Math.PI) * 6;
  switch (p.s) {
    case C.S_RUN: case C.S_DRIBBLE: lean = 4; break;
    case C.S_IDLE: legA = legB = 0; torsoY = Math.sin(p.a * 2) * 1; armSwing = Math.sin(p.a * 2) * 1; break;
    case C.S_KNEE: kneeUp = 10 + Math.abs(Math.sin(ph)) * 6; legA = 0; legB = 0; armSwing = 5; break;
    case C.S_HEAD: headLift = 4; legA = legB = 2; armSwing = 8; lean = -3; break;
    case C.S_AIR: legA = -8; legB = -10; armSwing = 8; break;
    case C.S_SHOOT: legA = 16; legB = -4; lean = 6; armSwing = -6; break;
    case C.S_VOLLEY: kneeUp = 18; legB = -6; lean = 4; armSwing = 10; break;
    case C.S_HEADER: headLift = 8; legA = -4; legB = -6; armSwing = 12; lean = -6; break;
    case C.S_FLY: legA = 20; legB = 6; lean = 10; armSwing = -10; break;
    case C.S_SLIDE: rot = 1.05; legA = 18; legB = 8; break;
    case C.S_BLOCK: torsoY = 6; legA = legB = 0; armSwing = -4; break;
    case C.S_BIKE: rot = -ph % (Math.PI * 2); legA = 16; legB = -16; break;
    case C.S_DOWN: rot = 1.45; break;
  }
  if (rot) ctx.rotate(rot);
  ctx.translate(lean, 0);

  // legs (from hip y=-22 down to feet y=0); swing as horizontal offset of the foot
  R(col.short, -5 + legB * 0.2, -24, 5, 14);          // back leg upper
  R(col.dark, -5 + legB * 0.5, -12, 5, 12);           // back shin
  if (kneeUp) { R(col.short, 2, -24 - kneeUp * 0.4, 5, 12); R(col.dark, 4, -24 - kneeUp, 5, 10); } // raised knee
  else { R(col.short, 1 + legA * 0.2, -24, 5, 14); R(col.dark, 1 + legA * 0.5, -12, 5, 12); }

  // torso
  R(col.shirt, -6, -42 + torsoY, 12, 20);
  // arms
  R(SKIN, -8, -40 + torsoY + armSwing * 0.2, 3, 11);
  R(SKIN, 5, -40 + torsoY - armSwing * 0.2, 3, 11);
  // head
  R(SKIN, -4, -54 + torsoY - headLift, 9, 11);
  R(col.dark, -4, -54 + torsoY - headLift, 9, 3); // hair
  // eye (faces forward = +x)
  R('#15202b', 2, -50 + torsoY - headLift, 2, 2);
  // knocked-out stars
  if (p.s === C.S_DOWN) { R('#ffe27a', 2, -60, 3, 3); R('#ffe27a', 7, -56, 2, 2); }

  ctx.restore();

  // name + you-marker
  if (!p.npc) {
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,.7)';
    ctx.font = 'bold 11px "Courier New",monospace'; ctx.textAlign = 'center';
    ctx.fillText(p.name, px, feetY - 62);
  }
  if (isMe) { ctx.fillStyle = col.shirt; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('▼', px, feetY - 70); }
}

function drawBall(b, time) {
  const px = sx(b.x), cy = GROUND - b.h - C.B_RADIUS;
  const ssc = Math.max(0.4, 1 - b.h / 220);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(px, GROUND + 3, 8 * ssc, 3 * ssc, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbfbfb'; ctx.beginPath(); ctx.arc(px, cy, C.B_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222'; const spin = b.x * 0.06;
  for (let i = 0; i < 3; i++) { const a = spin + i * 2.1; ctx.beginPath(); ctx.arc(px + Math.cos(a) * 3, cy + Math.sin(a) * 3, 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, cy, C.B_RADIUS, 0, Math.PI * 2); ctx.stroke();
}

const STANCE_NAME = ['FEET', 'KNEE', 'HEAD'];
function drawHUD(v) {
  // scoreboard
  ctx.fillStyle = 'rgba(6,16,10,.85)'; ctx.fillRect(C.VIEW_W / 2 - 120, 10, 240, 46);
  ctx.strokeStyle = '#1f5e3a'; ctx.lineWidth = 2; ctx.strokeRect(C.VIEW_W / 2 - 120, 10, 240, 46);
  ctx.textAlign = 'center'; ctx.font = 'bold 30px "Courier New",monospace';
  ctx.fillStyle = TEAM[0].shirt; ctx.fillText(v.score[0], C.VIEW_W / 2 - 78, 44);
  ctx.fillStyle = TEAM[1].shirt; ctx.fillText(v.score[1], C.VIEW_W / 2 + 78, 44);
  ctx.fillStyle = '#9fb'; ctx.font = '11px "Courier New",monospace'; ctx.fillText(`FIRST TO ${v.target}`, C.VIEW_W / 2, 34);

  // my stance ladder
  const me = v.players.find((p) => p.id === myEnt);
  if (me) {
    const bx = 20, by = C.VIEW_H - 88;
    ctx.textAlign = 'left'; ctx.font = 'bold 11px "Courier New",monospace';
    ctx.fillStyle = 'rgba(6,16,10,.7)'; ctx.fillRect(bx - 8, by - 8, 92, 84);
    for (let i = 2; i >= 0; i--) {
      const yy = by + (2 - i) * 24;
      const on = me.st === i;
      ctx.fillStyle = on ? TEAM[me.team].shirt : '#27432f';
      ctx.fillRect(bx, yy, 16, 16);
      ctx.fillStyle = on ? '#fff' : '#5f7d68';
      ctx.fillText(STANCE_NAME[i], bx + 24, yy + 12);
    }
  }

  if (v.flash) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 60px "Courier New",monospace'; ctx.fillText(v.flash, C.VIEW_W / 2, C.VIEW_H / 2 - 20); }
  if (v.kickoff && !v.flash) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 26px "Courier New",monospace'; ctx.fillText('GET READY', C.VIEW_W / 2, C.VIEW_H / 2 - 20); }
}

requestAnimationFrame(draw);
show('menu');
