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
  /* Coins: Spielgeld-Belohnungen pro Spiel, werden an die Clients gemeldet und dort im Geldbeutel gutgeschrieben. */
  function grant(g, pi, coins, reason) { if (!g.awards) { g.awards = []; g.awardSeq = 0; } g.awards.push({ id: (g.gid || 'g') + '-' + (++g.awardSeq), pi, coins, reason }); if (g.awards.length > 60) g.awards.shift(); }
  function knTotal(p) { const up = ['n1','n2','n3','n4','n5','n6'].reduce((a, k) => a + (p.sheet[k] || 0), 0); const low = Object.keys(p.sheet).filter(k => k[0] !== 'n').reduce((a, k) => a + (p.sheet[k] || 0), 0); return up + (up >= 63 ? 35 : 0) + low + (p.bonus || 0); }
  function handValue(h) {
    if (h.length < 3) return 0;
    if (h[0].r === h[1].r && h[1].r === h[2].r) return h[0].r === 'A' ? 33 : 30.5;
    const by = {}; for (const c of h) by[c.s] = (by[c.s] || 0) + c.v;
    return Math.max(...Object.values(by));
  }
  function szNew(names) {
    const g = { players: names.map(n => ({ name: n, lives: 3, swim: false, out: false, hand: [], val: 0, lost: false, passed: false })), dealer: 0, current: 0, deck: [], table: [], alt: [], knocker: null, passes: 0, phase: '', round: 1, result: null, ev: null, evSeq: 0 };
    szStartRound(g, 0); return g;
  }
  const szActive = g => g.players.map((p, i) => i).filter(i => !g.players[i].out);
  function szNext(g, i) { let j = i; for (let k = 0; k < g.players.length; k++) { j = (j + 1) % g.players.length; if (!g.players[j].out) return j; } return i; }
  function szStartRound(g, dealer) {
    g.deck = makeDeck(); g.dealer = dealer; g.knocker = null; g.passes = 0; g.result = null; g.table = []; g.ev = null;
    for (const p of g.players) { p.hand = []; p.val = 0; p.lost = false; p.passed = false; }
    for (const i of szActive(g)) g.players[i].hand = g.deck.splice(0, 3);
    g.alt = g.deck.splice(0, 3);
    g.current = dealer; g.phase = 'dealer';
  }
  function szAdvance(g) {
    const next = szNext(g, g.current);
    if (g.knocker !== null && next === g.knocker) { szShowdown(g, 'klopf'); return; }
    g.current = next; g.phase = 'turn';
  }
  const szClearPasses = g => { g.passes = 0; for (const p of g.players) p.passed = false; };
  function szAfterMove(g) {
    szClearPasses(g); const v = handValue(g.players[g.current].hand);
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
    if (g.result.winner !== null) { grant(g, g.result.winner, 50, 'Schnauz gewonnen'); g.players.forEach((p, i) => { if (i !== g.result.winner) grant(g, i, 10, 'Schnauz mitgespielt'); }); }
    else if (g.result.draw) g.players.forEach((p, i) => grant(g, i, 10, 'Schnauz mitgespielt'));
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
        g.passes++; p.passed = true;
        if (g.passes >= szActive(g).length) { if (g.deck.length >= 3) { g.table = g.deck.splice(0, 3); szClearPasses(g); szEv(g, pi, 'newTable'); szAdvance(g); } else szShowdown(g, 'deck'); }
        else { szEv(g, pi, 'pass'); szAdvance(g); }
        return;
      }
      if (a === 'knock' && g.knocker === null) { g.knocker = pi; szClearPasses(g); szEv(g, pi, 'knock'); szAdvance(g); return; }
    }
    if (g.phase === 'roundEnd' && a === 'nextRound' && g.result && g.result.winner === null && !g.result.draw) { g.round++; szStartRound(g, szNext(g, g.dealer)); }
  }
  function szView(g, pi) {
    const open = g.phase === 'roundEnd';
    return {
      game: 'schnauz', round: g.round, deck: g.deck.length, dealer: g.dealer, current: g.current, knocker: g.knocker, phase: g.phase, me: pi, result: g.result, ev: g.ev,
      table: g.phase === 'dealer' ? null : g.table,
      players: g.players.map((p, i) => ({ name: p.name, lives: p.lives, swim: p.swim, out: p.out, lost: p.lost, passed: p.passed, val: open ? p.val : null, hand: (open || i === pi) ? p.hand : p.hand.length })),
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
      if (g.current === 0) { g.turn++; if (g.turn > 13) { g.phase = 'over'; const best = Math.max(...g.players.map(knTotal)); g.players.forEach((p, i) => grant(g, i, knTotal(p) === best ? 50 : 10, knTotal(p) === best ? 'Kniffel gewonnen' : 'Kniffel mitgespielt')); } }
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
    grant(g, winner, 15, 'Runde gewonnen');
    if (g.result.gameOver) { grant(g, winner, 50, 'Vier Farben gewonnen'); g.players.forEach((p, i) => { if (i !== winner) grant(g, i, 10, 'Vier Farben mitgespielt'); }); }
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

  /* ---- Black Jack (17 und 4) mit Spielgeld ---- */
  const BJSUITS = [{ s: '♠', red: false }, { s: '♥', red: true }, { s: '♦', red: true }, { s: '♣', red: false }];
  const BJRANKS = [['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['B', 10], ['D', 10], ['K', 10]];
  function bjDeck() { const d = []; for (let n = 0; n < 4; n++) for (const su of BJSUITS) for (const [r, v] of BJRANKS) d.push({ s: su.s, r, v, red: su.red }); return shuffle(d); }
  function bjValue(hand) {
    let sum = 0, aces = 0;
    for (const c of hand) { sum += c.v; if (c.r === 'A') aces++; }
    while (sum > 21 && aces > 0) { sum -= 10; aces--; }
    return sum;
  }
  function bjIsBlackjack(hand) { return hand.length === 2 && bjValue(hand) === 21; }
  function bjNew(names) {
    const g = { players: names.map(n => ({ name: n, chips: 1000, bet: 0, hand: [], done: false, result: null, bj: false })), dealer: { hand: [] }, deck: [], phase: 'bet', current: 0, round: 1, ev: null, evSeq: 0, msg: '' };
    return g;
  }
  function bjEv(g, type, extra) { g.ev = Object.assign({ seq: ++g.evSeq, type }, extra || {}); }
  function bjCanPlay(p) { return p.chips > 0 || p.bet > 0; }
  // Reihenfolge: nur Spieler, die mitspielen (Einsatz gesetzt)
  function bjDraw(g) { if (!g.deck.length) g.deck = bjDeck(); return g.deck.shift(); }
  function bjStartRound(g) {
    for (const p of g.players) { p.hand = []; p.done = false; p.result = null; p.bj = false; p.bet = 0; }
    g.dealer = { hand: [] }; g.deck = bjDeck(); g.phase = 'bet'; g.ev = null; g.msg = '';
    // Spieler ohne Chips sind raus
  }
  function bjActivePlayers(g) { return g.players.map((p, i) => i).filter(i => g.players[i].bet > 0); }
  function bjDeal(g) {
    const act = bjActivePlayers(g);
    for (const i of act) g.players[i].hand.push(bjDraw(g));
    g.dealer.hand.push(bjDraw(g));
    for (const i of act) g.players[i].hand.push(bjDraw(g));
    g.dealer.hand.push(bjDraw(g));
    for (const i of act) { const p = g.players[i]; if (bjIsBlackjack(p.hand)) { p.bj = true; p.done = true; } }
    g.phase = 'play';
    g.current = bjNextActive(g, -1);
    bjEv(g, 'deal');
    if (g.current === -1) bjDealerPlay(g);
  }
  function bjNextActive(g, from) {
    for (let i = from + 1; i < g.players.length; i++) if (g.players[i].bet > 0 && !g.players[i].done) return i;
    return -1;
  }
  function bjDealerPlay(g) {
    g.phase = 'dealer';
    // Nur ziehen, wenn mindestens ein Spieler noch im Rennen (nicht überkauft)
    const anyLive = bjActivePlayers(g).some(i => bjValue(g.players[i].hand) <= 21 && !g.players[i].bj);
    const anyBj = bjActivePlayers(g).some(i => g.players[i].bj);
    if (anyLive) { while (bjValue(g.dealer.hand) < 17) g.dealer.hand.push(bjDraw(g)); }
    else if (anyBj) { /* Bank deckt auf, prüft eigenen BJ */ }
    bjSettle(g);
  }
  function bjSettle(g) {
    const dv = bjValue(g.dealer.hand), dbj = bjIsBlackjack(g.dealer.hand);
    for (const i of bjActivePlayers(g)) {
      const p = g.players[i]; const pv = bjValue(p.hand);
      if (p.bj && !dbj) { p.result = 'bj'; p.chips += Math.floor(p.bet * 3 / 2); }
      else if (p.bj && dbj) { p.result = 'push'; }
      else if (pv > 21) { p.result = 'bust'; p.chips -= p.bet; }
      else if (dbj) { p.result = 'lose'; p.chips -= p.bet; }
      else if (dv > 21) { p.result = 'win'; p.chips += p.bet; }
      else if (pv > dv) { p.result = 'win'; p.chips += p.bet; }
      else if (pv < dv) { p.result = 'lose'; p.chips -= p.bet; }
      else { p.result = 'push'; }
      if (p.result === 'bj') grant(g, i, 20, 'Black Jack!'); else if (p.result === 'win') grant(g, i, 10, 'Bank geschlagen');
    }
    g.phase = 'result';
    bjEv(g, 'settle');
  }
  function bjAction(g, pi, a, d) {
    const p = g.players[pi];
    if (g.phase === 'bet') {
      if (a === 'bet') {
        let amt = Math.floor(+d.amount || 0);
        if (amt < 1 || amt > p.chips) return;
        p.bet = amt; bjEv(g, 'bet', { pi });
        // alle mit Chips haben gesetzt?
        const waiting = g.players.filter(x => x.chips > 0 && x.bet === 0);
        if (waiting.length === 0 && g.players.some(x => x.bet > 0)) bjDeal(g);
        return;
      }
      if (a === 'unbet') { p.bet = 0; return; }
      return;
    }
    if (g.phase === 'play' && g.current === pi && !p.done) {
      if (a === 'hit') {
        p.hand.push(bjDraw(g)); bjEv(g, 'hit', { pi });
        if (bjValue(p.hand) >= 21) { p.done = true; const nx = bjNextActive(g, pi); g.current = nx; if (nx === -1) bjDealerPlay(g); }
        return;
      }
      if (a === 'stand') {
        p.done = true; bjEv(g, 'stand', { pi });
        const nx = bjNextActive(g, pi); g.current = nx; if (nx === -1) bjDealerPlay(g);
        return;
      }
      if (a === 'double' && p.hand.length === 2 && p.chips >= p.bet * 2) {
        p.bet *= 2; p.hand.push(bjDraw(g)); p.done = true; bjEv(g, 'double', { pi });
        const nx = bjNextActive(g, pi); g.current = nx; if (nx === -1) bjDealerPlay(g);
        return;
      }
    }
    if (g.phase === 'result' && a === 'nextRound') {
      const withChips = g.players.filter(x => x.chips > 0).length;
      if (withChips >= 1) bjStartRound(g);
    }
  }
  function bjView(g, pi) {
    const reveal = g.phase === 'dealer' || g.phase === 'result';
    return {
      game: 'bj', me: pi, phase: g.phase, current: g.current, round: g.round, ev: g.ev,
      dealer: { hand: reveal ? g.dealer.hand : (g.dealer.hand.length ? [g.dealer.hand[0], { r: '?', s: '', hidden: true }] : []), val: reveal ? bjValue(g.dealer.hand) : null, bj: reveal && bjIsBlackjack(g.dealer.hand) },
      players: g.players.map((p, i) => ({ name: p.name, chips: p.chips, bet: p.bet, hand: p.hand, val: p.hand.length ? bjValue(p.hand) : 0, done: p.done, result: p.result, bj: p.bj, bust: bjValue(p.hand) > 21 })),
    };
  }

  /* ---- Räume ---- */
  function newGame(room) { const nm = room.players.map(x => x.name); const st = room.game === 'schnauz' ? szNew(nm) : room.game === 'uno' ? unoNew(nm, room.variant === 'extreme') : room.game === 'bj' ? bjNew(nm) : knNew(nm); st.gid = room.code + '-' + Math.random().toString(36).slice(2, 8); st.awards = []; st.awardSeq = 0; return st; }
  function roomView(room, pid) {
    const pi = room.players.findIndex(p => p.id === pid);
    const base = { code: room.code, me: pi, isHost: room.host === pid, phase: room.phase, urls: lanUrls(), players: room.players.map(p => ({ name: p.name, connected: p.streams.length > 0, host: p.id === room.host })), game: room.game, variant: room.variant || 'classic', online: !!room.online, awards: (room.state && room.state.awards) || [] };
    if (room.phase === 'playing') base.view = room.game === 'schnauz' ? szView(room.state, pi) : room.game === 'uno' ? unoView(room.state, pi) : room.game === 'bj' ? bjView(room.state, pi) : knView(room.state, pi);
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
      if (a === 'setGame' && room.host === p.id && (d.g === 'schnauz' || d.g === 'kniffel' || d.g === 'uno' || d.g === 'bj')) room.game = d.g;
      if (a === 'setVariant' && room.host === p.id && (d.v === 'classic' || d.v === 'extreme')) room.variant = d.v;
      if (a === 'start' && room.host === p.id) {
        const n = room.players.length; const min = (room.game === 'kniffel' || room.game === 'bj') ? 1 : 2;
        if (n >= min && n <= 4) { room.state = newGame(room); room.phase = 'playing'; }
      }
      if (a === 'leave') { room.players.splice(pi, 1); if (room.host === p.id && room.players[0]) room.host = room.players[0].id; }
      if (a === 'kick' && room.host === p.id) { const t = room.players[+d.i]; if (t && t.id !== room.host && t.streams.length === 0) room.players.splice(+d.i, 1); }
      return;
    }
    if (a === 'backToLobby' && room.host === p.id) { room.phase = 'lobby'; room.state = null; return; }
    if (a === 'rematch' && room.host === p.id) { room.state = newGame(room); return; }
    if (a === 'nextRound' && room.host !== p.id) return;
    if (room.game === 'schnauz') szAction(room.state, pi, a, d);
    else if (room.game === 'uno') unoAction(room.state, pi, a, d);
  else if (room.game === 'bj') bjAction(room.state, pi, a, d);
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
      const name = cleanName(b.name);
      // Gleicher Name, aber nicht verbunden (z. B. Beitritt ohne Antwort): Platz übernehmen statt Geist anlegen
      const ghost = room.players.find(p => p.name === name && p.id !== room.host && p.streams.length === 0);
      if (ghost) { ghost.token = uid(); broadcast(room); return [200, { code: room.code, pid: ghost.id, token: ghost.token }]; }
      if (room.players.length >= 4) {
        const gi = room.players.findIndex(p => p.id !== room.host && p.streams.length === 0);
        if (gi < 0) return [409, { error: 'Der Tisch ist voll (4 Spieler).' }];
        room.players.splice(gi, 1);
      }
      const p = { id: uid(), token: uid(), name, streams: [] };
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
