// Simulation checks: every dealt hand must be solvable (verified by an
// independent exhaustive solver), plus stats on modes, timing and game length.
const E = require('../src/engine.js');
const P = E.PIECES;

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Exhaustive, unbounded: is there any order/positions placing all pieces?
function solvableExact(b, ids) {
  if (!ids.length) return true;
  const seen = new Set();
  for (let i = 0; i < ids.length; i++) {
    if (seen.has(ids[i])) continue; seen.add(ids[i]);
    const p = P[ids[i]], rest = ids.filter((_, j) => j !== i);
    for (let r = 0; r + p.h <= 8; r++) for (let c = 0; c + p.w <= 8; c++)
      if (E.canPlace(b, p, r, c) && solvableExact(E.applyPlace(b, p, r, c).board, rest)) return true;
  }
  return false;
}

// Bots choose the next single placement.
const bots = {
  random(g, rand) {
    const opts = [];
    g.hand.forEach((id, s) => { if (id == null) return; const p = P[id];
      for (let r = 0; r + p.h <= 8; r++) for (let c = 0; c + p.w <= 8; c++) if (E.canPlace(g.board, p, r, c)) opts.push([s, r, c]); });
    return opts[Math.floor(rand() * opts.length)];
  },
  // Plans the whole hand: best sequence by lines cleared then emptiness.
  planner(g) {
    let best = null;
    const rec = (b, slots, lines, first) => {
      if (!slots.length) { const v = lines * 10 - E.countCells(b); if (!best || v > best.v) best = { v, first }; return; }
      for (const s of slots) { const p = P[g.hand[s]]; const rest = slots.filter(x => x !== s);
        const opts = [];
        for (let r = 0; r + p.h <= 8; r++) for (let c = 0; c + p.w <= 8; c++) if (E.canPlace(b, p, r, c)) { const o = E.applyPlace(b, p, r, c); opts.push([o, r, c]); }
        opts.sort((x, y) => y[0].lines - x[0].lines);
        for (const [o, r, c] of opts.slice(0, slots.length === 3 ? 10 : 5)) rec(o.board, rest, lines + o.lines, first || [s, r, c]);
      }
    };
    rec(g.board, [0, 1, 2].filter(s => g.hand[s] != null), 0, null);
    return best ? best.first : bots.random(g, Math.random);
  },
};

function run(botName, games, maxHands, seed) {
  const rand = mulberry(seed), bot = bots[botName];
  const modes = {}; let hands = 0, unsolv = 0, allClears = 0, wipeOffers = 0, dealMs = 0, maxMs = 0, scores = [], lens = [], blockedHands = 0;
  for (let k = 0; k < games; k++) {
    const g = E.newGame(rand);
    let checked = 0;
    while (!g.over && g.hands <= maxHands) {
      if (g.hand.every(x => x != null) && checked !== g.hands) { // fresh hand
        checked = g.hands; hands++;
        modes[g.lastMode] = (modes[g.lastMode] || 0) + 1;
        if (!solvableExact(g.board, g.hand)) unsolv++;
        if (g.hand.some(id => !E.hasPlacement(g.board, P[id]))) blockedHands++;
        if (g.wipeOffered) wipeOffers++;
      }
      const mv = bot(g, rand);
      if (!mv) { console.log('bot found no move but game not over?!'); break; }
      const t = performance.now();
      const res = E.place(g, mv[0], mv[1], mv[2], rand);
      const dt = performance.now() - t; if (res.dealt) { dealMs += dt; maxMs = Math.max(maxMs, dt); }
      if (res.allClear) allClears++;
    }
    scores.push(g.score); lens.push(g.hands);
  }
  const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  console.log(`\n[${botName}] games=${games} hands=${hands}`);
  console.log('  unsolvable hands dealt:', unsolv);
  console.log('  modes:', modes);
  console.log('  hands with a blocked piece:', blockedHands, ' wipe offered:', wipeOffers, ' wipes achieved:', allClears);
  console.log('  avg hands/game:', avg(lens), 'max:', Math.max(...lens), ' avg score:', avg(scores));
  console.log('  deal ms avg:', (dealMs / hands).toFixed(1), 'max:', maxMs.toFixed(0));
  return unsolv;
}

let bad = 0;
bad += run('random', 150, 400, 1);
bad += run('planner', 12, 250, 2);
console.log(bad ? '\nFAIL' : '\nOK: every dealt hand was solvable');
process.exit(bad ? 1 : 0);
