// Stubenspiele – Spiel-Engine. Läuft nur auf dem Host-Handy im WebView; Java reicht HTTP-Anfragen hier herein.
(function () {
  'use strict';
  if (!window.Bridge) return;
  const rooms = new Map();
  const streams = new Map();
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = n => Math.floor(Math.random() * n);
  const uid = () => Array.from({ length: 24 }, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join('');
  function newCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)]; } while (rooms.has(c)); return c; }
  function lanUrls() { try { return JSON.parse(Bridge.urls()); } catch (e) { return []; } }

  /* ---- Schnauz ---- */
  const SUITS = [{ s: '♠', red: false }, { s: '♥', red: true }, { s: '♦', red: true }, { s: '♣', red: false }];
  const RANKS = [['7', 7], ['8', 8], ['9', 9], ['10', 10], ['B', 10], ['D', 10], ['K', 10], ['A', 11]];
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; }
  function makeDeck() { const d = []; for (const su of SUITS) for (const [r, v] of RANKS) d.push({ s: su.s, red: su.red, r, v }); return shuffle(d); }
  function handValue(h) {
    if (h.length < 3) return 0;
    if (h[0].r === h[1].r && h[1].r === h[2].r) return h[0].r === 'A' ? 33 : 30.5;
    const by = {}; for (const c of h) by[c.s] = (by[c.s] || 0) + c.v;
    return Math.max(...Object.values(by));
  }
  function szNew(names) {
    const g = { players: names.map(n => ({ name: n, lives: 3, swim: false, out: false, hand: [], val: 0, lost: false })), dealer: 0, current: 0, deck: [], table: [], alt: [], knocker: null, passes: 0, phase: '', round: 1, result: null };
    szStartRound(g, 0); return g;
  }
  const szActive = g => g.players.map((p, i) => i).filter(i => !g.players[i].out);
  function szNext(g, i) { let j = i; for (let k = 0; k < g.players.length; k++) { j = (j + 1) % g.players.length; if (!g.players[j].out) return j; } return i; }
  function szStartRound(g, dealer) {
    g.deck = makeDeck(); g.dealer = dealer; g.knocker = null; g.passes = 0; g.result = null; g.table = [];
    for (const p of g.players) { p.hand = []; p.val = 0; p.lost = false; }
    for (const i of szActive(g)) g.players[i].hand = g.deck.splice(0, 3);
    g.alt = g.deck.splice(0, 3);
    g.current = dealer; g.phase = 'dealer';
  }
  function szAdvance(g) {
    const next = szNext(g, g.current);
    if (g.knocker !== null && next === g.knocker) { szShowdown(g, 'klopf'); return; }
    g.current = next; g.phase = 'turn';
  }
  function szAfterMove(g) {
    g.passes = 0; const v = handValue(g.players[g.current].hand);
    if (v === 33) { szShowdown(g, 'feuer'); return; }
    if (v === 31) { szShowdown(g, 'schnauz'); return; }
    szAdvance(g);
  }
  function szShowdown(g, reason) {
    const act = szActive(g);
    for (const i of act) g.players[i].val = handValue(g.players[i].hand);
    let losers = [];
    if (reason === 'feuer') { const star = act.find(i => g.players[i].val === 33); losers = act.filter(i => i !== star); }
    else { const min = Math.min(...act.map(i => g.players[i].val)); losers = act.filter(i => g.players[i].val === min); }
    const notes = {};
    for (const i of losers) {
      const p = g.players[i]; p.lost = true;
      if (p.lives > 0) { p.lives--; if (p.lives === 0) { p.swim = true; notes[i] = 'Letztes Leben weg – ' + p.name + ' schwimmt.'; } else notes[i] = 'Verliert ein Leben.'; }
      else { p.out = true; p.swim = false; notes[i] = 'Ist ertrunken – raus aus dem Spiel.'; }
    }
    const left = szActive(g);
    g.result = { reason, losers, notes, players: act.slice(), winner: left.length === 1 ? left[0] : null, draw: left.length === 0 };
    g.phase = 'roundEnd';
  }
  function szAction(g, pi, a, d) {
    const mine = g.current === pi;
    if (g.phase === 'dealer' && mine) {
      if (a === 'dealerKeep') { g.table = g.alt; g.alt = []; g.current = szNext(g, g.dealer); g.phase = 'turn'; return; }
      if (a === 'dealerSwap') { const p = g.players[g.dealer]; g.table = p.hand; p.hand = g.alt; g.alt = []; g.current = szNext(g, g.dealer); g.phase = 'turn'; return; }
    }
    if (g.phase === 'turn' && mine) {
      const p = g.players[pi];
      if (a === 'swap') { const h = +d.h, t = +d.t; if (!(h >= 0 && h < 3 && t >= 0 && t < 3)) return; const tmp = p.hand[h]; p.hand[h] = g.table[t]; g.table[t] = tmp; szAfterMove(g); return; }
      if (a === 'swapAll') { const tmp = p.hand; p.hand = g.table; g.table = tmp; szAfterMove(g); return; }
      if (a === 'pass') {
        g.passes++;
        if (g.passes >= szActive(g).length) { if (g.deck.length >= 3) { g.table = g.deck.splice(0, 3); g.passes = 0; szAdvance(g); } else szShowdown(g, 'deck'); }
        else szAdvance(g);
        return;
      }
      if (a === 'knock' && g.knocker === null) { g.knocker = pi; g.passes = 0; szAdvance(g); return; }
    }
    if (g.phase === 'roundEnd' && a === 'nextRound' && g.result && g.result.winner === null && !g.result.draw) { g.round++; szStartRound(g, szNext(g, g.dealer)); }
  }
  function szView(g, pi) {
    const open = g.phase === 'roundEnd';
    return {
      game: 'schnauz', round: g.round, deck: g.deck.length, dealer: g.dealer, current: g.current, knocker: g.knocker, phase: g.phase, me: pi, result: g.result,
      table: g.phase === 'dealer' ? null : g.table,
      players: g.players.map((p, i) => ({ name: p.name, lives: p.lives, swim: p.swim, out: p.out, lost: p.lost, val: open ? p.val : null, hand: (open || i === pi) ? p.hand : p.hand.length })),
    };
  }

  /* ---- Kniffel ---- */
  const KCATS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'three', 'four', 'fh', 'small', 'large', 'kniffel', 'chance'];
  function knNew(names) { return { players: names.map(n => ({ name: n, sheet: Object.fromEntries(KCATS.map(k => [k, null])), bonus: 0 })), current: 0, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rolls: 0, turn: 1, phase: 'turn', seq: 0 }; }
  const dsum = d => d.reduce((a, b) => a + b, 0);
  function counts(d) { const c = [0, 0, 0, 0, 0, 0, 0]; for (const v of d) c[v]++; return c; }
  function hasStraight(d, len) { const u = [...new Set(d)].sort(); let run = 1, best = 1; for (let i = 1; i < u.length; i++) { run = u[i] === u[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); } return best >= len; }
  function kScore(cat, d, p) {
    const c = counts(d), s = dsum(d), isK = c.some(x => x === 5);
    const joker = isK && p && p.sheet.kniffel !== null && p.sheet['n' + d[0]] !== null;
    if (cat[0] === 'n') { const n = +cat[1]; return c[n] * n; }
    switch (cat) {
      case 'three': return c.some(x => x >= 3) ? s : 0;
      case 'four': return c.some(x => x >= 4) ? s : 0;
      case 'fh': return (c.includes(3) && c.includes(2)) || joker ? 25 : 0;
      case 'small': return hasStraight(d, 4) || joker ? 30 : 0;
      case 'large': return hasStraight(d, 5) || joker ? 40 : 0;
      case 'kniffel': return isK ? 50 : 0;
      case 'chance': return s;
    } return 0;
  }
  function knAction(g, pi, a, d) {
    if (g.phase !== 'turn' || g.current !== pi) return;
    if (a === 'roll' && g.rolls < 3) { for (let i = 0; i < 5; i++) if (!g.held[i] || g.rolls === 0) g.dice[i] = 1 + rnd(6); g.rolls++; g.seq++; return; }
    if (a === 'hold' && g.rolls > 0 && g.rolls < 3) { const i = +d.i; if (i >= 0 && i < 5) g.held[i] = !g.held[i]; return; }
    if (a === 'score' && g.rolls > 0) {
      const p = g.players[pi]; const cat = d.k; if (!KCATS.includes(cat) || p.sheet[cat] !== null) return;
      if (counts(g.dice).some(x => x === 5) && p.sheet.kniffel === 50) p.bonus += 50;
      p.sheet[cat] = kScore(cat, g.dice, p);
      g.held = [false, false, false, false, false]; g.rolls = 0;
      g.current = (g.current + 1) % g.players.length;
      if (g.current === 0) { g.turn++; if (g.turn > 13) g.phase = 'over'; }
    }
  }
  function knView(g, pi) {
    const p = g.players[g.current];
    const potential = g.phase === 'turn' && g.rolls > 0 ? Object.fromEntries(KCATS.filter(k => p.sheet[k] === null).map(k => [k, kScore(k, g.dice, p)])) : null;
    return { game: 'kniffel', me: pi, players: g.players, current: g.current, dice: g.dice, held: g.held, rolls: g.rolls, turn: g.turn, phase: g.phase, seq: g.seq, potential };
  }

  /* ---- Räume ---- */
  function roomView(room, pid) {
    const pi = room.players.findIndex(p => p.id === pid);
    const base = { code: room.code, me: pi, isHost: room.host === pid, phase: room.phase, urls: lanUrls(), players: room.players.map(p => ({ name: p.name, connected: p.streams.length > 0, host: p.id === room.host })), game: room.game };
    if (room.phase === 'playing') base.view = room.game === 'schnauz' ? szView(room.state, pi) : knView(room.state, pi);
    return base;
  }
  function broadcast(room) {
    for (const p of room.players) { const data = JSON.stringify(roomView(room, p.id)); for (const sid of p.streams) Bridge.push(sid, data); }
  }
  function auth(room, pid, token) { const p = room && room.players.find(p => p.id === pid); return p && p.token === token ? p : null; }
  function cleanName(n) { return String(n || '').trim().slice(0, 14) || 'Spieler'; }
  function handleAction(room, p, a, d) {
    const pi = room.players.indexOf(p);
    if (room.phase === 'lobby') {
      if (a === 'setGame' && room.host === p.id && (d.g === 'schnauz' || d.g === 'kniffel')) room.game = d.g;
      if (a === 'start' && room.host === p.id) {
        const n = room.players.length; const min = room.game === 'schnauz' ? 2 : 1;
        if (n >= min && n <= 4) { room.state = room.game === 'schnauz' ? szNew(room.players.map(x => x.name)) : knNew(room.players.map(x => x.name)); room.phase = 'playing'; }
      }
      if (a === 'leave') { room.players.splice(pi, 1); if (room.host === p.id && room.players[0]) room.host = room.players[0].id; }
      return;
    }
    if (a === 'backToLobby' && room.host === p.id) { room.phase = 'lobby'; room.state = null; return; }
    if (a === 'rematch' && room.host === p.id) { room.state = room.game === 'schnauz' ? szNew(room.players.map(x => x.name)) : knNew(room.players.map(x => x.name)); return; }
    if (room.game === 'schnauz') { if (a === 'nextRound' && room.host !== p.id) return; szAction(room.state, pi, a, d); }
    else knAction(room.state, pi, a, d);
  }
  function route(path, b) {
    if (path === '/api/create') {
      const code = newCode(); const p = { id: uid(), token: uid(), name: cleanName(b.name), streams: [] };
      rooms.set(code, { code, host: p.id, players: [p], phase: 'lobby', game: 'schnauz', state: null, created: Date.now() });
      return [200, { code, pid: p.id, token: p.token }];
    }
    if (path === '/api/join') {
      const room = rooms.get(String(b.code || '').toUpperCase().trim());
      if (!room) return [404, { error: 'Kein Spiel mit diesem Code.' }];
      if (room.phase !== 'lobby') return [409, { error: 'Das Spiel läuft schon.' }];
      if (room.players.length >= 4) return [409, { error: 'Der Tisch ist voll (4 Spieler).' }];
      const p = { id: uid(), token: uid(), name: cleanName(b.name), streams: [] };
      room.players.push(p); broadcast(room);
      return [200, { code: room.code, pid: p.id, token: p.token }];
    }
    if (path === '/api/state') {
      const room = rooms.get(b.code); const p = auth(room, b.pid, b.token);
      if (!p) return [403, { error: 'Nicht mehr im Spiel.' }];
      return [200, roomView(room, p.id)];
    }
    if (path === '/api/action') {
      const room = rooms.get(b.code); const p = auth(room, b.pid, b.token);
      if (!p) return [403, { error: 'Nicht mehr im Spiel.' }];
      handleAction(room, p, String(b.action || ''), b.data || {});
      broadcast(room); return [200, { ok: true }];
    }
    return [404, { error: 'Nicht gefunden' }];
  }
  function request(id, path, bodyText) {
    let res;
    try { res = route(path, JSON.parse(bodyText || '{}')); } catch (e) { res = [500, { error: String(e) }]; }
    Bridge.respond(id, res[0], JSON.stringify(res[1]));
  }
  function subscribe(id, code, pid, token) {
    const room = rooms.get(code); const p = auth(room, pid, token);
    if (!p) { Bridge.closeStream(id); return; }
    p.streams.push(id); streams.set(id, { room, p }); broadcast(room);
  }
  function unsubscribe(id) {
    const s = streams.get(id); if (!s) return;
    streams.delete(id); s.p.streams = s.p.streams.filter(x => x !== id);
    if (rooms.has(s.room.code)) broadcast(s.room);
  }
  setInterval(() => { const now = Date.now(); for (const [code, r] of rooms) if (r.players.every(p => p.streams.length === 0) && now - r.created > 2 * 3600e3) rooms.delete(code); }, 60e3);
  window.Engine = { request, subscribe, unsubscribe };
})();
