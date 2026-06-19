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
$('btnPractice').onclick = () => connect(() => send({ type: 'practice', name: myName() }));
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
const keyMap = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', Space: 'act' };
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
const TEAM = [
  { shirt: '#ffd23f', dark: '#c79410', short: '#243', sock: '#fff0b0' },
  { shirt: '#46a8ff', dark: '#1f6fc0', short: '#163', sock: '#cfe6ff' },
];
const SKIN = '#e7b48a', SKIN_D = '#c9905f', HAIR = '#3a2a1c', OUT = '#15202b';
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

// ---------------------------------------------------------------------------
// pixel-art world
// ---------------------------------------------------------------------------
function rect(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, Math.ceil(w), Math.ceil(h)); }
function hash(n) { n = (n << 13) ^ n; return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff; }

function drawBackground() {
  // dusk sky in chunky bands
  const bands = ['#20243f', '#2c3358', '#3b4d72', '#5b6f8f', '#9a8aa0', '#d59a73'];
  const bh = groundY / bands.length;
  for (let i = 0; i < bands.length; i++) rect(bands[i], 0, i * bh, cw, bh + 1);
  // moon
  const mx = ((-camX * 0.05) % (cw + 200) + cw + 200) % (cw + 200) - 100;
  rect('#f3ead0', mx, groundY * 0.16, 22, 22); rect('#20243f', mx + 14, groundY * 0.14, 10, 10);
  // chunky clouds (parallax)
  for (let i = 0; i < 6; i++) {
    const cxp = ((i * 521 - camX * 0.12) % (cw + 260) + cw + 260) % (cw + 260) - 130;
    const cyp = 30 + (i * 37) % (groundY * 0.4), s = 6 + (i % 3) * 2;
    rect('#cfd6e4', cxp, cyp, s * 6, s); rect('#cfd6e4', cxp + s, cyp - s, s * 4, s); rect('#aeb8cc', cxp + s, cyp + s, s * 5, s);
  }
  // floodlights every ~700 world units
  for (let wx = 200; wx < C.WORLD_W; wx += 720) {
    const x = WX(wx); if (x < -40 || x > cw + 40) continue;
    const topY = groundY - 230 * Z, poleW = Math.max(3, 4 * Z * .5);
    rect('#2b3344', x - poleW / 2, topY, poleW, groundY - topY);
    rect('#cfd6e4', x - 16, topY - 14, 32, 16); rect('#fffbe0', x - 13, topY - 11, 26, 10);
    ctx.fillStyle = 'rgba(255,250,200,.10)'; ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x - 120, groundY); ctx.lineTo(x + 120, groundY); ctx.fill();
  }
  // tiered stand + pixel crowd
  const standH = Math.max(70, groundY * 0.3), py = groundY - standH;
  rect('#222a3a', 0, py, cw, standH);
  rect('#2b3447', 0, py, cw, standH * 0.5);
  const block = Math.max(4, Math.round(2.4 * Z));
  for (let sx = -((camX * 0.4) % (block * 2)); sx < cw; sx += block) {
    for (let sy = py + block; sy < groundY - block * 1.5; sy += block) {
      const r = hash((((sx + camX * 0.4) / block) | 0) * 131 + ((sy / block) | 0) * 977);
      if (r < 0.55) continue;
      const pal = ['#d65a5a', '#5ad68a', '#5a8ad6', '#e0c14a', '#c569d6', '#e9e9ef'];
      rect(pal[(r * 997 | 0) % pal.length], sx, sy, block - 1, block - 1);
    }
  }
  rect('#161d2a', 0, groundY - standH * 0.18, cw, standH * 0.18); // wall in front of stand
}

function drawPitch() {
  rect('#2f7d3a', 0, groundY, cw, ch - groundY);
  for (let wx = 0; wx < C.WORLD_W; wx += 64) {
    const x = WX(wx), w = 64 * Z; if (x + w < 0 || x > cw) continue;
    rect(((wx / 64) | 0) % 2 ? '#2f7d3a' : '#2a7234', x, groundY, w + 1, ch - groundY);
  }
  rect('#eafff0', 0, groundY - 3, cw, 3);                 // touchline
  // sparse grass texture
  const gb = Math.max(3, Math.round(2 * Z));
  for (let x = -((camX * Z) % (gb * 5)); x < cw; x += gb * 5)
    for (let y = groundY + gb * 2; y < ch; y += gb * 4) {
      if (hash(((x + camX * Z) | 0) * 31 + (y | 0) * 17) > 0.7) rect('#256a2e', x, y, gb, gb);
    }
  // penalty boxes
  for (const gx of [C.GOAL_L, C.GOAL_R]) { const dir = gx < C.WORLD_W / 2 ? 1 : -1; const bx = WX(gx + dir * 150);
    ctx.strokeStyle = 'rgba(234,255,240,.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, groundY); ctx.lineTo(bx, groundY - 70 * Z); ctx.stroke(); }
  const hx = WX(C.WORLD_W / 2);
  ctx.strokeStyle = 'rgba(234,255,240,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, groundY); ctx.lineTo(hx, groundY - 64 * Z); ctx.stroke();
}

function drawGoal(worldX) {
  const x = WX(worldX), top = WY(C.CROSSBAR_H), dir = worldX === 0 ? 1 : -1, depth = C.GOAL_DEPTH * Z, postW = Math.max(3, 2.4 * Z);
  rect('#16202b', x - postW / 2, top - 2, postW + 2, groundY - top + 2);   // post shadow
  rect('#f4fff8', x - postW / 2, top, postW, groundY - top);                // post
  rect('#f4fff8', x, top - postW, dir * depth, postW);                       // crossbar
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
  for (let yy = top; yy < groundY; yy += Math.max(6, 4 * Z)) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + dir * depth, yy + 4); ctx.stroke(); }
  for (let k = 0; Math.abs(k) <= depth; k += Math.max(6, 4 * Z)) { ctx.beginPath(); ctx.moveTo(x + dir * k, top); ctx.lineTo(x + dir * k, groundY); ctx.stroke(); }
}

// ---------------------------------------------------------------------------
// pixel-art player
// ---------------------------------------------------------------------------
// blk = a filled block with a 1u dark outline, for a chunky pixel-art read
function blk(c, x, y, w, h) { rect(OUT, x - 1, y - 1, w + 2, h + 2); rect(c, x, y, w, h); }
function drawPlayer(p, isMe) {
  const col = TEAM[p.team];
  const X = WX(p.x), Y = WY(p.h);
  // shadow
  const ssc = Math.max(0.4, 1 - p.h / 150);
  ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.beginPath(); ctx.ellipse(X, groundY + 2 * Z, 13 * Z * ssc, 4 * Z * ssc, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save(); ctx.translate(X, Y); ctx.scale((p.f || 1) * Z, Z); // local = world units, forward = +x, up = -y
  const ph = p.a * 9, sw = Math.sin(ph) * 3;

  // pose: front leg [hipX, kneeY, footX, footY], plus bob/lean/head
  let bob = 0, lean = 0, headDY = 0, armFY = 0, armBY = 0;
  let bLegX = -4 - sw, fLeg = [3 + sw, -10, 3 + sw, 0];   // [thighX, kneeY, footX, footY]
  switch (p.s) {
    case C.S_RUN: bob = Math.abs(Math.sin(ph)) * 1.6; lean = 2; armFY = sw * 2; armBY = -sw * 2; break;
    case C.S_IDLE: bLegX = -4; fLeg = [3, -10, 3, 0]; bob = Math.sin(p.a * 2) * 0.7; break;
    case C.S_KICK: fLeg = [5, -9, 12, -7]; lean = 3; armFY = -4; break;     // foot kicks forward-up
    case C.S_KNEE: fLeg = [4, -22, 5, -16]; lean = 1; armFY = 3; headDY = -1; break; // knee up to the ball
    case C.S_HEAD: headDY = -4; lean = -2; armFY = -6; armBY = -6; bob = 1; break;   // header (hop via p.h)
    case C.S_WHIFF: fLeg = [6, -8, 11, -2]; lean = -3; break;
    case C.S_AIR: bLegX = -2; fLeg = [3, -13, 1, -8]; armFY = -6; armBY = -6; break;
  }
  if (p.ch > 0.02) { bob = -1; lean = -2 - p.ch * 2; }   // wind-up crouch while charging
  ctx.translate(lean, -bob);

  // back arm (behind torso)
  blk(SKIN_D, -8, -36 + armBY, 3, 11);
  // back leg
  blk(col.sock, bLegX, -10, 4, 8); blk(col.short, bLegX, -20, 4, 11); rect(OUT, bLegX - 1, -2, 6, 3); rect('#1d2630', bLegX - 1, -2, 6, 3);
  // shorts + jersey (torso)
  blk(col.short, -7, -24, 14, 7);
  blk(col.shirt, -7, -40, 14, 17);
  rect(col.dark, -7, -40, 14, 4);          // collar/shade
  rect('rgba(255,255,255,.14)', -6, -39, 4, 14); // sheen
  // front leg (over torso)
  blk(col.short, fLeg[0] - 2, -20, 4, Math.max(4, -10 - fLeg[1] + 14)); // thigh down from hip
  blk(col.sock, fLeg[2] - 2, fLeg[1], 4, Math.max(5, fLeg[3] - fLeg[1] + 10));
  rect(OUT, fLeg[2] - 3, fLeg[3] - 1, 7, 4); rect('#222c37', fLeg[2] - 2, fLeg[3], 6, 3); // boot
  // front arm
  blk(SKIN, 5, -36 + armFY, 3, 11);
  // head
  blk(SKIN, -5, -53 + headDY, 10, 12);
  rect(HAIR, -5, -53 + headDY, 10, 4);                 // hair
  rect(HAIR, -5, -53 + headDY, 3, 7);                  // sideburn
  rect(OUT, 3, -47 + headDY, 2, 2);                    // eye (forward)
  rect(SKIN_D, 0, -43 + headDY, 4, 1);                 // mouth/jaw

  ctx.restore();

  // charge bar
  if (p.ch > 0.02) {
    const w = 28, x0 = X - w / 2, y0 = Y - 66 * Z;
    rect('rgba(0,0,0,.55)', x0 - 1, y0 - 1, w + 2, 6);
    rect(p.ch > 0.85 ? '#ff7a7a' : '#ffd23f', x0, y0, w * p.ch, 4);
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
  const ssc = Math.max(0.35, 1 - b.h / 170);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(X, groundY + 2 * Z, 8 * Z * ssc, 3 * Z * ssc, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbfbfb'; ctx.beginPath(); ctx.arc(X, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222'; const spin = b.x * 0.06;
  for (let i = 0; i < 3; i++) { const a = spin + i * 2.1; ctx.beginPath(); ctx.arc(X + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.22, 0, Math.PI * 2); ctx.fill(); }
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
