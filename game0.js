"use strict";
const $ = id => document.getElementById(id);
const lobby = $("lobby"), game = $("game"), cv = $("cv"), ctx = cv.getContext("2d");
const W = 1200, H = 700, WIN = 15, DURATION = 120;
let S = null, raf = 0, last = 0;
const keys = {}, joy = { x: 0, y: 0 };
const TEAM = ["#2f7ff0", "#e83030"];

$("play").onclick = start;
$("back").onclick = () => { cancelAnimationFrame(raf); S = null; game.classList.add("hidden"); lobby.classList.remove("hidden"); };

function mk(team, i, isPlayer) {
  return { team, isPlayer, x: team ? W - 120 : 120, y: H / 2 + (i - 1) * 110, hp: 100, dead: 0,
    atk: 0, skill: 0, face: 0, swing: 0, name: isPlayer ? "You" : "Bot" };
}
function start() {
  lobby.classList.add("hidden"); game.classList.remove("hidden"); $("end").classList.add("hidden");
  S = { t: DURATION, score: [0, 0], gems: [], spawn: 0, over: false,
        dogs: [mk(0, 0, true), mk(0, 1), mk(0, 2), mk(1, 0), mk(1, 1), mk(1, 2)] };
  resize(); last = performance.now(); raf = requestAnimationFrame(loop);
}
function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener("resize", resize);

/* input */
addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "Space") { e.preventDefault(); skill(S && S.dogs[0]); } });
addEventListener("keyup", e => keys[e.code] = false);
cv.addEventListener("pointerdown", () => attack(S && S.dogs[0]));
$("btnAtk").onpointerdown = () => attack(S && S.dogs[0]);
$("btnSkill").onpointerdown = () => skill(S && S.dogs[0]);
const joyEl = $("joy"), knob = $("knob");
function joyMove(e) {
  const r = joyEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (e.clientX - cx) / 65, dy = (e.clientY - cy) / 65, m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * 35}px,${dy * 35}px)`;
}
joyEl.addEventListener("pointerdown", e => { joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") joyMove(e); });
joyEl.addEventListener("pointerup", () => { joy.x = joy.y = 0; knob.style.transform = ""; });

/* actions */
const enemies = d => S.dogs.filter(o => o.team !== d.team && !o.dead);
function nearest(d, list) { let b = null, bd = 1e9; for (const o of list) { const k = Math.hypot(o.x - d.x, o.y - d.y); if (k < bd) { bd = k; b = o; } } return [b, bd]; }
function attack(d) {
  if (!S || S.over || !d || d.dead || d.atk > 0) return;
  d.atk = 0.6; d.swing = 0.25;
  const [e, k] = nearest(d, enemies(d));
  if (e && k < 160) d.face = Math.atan2(e.y - d.y, e.x - d.x);
  for (const o of enemies(d)) {
    const k2 = Math.hypot(o.x - d.x, o.y - d.y), a = Math.atan2(o.y - d.y, o.x - d.x);
    if (k2 < 95 && Math.abs(Math.atan2(Math.sin(a - d.face), Math.cos(a - d.face))) < 1.1) {
      o.hp -= 40; o.x += Math.cos(a) * 40; o.y += Math.sin(a) * 40;
      if (o.hp <= 0) { o.dead = 3; o.hp = 100; }
    }
  }
}
function skill(d) {
  if (!S || S.over || !d || d.dead || d.skill > 0) return;
  d.skill = 5; d.x += Math.cos(d.face) * 170; d.y += Math.sin(d.face) * 170;
}

/* loop */
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S && !S.over) update(dt);
  if (S) draw();
  raf = requestAnimationFrame(loop);
}
function update(dt) {
  S.t -= dt; S.spawn -= dt;
  if (S.spawn <= 0 && S.gems.length < 14) { S.gems.push({ x: 150 + Math.random() * (W - 300), y: 60 + Math.random() * (H - 120) }); S.spawn = 1.1; }
  for (const d of S.dogs) {
    d.atk = Math.max(0, d.atk - dt); d.skill = Math.max(0, d.skill - dt); d.swing = Math.max(0, d.swing - dt);
    if (d.dead > 0) { d.dead -= dt; if (d.dead <= 0) { d.x = d.team ? W - 120 : 120; d.y = H / 2; } continue; }
    let mx = 0, my = 0;
    if (d.isPlayer) {
      mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
      my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
    } else {
      const [e, ed] = nearest(d, enemies(d));
      if (e && ed < 90) { mx = e.x - d.x; my = e.y - d.y; if (Math.random() < 0.04) { d.face = Math.atan2(my, mx); attack(d); } }
      else { const [g] = nearest(d, S.gems); if (g) { mx = g.x - d.x; my = g.y - d.y; } else { mx = W / 2 - d.x; my = H / 2 - d.y; } }
    }
    const m = Math.hypot(mx, my);
    if (m > 0.15) { const k = Math.min(1, m) / m * (d.isPlayer ? 230 : 190) * dt; d.x += mx * k; d.y += my * k; d.face = Math.atan2(my, mx); }
    d.x = Math.max(30, Math.min(W - 30, d.x)); d.y = Math.max(30, Math.min(H - 30, d.y));
    S.gems = S.gems.filter(g => { if (Math.hypot(g.x - d.x, g.y - d.y) < 34) { S.score[d.team]++; return false; } return true; });
    if (d.hp < 100) d.hp = Math.min(100, d.hp + 6 * dt);
  }
  $("score").textContent = S.score[0] + " : " + S.score[1];
  const t = Math.max(0, Math.ceil(S.t)); $("timer").textContent = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  if (S.score[0] >= WIN || S.score[1] >= WIN || S.t <= 0) {
    S.over = true; const [a, b] = S.score;
    $("endTitle").textContent = a === b ? "DRAW" : a > b ? "VICTORY!" : "DEFEAT";
    $("end").classList.remove("hidden");
  }
}
function draw() {
  const sc = Math.min(cv.width / W, cv.height / H), ox = (cv.width - W * sc) / 2, oy = (cv.height - H * sc) / 2;
  ctx.fillStyle = "#1c4a2a"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(sc, 0, 0, sc, ox, oy);
  ctx.fillStyle = "#3f8f4e"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#4aa05a";
  for (let i = 0; i < W; i += 100) for (let j = (i / 100) % 2 * 100; j < H; j += 200) ctx.fillRect(i, j, 100, 100);
  ctx.fillStyle = "rgba(47,127,240,.25)"; ctx.fillRect(0, 0, 70, H);
  ctx.fillStyle = "rgba(232,48,48,.25)"; ctx.fillRect(W - 70, 0, 70, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "30px sans-serif";
  for (const g of S.gems) ctx.fillText("💎", g.x, g.y + Math.sin(performance.now() / 300 + g.x) * 3);
  for (const d of S.dogs) {
    if (d.dead > 0) continue;
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(d.x, d.y + 24, 24, 9, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = TEAM[d.team]; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(d.x, d.y, 30, 0, 7); ctx.stroke();
    ctx.font = "44px sans-serif"; ctx.fillText("🐶", d.x, d.y);
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.face + (d.swing ? (d.swing / 0.25 - 0.5) * 2 : 0));
    ctx.font = "30px sans-serif"; ctx.fillText("🦴", 44, 0); ctx.restore();
    ctx.fillStyle = "#000"; ctx.fillRect(d.x - 26, d.y - 48, 52, 8);
    ctx.fillStyle = TEAM[d.team]; ctx.fillRect(d.x - 25, d.y - 47, 50 * d.hp / 100, 6);
    if (d.isPlayer) { ctx.fillStyle = "#fff"; ctx.font = "16px Lilita One,sans-serif"; ctx.fillText("YOU", d.x, d.y - 60); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
