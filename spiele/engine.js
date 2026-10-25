// Stubenspiele – Spiel-Engine. Läuft beim Gastgeber: in der App reicht Java HTTP-Anfragen herein (Bridge),
// im Internet-Modus reicht die Seite selbst Nachrichten vom Relay herein (Callbacks).
(function () {
  'use strict';
  const B = window.Bridge || null;
  const rooms = new Map();
  const streams = new Map();
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = n => Math.floor(Math.random() * n);
  const uid = () => Array.from({ length: 24 }, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join('');
  function newCode(len) { let c; do { c = ''; for (let i = 0; i < (len || 4); i++) c += CODE_CHARS[rnd(CODE_CHARS.length)]; } while (rooms.has(c)); return c; }
  function lanUrls() { try { return B ? JSON.parse(B.urls()) : []; } catch (e) { return []; } }

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
    const g = { players: names.map(n => ({ name: n, lives: 3, swim: false, out: false, hand: [], val: 0, lost: false })), dealer: 0, current: 0, deck: [], table: [], alt: [], knocker: null, passes: 0, phase: '', round: 1, result: null, ev: null, evSeq: 0 };
    szStartRound(g, 0); return g;
  }
  const szActive = g => g.players.map((p, i) => i).filter(i => !g.players[i].out);
  function szNext(g, i) { let j = i; for (let k = 0; k < g.players.length; k++) { j = (j + 1) % g.players.length; if (!g.players[j].out) return j; } return i; }
  function szStartRound(g, dealer) {
    g.deck = makeDeck(); g.dealer = dealer; g.knocker = null; g.passes = 0; g.result = null; g.table = []; g.ev = null;
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
  function szEv(g, pi, type, extra) { g.ev = Object.assign({ seq: ++g.evSeq, pi, type }, extra || {}); }
  function szAction(g, pi, a, d) {
    const mine = g.current === pi;
    if (g.phase === 'dealer' && mine) {
      if (a === 'dealerKeep') { g.table = g.alt; g.alt = []; szEv(g, pi, 'dealerKeep'); g.current = szNext(g, g.dealer); g.phase = 'turn'; return; }
      if (a === 'dealerSwap') { const p = g.players[g.dealer]; g.table = p.hand; p.hand = g.alt; g.alt = []; szEv(g, pi, 'dealerSwap'); g.current = szNext(g, g.dealer); g.phase = 'turn'; return; }
    }
    if (g.phase === 'turn' && mine) {
      const p = g.players[pi];
      if (a === 'swap') { const h = +d.h, t = +d.t; if (!(h >= 0 && h < 3 && t >= 0 && t < 3)) return; const tmp = p.hand[h]; p.hand[h] = g.table[t]; g.table[t] = tmp; szEv(g, pi, 'swap', { t, gave: tmp, took: p.hand[h] }); szAfterMove(g); return; }
      if (a === 'swapAll') { const tmp = p.hand; p.hand = g.table; g.table = tmp; szEv(g, pi, 'swapAll'); szAfterMove(g); return; }
      if (a === 'pass') {
        g.passes++;
        if (g.passes >= szActive(g).length) { if (g.deck.length >= 3) { g.table = g.deck.splice(0, 3); g.passes = 0; szEv(g, pi, 'newTable'); szAdvance(g); } else szShowdown(g, 'deck'); }
        else { szEv(g, pi, 'pass'); szAdvance(g); }
        return;
      }
      if (a === 'knock' && g.knocker === null) { g.knocker = pi; g.passes = 0; szEv(g, pi, 'knock'); szAdvance(g); return; }
    }
    if (g.phase === 'roundEnd' && a === 'nextRound' && g.result && g.result.winner === null && !g.result.draw) { g.round++; szStartRound(g, szNext(g, g.dealer)); }
  }
  function szView(g, pi) {
    const open = g.phase === 'roundEnd';
    return {
      game: 'schnauz', round: g.round, deck: g.deck.length, dealer: g.dealer, current: g.current, knocker: g.knocker, phase: g.phase, me: pi, result: g.result, ev: g.ev,
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

  /* ---- Vier Farben (Uno-Regeln) ---- */
  const UCOLS = ['r', 'y', 'g', 'b'];
  function unoDeck() {
    const d = [];
    for (const c of UCOLS) { d.push({ c, v: '0' }); for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) d.push({ c, v }, { c, v }); }
    for (let i = 0; i < 4; i++) d.push({ c: 'w', v: 'wild' }, { c: 'w', v: 'd4' });
    return shuffle(d);
  }
  function unoNew(names, extreme) {
    const g = { players: names.map(n => ({ name: n, hand: [], score: 0, said: false })), dir: 1, current: 0, pile: [], discard: [], color: 'r', phase: 'turn', drew: null, uno: null, round: 1, starter: 0, last: '', result: null, extreme: !!extreme, shot: null, shotSeq: 0 };
    unoStartRound(g, 0); return g;
  }
  function unoStartRound(g, starter) {
    g.pile = unoDeck(); g.discard = []; g.drew = null; g.uno = null; g.result = null; g.dir = 1;
    for (const p of g.players) { p.hand = g.pile.splice(0, 7); p.said = false; }
    let top = g.pile.shift();
    while (top.c === 'w' || isNaN(+top.v)) { g.pile.push(top); top = g.pile.shift(); }
    g.discard.push(top); g.color = top.c; g.current = starter; g.starter = starter; g.phase = 'turn';
    g.last = g.players[starter].name + ' beginnt.';
  }
  function unoDraw(g, p, n) {
    for (let i = 0; i < n; i++) {
      if (!g.pile.length) { const top = g.discard.pop(); g.pile = shuffle(g.discard); g.discard = [top]; if (!g.pile.length) break; }
      p.hand.push(g.pile.shift());
    }
  }
  /** Kartenwerfer der Extrem-Variante: pro Druck kommen 0 bis 8 Karten. */
  function unoShoot() { const r = Math.random(); return r < .35 ? 0 : r < .6 ? 1 : r < .75 ? 2 : r < .85 ? 3 : r < .92 ? 4 : 5 + Math.floor(Math.random() * 4); }
  function unoPress(g, p, presses) { let n = 0; for (let i = 0; i < presses; i++) n += unoShoot(); unoDraw(g, p, n); g.shot = { player: g.players.indexOf(p), n, presses, seq: ++g.shotSeq }; return n; }
  function unoNext(g, from, steps) { const n = g.players.length; return (((from + g.dir * steps) % n) + n) % n; }
  function unoPlayable(g, card) { const top = g.discard[g.discard.length - 1]; return card.c === 'w' || card.c === g.color || card.v === top.v; }
  function unoPoints(h) { return h.reduce((a, c) => a + (c.c === 'w' ? 50 : isNaN(+c.v) ? 20 : +c.v), 0); }
  function unoAdvance(g, steps) { g.current = unoNext(g, g.current, steps); g.drew = null; }
  function unoRoundEnd(g, winner) {
    const pts = g.players.reduce((a, p, i) => a + (i === winner ? 0 : unoPoints(p.hand)), 0);
    g.players[winner].score += pts; g.uno = null;
    g.result = { winner, points: pts, gameOver: g.players[winner].score >= 500, hands: g.players.map(p => unoPoints(p.hand)) };
    g.phase = 'roundEnd'; g.last = '';
  }
  function unoAction(g, pi, a, d) {
    if (g.phase === 'roundEnd') { if (a === 'nextRound' && g.result && !g.result.gameOver) { g.round++; unoStartRound(g, unoNext(g, g.starter, 1)); } return; }
    if (g.phase !== 'turn') return;
    const p = g.players[pi];
    if (a === 'uno') { if (p.hand.length === 1 && g.uno && g.uno.player === pi) { g.uno.said = true; p.said = true; g.last = p.name + ' ruft Uno!'; } return; }
    if (a === 'catch') {
      if (g.uno && !g.uno.said && g.uno.player !== pi) { const v = g.players[g.uno.player]; if (v.hand.length === 1) { unoDraw(g, v, 2); g.last = v.name + ' hat nicht Uno gesagt: zwei Strafkarten.'; } g.uno = null; }
      return;
    }
    if (g.current !== pi) return;
    if (g.uno && g.uno.player !== pi && (a === 'play' || a === 'draw')) g.uno = null;
    if (a === 'draw' && g.drew === null && g.extreme) {
      const n = unoPress(g, p, 1);
      g.last = p.name + ' drückt den Werfer: ' + (n === 0 ? 'nichts kommt raus!' : n === 1 ? 'eine Karte.' : n + ' Karten!');
      unoAdvance(g, 1); return;
    }
    if (a === 'draw' && g.drew === null) {
      unoDraw(g, p, 1); const c = p.hand[p.hand.length - 1];
      if (unoPlayable(g, c)) { g.drew = p.hand.length - 1; g.last = p.name + ' zieht eine Karte.'; }
      else { g.last = p.name + ' zieht und schiebt.'; unoAdvance(g, 1); }
      return;
    }
    if (a === 'pass' && g.drew !== null) { g.drew = null; g.last = p.name + ' schiebt.'; unoAdvance(g, 1); return; }
    if (a === 'play') {
      const i = +d.i; const card = p.hand[i];
      if (!card || !unoPlayable(g, card)) return;
      if (g.drew !== null && i !== g.drew) return;
      if (card.c === 'w' && !UCOLS.includes(d.color)) return;
      p.hand.splice(i, 1); g.drew = null; g.discard.push(card); g.color = card.c === 'w' ? d.color : card.c;
      const names = { skip: 'Aussetzen', rev: 'Richtungswechsel', d2: '+2', wild: 'Farbwahl', d4: '+4' };
      g.last = p.name + ' spielt ' + (names[card.v] || card.v) + '.';
      if (p.hand.length === 0) { unoRoundEnd(g, pi); return; }
      if (p.hand.length === 1) { g.uno = { player: pi, said: false }; p.said = false; }
      let steps = 1;
      if (card.v === 'rev') { g.dir *= -1; if (g.players.length === 2) steps = 2; }
      if (card.v === 'skip') steps = 2;
      if (card.v === 'd2' || card.v === 'd4') {
        const v = g.players[unoNext(g, pi, 1)];
        if (g.extreme) { const n = unoPress(g, v, card.v === 'd2' ? 2 : 4); g.last += ' ' + v.name + ' drückt ' + (card.v === 'd2' ? 'zweimal' : 'viermal') + ': ' + (n === 0 ? 'nichts!' : n + (n === 1 ? ' Karte.' : ' Karten!')); }
        else unoDraw(g, v, card.v === 'd2' ? 2 : 4);
        steps = 2;
      }
      unoAdvance(g, steps);
    }
  }
  function unoView(g, pi) {
    const open = g.phase === 'roundEnd';
    return { game: 'uno', me: pi, round: g.round, extreme: g.extreme, shot: g.shot, current: g.current, dir: g.dir, color: g.color, top: g.discard[g.discard.length - 1], pile: g.pile.length, phase: g.phase, drew: g.drew, uno: g.uno, last: g.last, result: g.result,
      players: g.players.map((p, i) => ({ name: p.name, score: p.score, count: p.hand.length, hand: (i === pi || open) ? p.hand : undefined, said: p.said })) };
  }

  /* ---- Räume ---- */
  function newGame(room) { const nm = room.players.map(x => x.name); return room.game === 'schnauz' ? szNew(nm) : room.game === 'uno' ? unoNew(nm, room.variant === 'extreme') : knNew(nm); }
  function roomView(room, pid) {
    const pi = room.players.findIndex(p => p.id === pid);
    const base = { code: room.code, me: pi, isHost: room.host === pid, phase: room.phase, urls: lanUrls(), players: room.players.map(p => ({ name: p.name, connected: p.streams.length > 0, host: p.id === room.host })), game: room.game, variant: room.variant || 'classic', online: !!room.online };
    if (room.phase === 'playing') base.view = room.game === 'schnauz' ? szView(room.state, pi) : room.game === 'uno' ? unoView(room.state, pi) : knView(room.state, pi);
    return base;
  }
  function broadcast(room) {
    for (const p of room.players) { const data = JSON.stringify(roomView(room, p.id)); for (const sid of p.streams) { const st = streams.get(sid); if (st && st.sink) st.sink(data); else if (B) B.push(sid, data); } }
  }
  function auth(room, pid, token) { const p = room && room.players.find(p => p.id === pid); return p && p.token === token ? p : null; }
  function cleanName(n) { return String(n || '').trim().slice(0, 14) || 'Spieler'; }
  function handleAction(room, p, a, d) {
    const pi = room.players.indexOf(p);
    if (room.phase === 'lobby') {
      if (a === 'setGame' && room.host === p.id && (d.g === 'schnauz' || d.g === 'kniffel' || d.g === 'uno')) room.game = d.g;
      if (a === 'setVariant' && room.host === p.id && (d.v === 'classic' || d.v === 'extreme')) room.variant = d.v;
      if (a === 'start' && room.host === p.id) {
        const n = room.players.length; const min = room.game === 'kniffel' ? 1 : 2;
        if (n >= min && n <= 4) { room.state = newGame(room); room.phase = 'playing'; }
      }
      if (a === 'leave') { room.players.splice(pi, 1); if (room.host === p.id && room.players[0]) room.host = room.players[0].id; }
      return;
    }
    if (a === 'backToLobby' && room.host === p.id) { room.phase = 'lobby'; room.state = null; return; }
    if (a === 'rematch' && room.host === p.id) { room.state = newGame(room); return; }
    if (a === 'nextRound' && room.host !== p.id) return;
    if (room.game === 'schnauz') szAction(room.state, pi, a, d);
    else if (room.game === 'uno') unoAction(room.state, pi, a, d);
    else knAction(room.state, pi, a, d);
  }
  function route(path, b) {
    if (path === '/api/create') {
      let code = newCode(b.codeLen === 6 ? 6 : 4);
      if (typeof b.code === 'string' && /^[A-Z0-9]{6}$/.test(b.code) && !rooms.has(b.code)) code = b.code;
      const p = { id: uid(), token: uid(), name: cleanName(b.name), streams: [] };
      rooms.set(code, { code, host: p.id, players: [p], phase: 'lobby', game: 'schnauz', state: null, created: Date.now(), online: b.codeLen === 6 });
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
  function request(id, path, bodyText, cb) {
    let res;
    try { res = route(path, typeof bodyText === 'string' ? JSON.parse(bodyText || '{}') : (bodyText || {})); } catch (e) { res = [500, { error: String(e) }]; }
    if (cb) cb(res[0], res[1]); else if (B) B.respond(id, res[0], JSON.stringify(res[1]));
  }
  function subscribe(id, code, pid, token, sink) {
    const room = rooms.get(code); const p = auth(room, pid, token);
    if (!p) { if (sink) sink(null); else if (B) B.closeStream(id); return; }
    if (!p.streams.includes(id)) p.streams.push(id);
    streams.set(id, { room, p, sink }); broadcast(room);
  }
  function unsubscribe(id) {
    const s = streams.get(id); if (!s) return;
    streams.delete(id); s.p.streams = s.p.streams.filter(x => x !== id);
    if (rooms.has(s.room.code)) broadcast(s.room);
  }
  setInterval(() => { const now = Date.now(); for (const [code, r] of rooms) if (r.players.every(p => p.streams.length === 0) && now - r.created > 2 * 3600e3) rooms.delete(code); }, 60e3);
  window.Engine = { request, subscribe, unsubscribe };
})();
