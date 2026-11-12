/* Block game engine: board, pieces, scoring, and the hand "director".
   No DOM access here, so it runs in Node for tests as well as in the page. */
const Engine = (() => {
  const N = 8, FULL = 255;

  // ---- pieces -------------------------------------------------------------
  const DEFS = [
    ['dot', ['#']],
    ['i2', ['##']], ['i2', ['#', '#']],
    ['i3', ['###']], ['i3', ['#', '#', '#']],
    ['i4', ['####']], ['i4', ['#', '#', '#', '#']],
    ['i5', ['#####']], ['i5', ['#', '#', '#', '#', '#']],
    ['o2', ['##', '##']],
    ['o3', ['###', '###', '###']],
    ['r23', ['###', '###']], ['r23', ['##', '##', '##']],
    ['c2', ['##', '#.']], ['c2', ['##', '.#']], ['c2', ['#.', '##']], ['c2', ['.#', '##']],
    ['c3', ['###', '#..', '#..']], ['c3', ['###', '..#', '..#']],
    ['c3', ['#..', '#..', '###']], ['c3', ['..#', '..#', '###']],
    ['l4', ['#.', '#.', '##']], ['l4', ['.#', '.#', '##']], ['l4', ['##', '#.', '#.']], ['l4', ['##', '.#', '.#']],
    ['l4', ['###', '#..']], ['l4', ['###', '..#']], ['l4', ['#..', '###']], ['l4', ['..#', '###']],
    ['t4', ['###', '.#.']], ['t4', ['.#.', '###']], ['t4', ['#.', '##', '#.']], ['t4', ['.#', '##', '.#']],
    ['s4', ['.##', '##.']], ['s4', ['##.', '.##']], ['s4', ['#.', '##', '.#']], ['s4', ['.#', '##', '#.']],
    ['d2', ['#.', '.#']], ['d2', ['.#', '#.']],
    ['d3', ['#..', '.#.', '..#']], ['d3', ['..#', '.#.', '#..']],
  ];
  const PIECES = DEFS.map(([family, rows], id) => {
    const masks = rows.map(s => [...s].reduce((m, ch, c) => m | (ch === '#' ? 1 << c : 0), 0));
    const cells = [];
    rows.forEach((s, r) => [...s].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
    return { id, family, masks, cells, h: rows.length, w: rows[0].length, n: cells.length };
  });

  // How often each family shows up in each mode (per orientation).
  const WEIGHTS = {
    breeze:  { dot: 0, i2: 5, i3: 6, i4: 4, i5: 2, o2: 9, o3: 2, r23: 4, c2: 3, c3: 1, l4: 1.5, t4: 2, s4: 1, d2: 1, d3: 0.3 },
    awkward: { dot: 0, i2: 0.5, i3: 2, i4: 5, i5: 6, o2: 2, o3: 9, r23: 6, c2: 1, c3: 3, l4: 1, t4: 1.5, s4: 2, d2: 2.5, d3: 3 },
    puzzle:  { dot: 0, i2: 2, i3: 4, i4: 5, i5: 5, o2: 5, o3: 6, r23: 5, c2: 2, c3: 2, l4: 1.2, t4: 2, s4: 1.5, d2: 1, d3: 1 },
    rescue:  { dot: 3, i2: 6, i3: 3, i4: 0, i5: 0, o2: 2, o3: 0, r23: 0, c2: 2, c3: 0, l4: 0, t4: 0, s4: 0, d2: 1, d3: 0 },
  };

  // ---- board primitives (board = array of 8 row bitmasks) ------------------
  const pop8 = new Uint8Array(256);
  for (let i = 1; i < 256; i++) pop8[i] = pop8[i >> 1] + (i & 1);
  const emptyBoard = () => [0, 0, 0, 0, 0, 0, 0, 0];
  const countCells = b => { let s = 0; for (let r = 0; r < N; r++) s += pop8[b[r]]; return s; };
  const isEmpty = b => { for (let r = 0; r < N; r++) if (b[r]) return false; return true; };

  function canPlace(b, p, r, c) {
    if (r < 0 || c < 0 || r + p.h > N || c + p.w > N) return false;
    for (let i = 0; i < p.h; i++) if (b[r + i] & (p.masks[i] << c)) return false;
    return true;
  }
  function hasPlacement(b, p) {
    for (let r = 0; r + p.h <= N; r++) for (let c = 0; c + p.w <= N; c++) if (canPlace(b, p, r, c)) return true;
    return false;
  }
  function countPlacements(b, p) {
    let k = 0;
    for (let r = 0; r + p.h <= N; r++) for (let c = 0; c + p.w <= N; c++) if (canPlace(b, p, r, c)) k++;
    return k;
  }
  // Lines a board (after a placement, before clearing) has completed.
  function fullLines(b) {
    const rows = []; let colMask = FULL;
    for (let r = 0; r < N; r++) { if (b[r] === FULL) rows.push(r); colMask &= b[r]; }
    const cols = [];
    for (let c = 0; c < N; c++) if (colMask & (1 << c)) cols.push(c);
    return { rows, cols, colMask };
  }
  // Returns the new board and the number of lines cleared. Does not mutate b.
  function applyPlace(b, p, r, c) {
    const nb = b.slice();
    for (let i = 0; i < p.h; i++) nb[r + i] |= p.masks[i] << c;
    let colMask = FULL, lines = 0;
    for (let i = 0; i < N; i++) colMask &= nb[i];
    for (let i = 0; i < N; i++) if (nb[i] === FULL) { nb[i] = 0; lines++; }
    if (colMask) { lines += pop8[colMask]; const keep = ~colMask & FULL; for (let i = 0; i < N; i++) nb[i] &= keep; }
    return { board: nb, lines };
  }

  // ---- solver -------------------------------------------------------------
  // Bounded search over every order and position for a hand. Line-clearing
  // placements are tried first, which finds answers fast on crowded boards.
  function analyze(board, hand, budget = 4000, solutionCap = 10) {
    let nodes = 0, solutions = 0, bestLines = 0, minCells = 99, allClear = false;
    const rec = (b, rem, lines, emptied) => {
      if (!rem.length) {
        solutions++;
        if (lines > bestLines) bestLines = lines;
        const k = countCells(b); if (k < minCells) minCells = k;
        if (emptied) allClear = true;
        return;
      }
      const seen = new Set();
      for (let i = 0; i < rem.length; i++) {
        const p = rem[i];
        if (seen.has(p.id)) continue; seen.add(p.id);
        const rest = rem.filter((_, j) => j !== i);
        const opts = [];
        for (let r = 0; r + p.h <= N; r++) for (let c = 0; c + p.w <= N; c++)
          if (canPlace(b, p, r, c)) opts.push(applyPlace(b, p, r, c));
        opts.sort((x, y) => y.lines - x.lines);
        for (const o of opts) {
          if (nodes++ >= budget || solutions >= solutionCap) return;
          rec(o.board, rest, lines + o.lines, emptied || isEmpty(o.board));
        }
      }
    };
    rec(board, hand, 0, false);
    return { solvable: solutions > 0, solutions, bestLines, minCells, allClear, nodes };
  }

  // Looks for up to three pieces that wipe the board using clearing moves only.
  function findAllClears(board, rand, maxNodes = 150000, cap = 6) {
    const found = []; let nodes = 0;
    const pool = PIECES.filter(p => p.family !== 'dot');
    const gaps = b => {
      let rg = 0, colAny = 0;
      for (let r = 0; r < N; r++) { if (b[r]) rg += N - pop8[b[r]]; colAny |= b[r]; }
      let cg = 0;
      for (let c = 0; c < N; c++) if (colAny & (1 << c)) for (let r = 0; r < N; r++) if (!(b[r] & (1 << c))) cg++;
      return [rg, cg];
    };
    const seenKey = new Set();
    const rec = (b, seq) => {
      const left = 3 - seq.length;
      const [rg, cg] = gaps(b);
      if (Math.min(rg, cg) > 9 * left) return;
      const order = shuffle(pool.slice(), rand);
      for (const p of order) {
        // The last piece has to fill the remaining gaps exactly.
        if (left === 1 && p.n !== rg && p.n !== cg) continue;
        for (let r = 0; r + p.h <= N; r++) for (let c = 0; c + p.w <= N; c++) {
          if (!canPlace(b, p, r, c)) continue;
          if (nodes++ > maxNodes || found.length >= cap) return;
          const o = applyPlace(b, p, r, c);
          if (isEmpty(o.board)) {
            const s2 = seq.concat(p), key = s2.map(x => x.id).sort().join();
            if (!seenKey.has(key)) { seenKey.add(key); found.push(s2); }
            break;
          }
          if (left === 1) continue;
          if (!o.lines) { // a setup move must sit entirely in gaps of lines already in play
            const [rg2, cg2] = gaps(o.board);
            if (rg2 !== rg - p.n && cg2 !== cg - p.n) continue;
          }
          rec(o.board, seq.concat(p));
        }
      }
    };
    if (!isEmpty(board)) rec(board, []);
    return found;
  }

  // ---- hand generation ----------------------------------------------------
  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function sampler(weights, rand) {
    const items = PIECES.filter(p => weights[p.family] > 0);
    const w = items.map(p => weights[p.family]);
    const total = w.reduce((a, x) => a + x, 0);
    return () => { let t = rand() * total; for (let i = 0; i < items.length; i++) { t -= w[i]; if (t <= 0) return items[i]; } return items[items.length - 1]; };
  }
  function sampleHand(pick, rand) {
    for (;;) {
      const h = [pick(), pick(), pick()];
      if (h[0].id === h[1].id && h[1].id === h[2].id) continue;
      const dup = h[0].id === h[1].id || h[1].id === h[2].id || h[0].id === h[2].id;
      if (dup && rand() < 0.6) continue;
      return h;
    }
  }
  function candidates(board, mode, count, rand, budget = 4000, cap = 10) {
    const pick = sampler(WEIGHTS[mode], rand), out = [];
    for (let i = 0; i < count; i++) {
      const hand = sampleHand(pick, rand);
      const fits = hand.map(p => countPlacements(board, p));
      const a = analyze(board, hand, budget, cap);
      if (a.solvable) out.push({ hand, fits, blocked: fits.filter(f => f === 0).length, minFit: Math.min(...fits), a });
    }
    return out;
  }
  const pickTop = (list, score, rand, top = 3) => {
    const s = list.map(x => ({ x, s: score(x) })).sort((p, q) => q.s - p.s);
    return s[Math.floor(rand() * Math.min(top, s.length))].x;
  };

  const MODES = {
    // Roomy pieces with plenty of places to go.
    breeze(board, rand) {
      const c = candidates(board, 'breeze', 14, rand).filter(x => x.blocked === 0);
      return c.length ? pickTop(c, x => Math.min(x.minFit, 12) + 2 * x.a.bestLines + rand() * 4, rand, 4).hand : null;
    },
    // A hand that can wipe the board, or failing that, clear a lot of it.
    wipe(board, rand) {
      const wipes = findAllClears(board, rand);
      if (!wipes.length) return null;
      const seq = wipes[Math.floor(rand() * wipes.length)].slice();
      const pick = sampler(WEIGHTS.breeze, rand);
      while (seq.length < 3) seq.push(pick());
      seq.wipe = true;
      return seq;
    },
    clear(board, rand) {
      const w = MODES.wipe(board, rand);
      if (w) return w;
      // No wipe in reach yet: deal whatever lets the board get emptiest, to set one up.
      const c = candidates(board, 'breeze', 22, rand, 5000, 60).concat(candidates(board, 'puzzle', 10, rand, 5000, 60));
      return c.length ? pickTop(c, x => x.a.bestLines - x.a.minCells, rand, 2).hand : null;
    },
    // At least one piece has nowhere to go until the others clear space.
    puzzle(board, rand) {
      const c = candidates(board, 'puzzle', 40, rand);
      const forced = c.filter(x => x.blocked > 0);
      if (forced.length) return pickTop(forced, x => x.blocked * 3 - x.a.solutions * 0.2 + rand() * 2, rand, 3).hand;
      const tight = c.filter(x => x.minFit <= 4);
      return tight.length ? pickTop(tight, x => -x.minFit - x.a.solutions * 0.1 + rand(), rand, 3).hand : null;
    },
    // Bulky, clumsy shapes that all fit but leave the board lumpy.
    awkward(board, rand) {
      const c = candidates(board, 'awkward', 20, rand).filter(x => x.blocked === 0);
      return c.length ? pickTop(c, x => -x.a.bestLines * 2 - Math.min(x.minFit, 20) * 0.3 + x.hand.reduce((s, p) => s + p.n, 0) * 0.5 + rand() * 3, rand, 4).hand : null;
    },
  };

  function choosePhase(board, score, prev, rand) {
    const fill = countCells(board) / 64;
    const heat = Math.min(1, score / 4000); // later in a run, lean harder
    let w;
    if (fill < 0.28) w = { breeze: 45, awkward: 35, clear: 20, puzzle: 0 };
    else if (fill < 0.52) w = { breeze: 30, awkward: 24, clear: 20, puzzle: 26 };
    else w = { breeze: 26, awkward: 8, clear: 30, puzzle: 36 };
    w.breeze *= 1 - 0.35 * heat; w.puzzle *= 1 + 0.4 * heat; w.awkward *= 1 + 0.3 * heat;
    if (prev) w[prev] = 0;
    if (fill > 0 && fill < 0.25) w.clear *= 2; // a tidy board is a chance at a wipe
    const total = Object.values(w).reduce((a, x) => a + x, 0);
    let t = rand() * total, mode = 'breeze';
    for (const k in w) { t -= w[k]; if (t <= 0) { mode = k; break; } }
    const len = mode === 'clear' ? 3 : 2 + Math.floor(rand() * 3);
    return { mode, left: len };
  }

  // Always returns a hand that can be fully placed on this board.
  function dealHand(board, phase, rand) {
    const order = [phase.mode, 'breeze', 'puzzle'];
    // Outside the clear phase, a wipe that happens to be in reach is still offered most of the time.
    if (phase.mode !== 'clear' && rand() < 0.6) order.unshift('wipe');
    for (const m of order) {
      const hand = MODES[m](board, rand);
      if (hand) return { hand: shuffle(hand.slice(), rand), mode: hand.wipe ? 'clear' : m, wipe: !!hand.wipe };
    }
    const pick = sampler(WEIGHTS.rescue, rand);
    for (let i = 0; i < 60; i++) {
      const hand = sampleHand(pick, rand);
      if (analyze(board, hand, 30000, 1).solvable) return { hand, mode: 'rescue' };
    }
    // Three single cells always fit: no row is ever full, so 8+ cells are free.
    return { hand: [PIECES[0], PIECES[0], PIECES[0]], mode: 'rescue' };
  }

  // ---- game ---------------------------------------------------------------
  const ALL_CLEAR_BONUS = 300;

  function newGame(rand = Math.random) {
    const g = { board: emptyBoard(), hand: [null, null, null], score: 0, combo: 0, dry: 0, over: false,
                phase: { mode: 'breeze', left: 2 }, lastMode: 'breeze', hands: 0 };
    deal(g, rand);
    return g;
  }
  function deal(g, rand = Math.random) {
    if (g.phase.left <= 0) g.phase = choosePhase(g.board, g.score, g.phase.mode, rand);
    const d = dealHand(g.board, g.phase, rand);
    g.phase.left--; g.hands++;
    if (d.wipe) g.phase.left = 0; // the clear phase ends once a wipe has been offered
    g.hand = d.hand.map(p => p.id);
    g.lastMode = d.mode; g.wipeOffered = d.wipe;
  }
  const slotFits = (g, slot) => g.hand[slot] != null && hasPlacement(g.board, PIECES[g.hand[slot]]);

  function place(g, slot, r, c, rand = Math.random, deferDeal = false) {
    const p = PIECES[g.hand[slot]];
    if (g.over || !p || !canPlace(g.board, p, r, c)) return null;
    const filled = g.board.slice();
    for (let i = 0; i < p.h; i++) filled[r + i] |= p.masks[i] << c;
    const { rows, cols } = fullLines(filled);
    const o = applyPlace(g.board, p, r, c);
    g.board = o.board; g.hand[slot] = null;
    let gained = p.n, lineScore = 0;
    if (o.lines) {
      g.combo++; g.dry = 0;
      lineScore = 10 * o.lines * (o.lines + 1) / 2 * g.combo;
    } else if (++g.dry >= 3) g.combo = 0;
    const allClear = o.lines > 0 && isEmpty(g.board);
    gained += lineScore + (allClear ? ALL_CLEAR_BONUS : 0);
    g.score += gained;
    let dealt = false, needsDeal = false;
    if (g.hand.every(x => x == null)) {
      if (deferDeal) needsDeal = true; else { deal(g, rand); dealt = true; }
    }
    g.over = !needsDeal && ![0, 1, 2].some(s => slotFits(g, s));
    return { piece: p, r, c, rows, cols, lines: o.lines, gained, combo: o.lines ? g.combo : 0, allClear, dealt, needsDeal, over: g.over };
  }
  // Second half of a deferred deal (lets the UI paint the drop first).
  function dealNow(g, rand = Math.random) {
    if (g.hand.every(x => x == null)) deal(g, rand);
    g.over = ![0, 1, 2].some(s => slotFits(g, s));
  }

  return { N, PIECES, emptyBoard, canPlace, hasPlacement, countPlacements, applyPlace, fullLines, countCells, isEmpty,
           analyze, findAllClears, dealHand, choosePhase, newGame, deal, dealNow, place, slotFits, ALL_CLEAR_BONUS };
})();
if (typeof module !== 'undefined') module.exports = Engine;
