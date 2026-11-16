// DogGame online sunucusu: oda, davet kodu ve mesaj aktarımı.
// Bağımlılık yok (sadece Node.js). Çalıştırma: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const BREED_KEYS = ['shiba', 'husky', 'corgi', 'dachshund', 'golden', 'pug', 'bulldog', 'beagle', 'poodle', 'doberman', 'collie', 'technohav', 'pianist'];
const SERVE = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'application/javascript'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/music.mp3': ['music.mp3', 'audio/mpeg'],
  '/menu.mp3': ['menu.mp3', 'audio/mpeg']
};

const rooms = new Map();   // kod -> oda
const clients = new Map(); // id -> istemci
const presence = new Map(); // ziyaretçi id -> { name, status, seen }

function makeId() { return crypto.randomBytes(12).toString('base64url'); }
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s;
  do {
    s = '';
    for (let i = 0; i < 5; i++) s += A[crypto.randomInt(A.length)];
  } while (rooms.has(s));
  return s;
}
function sendTo(c, obj) {
  if (!c || !c.res) return;
  try { c.res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
}
function rosterOf(room) {
  return {
    type: 'roster', code: room.code, host: room.host, started: room.started, pvp: !!room.pvp,
    players: [...room.members.values()].map(m => ({ id: m.id, name: m.name, team: m.team, breed: m.breed }))
  };
}
function broadcastRoom(room, obj, exceptId) {
  for (const m of room.members.values()) if (m.id !== exceptId) sendTo(m, obj);
}
function removeFromRoom(c) {
  const room = rooms.get(c.code);
  if (!room) return;
  room.members.delete(c.id);
  if (room.members.size === 0) { rooms.delete(room.code); return; }
  if (room.host === c.id) room.host = room.members.keys().next().value;
  broadcastRoom(room, rosterOf(room));
}
function sanitizeEquip(e) {
  const out = {};
  if (e && typeof e === 'object') {
    for (const k of ['hat', 'outfit', 'face', 'acc', 'trail', 'fur', 'ribbon', 'tail']) {
      if (typeof e[k] === 'string' && e[k].length < 40) out[k] = e[k];
    }
  }
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function cleanName(n) {
  return String(n || 'Oyuncu').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Oyuncu';
}

const MAP_IDS = ['grass', 'desert', 'night', 'sunrise', 'rain', 'snow'];
function startMatch(room, c, mode = '3v3', map = 'grass') {
  const seed = crypto.randomInt(1, 2147483646);
  const slots = [];
  if (room.pvp && mode === 'boss') { sendTo(c, { type: 'notice', text: 'PvP açıkken boss savaşı başlatılamaz.' }); return; }
  if (mode === 'boss') {
    // Boss savaşı: en fazla 3 insan mavi takımda, eksikleri botlar tamamlar, kırmızıda tek boss
    if (room.members.size > 3) { sendTo(c, { type: 'notice', text: 'Boss savaşı en fazla 3 kişiyle oynanır.' }); return; }
    const humans = [...room.members.values()].slice(0, 3);
    humans.forEach((m, i) => slots.push({ sid: m.id, owner: m.id, team: 'blue', name: m.name, breed: m.breed, equip: m.equip || {}, bot: false, idx: i }));
    for (let i = humans.length; i < 3; i++) {
      slots.push({ sid: 'bot-blue-' + i, owner: room.host, team: 'blue', name: 'Bot', breed: BREED_KEYS[crypto.randomInt(BREED_KEYS.length)], equip: {}, bot: true, idx: i });
    }
    slots.push({ sid: 'boss', owner: room.host, team: 'red', name: '👹 BOSS', breed: 'doberman', equip: {}, bot: true, idx: 0, boss: true });
  } else if (room.pvp) {
    // PvP: sadece iki insan, ayrı takımlarda, botsuz
    const humans = [...room.members.values()];
    if (humans.length !== 2 || humans[0].team === humans[1].team) {
      sendTo(c, { type: 'notice', text: 'PvP için iki oyuncu ayrı takımlarda olmalı.' });
      return;
    }
    humans.forEach((m, i) => slots.push({ sid: m.id, owner: m.id, team: m.team, name: m.name, breed: m.breed, equip: m.equip || {}, bot: false, idx: 0 }));
  } else {
    for (const team of ['blue', 'red']) {
      const humans = [...room.members.values()].filter(m => m.team === team).slice(0, 3);
      humans.forEach((m, i) => slots.push({ sid: m.id, owner: m.id, team, name: m.name, breed: m.breed, equip: m.equip || {}, bot: false, idx: i }));
      for (let i = humans.length; i < 3; i++) {
        slots.push({ sid: 'bot-' + team + '-' + i, owner: room.host, team, name: 'Bot', breed: BREED_KEYS[crypto.randomInt(BREED_KEYS.length)], equip: {}, bot: true, idx: i });
      }
    }
  }
  room.started = true;
  broadcastRoom(room, { type: 'start', seed, host: room.host, slots, map: MAP_IDS.includes(map) ? map : 'grass', mode: mode === 'boss' ? 'boss' : '3v3' });
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/presence') {
    const body = await readBody(req);
    const id = String(body.id || '').slice(0, 40);
    if (!id) return json(res, 400, { error: 'Geçersiz ziyaretçi' });
    if (presence.size < 5000 || presence.has(id)) {
      presence.set(id, { name: cleanName(body.name), status: ['menüde', 'lobide', 'maçta'].includes(body.status) ? body.status : 'menüde', seen: Date.now() });
    }
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/online') {
    const now = Date.now();
    const players = [];
    for (const [id, p] of presence) {
      if (now - p.seen > 40000) { presence.delete(id); continue; }
      players.push({ name: p.name, status: p.status });
    }
    return json(res, 200, { total: players.length, players });
  }
  if (req.method === 'POST' && url.pathname === '/api/create') {
    const body = await readBody(req);
    const c = { id: makeId(), name: cleanName(body.name), team: 'blue', breed: 'shiba', equip: {}, res: null, code: null, lastSeen: Date.now() };
    const code = makeCode();
    const room = { code, host: c.id, members: new Map([[c.id, c]]), started: false, pvp: false };
    c.code = code;
    clients.set(c.id, c);
    rooms.set(code, room);
    return json(res, 200, { id: c.id, code });
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return json(res, 404, { error: 'Oda bulunamadı. Kodu kontrol et.' });
    if (room.started) return json(res, 409, { error: 'Maç zaten başladı.' });
    if (room.members.size >= 6) return json(res, 409, { error: 'Oda dolu.' });
    if (room.pvp && room.members.size >= 2) return json(res, 409, { error: 'PvP odası dolu (2 oyuncu).' });
    const count = team => [...room.members.values()].filter(m => m.team === team).length;
    const c = { id: makeId(), name: cleanName(body.name), team: count('blue') <= count('red') ? 'blue' : 'red', breed: 'shiba', equip: {}, res: null, code, lastSeen: Date.now() };
    room.members.set(c.id, c);
    clients.set(c.id, c);
    broadcastRoom(room, rosterOf(room));
    return json(res, 200, { id: c.id, code });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const c = clients.get(url.searchParams.get('id'));
    if (!c) return json(res, 404, { error: 'Oturum bulunamadı' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    if (c.res) { try { c.res.end(); } catch (e) {} }
    c.res = res;
    c.lastSeen = Date.now();
    const room = rooms.get(c.code);
    if (room) sendTo(c, rosterOf(room));
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      if (c.res === res) {
        c.res = null;
        c.lastSeen = Date.now();
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    const body = await readBody(req);
    const c = clients.get(body.id);
    if (!c) return json(res, 404, { error: 'Oturum bulunamadı' });
    c.lastSeen = Date.now();
    const room = rooms.get(c.code);
    if (!room || !room.members.has(c.id)) return json(res, 404, { error: 'Oda bulunamadı' });
    const type = String(body.type || '');
    const data = body.data || {};

    if (type === 'team' && !room.started) {
      if (data.team === 'blue' || data.team === 'red') {
        if (room.pvp && [...room.members.values()].some(m => m.id !== c.id && m.team === data.team)) {
          sendTo(c, { type: 'notice', text: "PvP'de takımlar ayrı olmalı: diğer oyuncu bu takımda." });
          return json(res, 200, { ok: true });
        }
        c.team = data.team;
      }
      broadcastRoom(room, rosterOf(room));
      return json(res, 200, { ok: true });
    }
    if (type === 'pvp' && !room.started) {
      if (room.host !== c.id) return json(res, 403, { error: 'Sadece oda sahibi değiştirebilir.' });
      const on = !!data.on;
      if (on && room.members.size > 2) {
        sendTo(c, { type: 'notice', text: 'PvP için odada en fazla 2 oyuncu olmalı.' });
        return json(res, 200, { ok: true });
      }
      room.pvp = on;
      if (on && room.members.size === 2) {
        const [a, b] = [...room.members.values()];
        if (a.team === b.team) b.team = a.team === 'blue' ? 'red' : 'blue';
      }
      broadcastRoom(room, rosterOf(room));
      return json(res, 200, { ok: true });
    }
    if (type === 'breed' && !room.started) {
      if (BREED_KEYS.includes(data.breed)) c.breed = data.breed;
      c.equip = sanitizeEquip(data.equip);
      broadcastRoom(room, rosterOf(room));
      return json(res, 200, { ok: true });
    }
    if (type === 'start') {
      if (room.host !== c.id) return json(res, 403, { error: 'Sadece oda sahibi başlatabilir.' });
      startMatch(room, c, data && data.mode === 'boss' ? 'boss' : '3v3', data && data.map);
      return json(res, 200, { ok: true });
    }
    if (type === 'leave') {
      removeFromRoom(c);
      clients.delete(c.id);
      if (c.res) { try { c.res.end(); } catch (e) {} }
      return json(res, 200, { ok: true });
    }
    // Maç mesajları: hedef varsa sadece ona, yoksa odadaki diğerlerine
    const msg = { type, from: c.id, data };
    if (body.to) {
      const target = clients.get(body.to);
      if (target && room.members.has(target.id)) sendTo(target, msg);
    } else {
      broadcastRoom(room, msg, c.id);
    }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Bulunamadı' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const file = SERVE[url.pathname];
    if (!file) { res.writeHead(404); return res.end('Bulunamadı'); }
    fs.readFile(path.join(ROOT, file[0]), (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    try { json(res, 400, { error: 'Geçersiz istek' }); } catch (_) {}
  }
});

// Bağlantısı kopmuş ve uzun süre dönmeyen istemcileri temizle
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) {
    if (!c.res && now - c.lastSeen > 60000) {
      removeFromRoom(c);
      clients.delete(id);
    }
  }
}, 30000).unref();

server.listen(PORT, () => console.log('DogGame sunucusu: http://localhost:' + PORT));
