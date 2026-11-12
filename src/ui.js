/* Touch UI for the block game. Depends on the global Engine. */
(() => {
  const E = Engine, N = E.N, P = E.PIECES, KEY = 'blockgame.v1';
  const $ = id => document.getElementById(id);
  const app = $('app'), boardEl = $('board'), wrap = $('boardWrap'), trayEl = $('tray');
  const scoreEl = $('score'), bestEl = $('best'), streakEl = $('streak');
  const overEl = $('over'), confirmEl = $('confirm');
  const cells = [];
  let g, best = 0, S = 40, G = 3, drag = null, busy = false, shownScore = 0;
  // Touch reach: the piece travels this many times further than your thumb,
  // so one thumb can cover the whole board. 1 = piece follows the finger exactly.
  const REACH = 1.8;

  // ---- storage (best effort: the game runs fine without it) ----------------
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) {} };
  const snapshot = () => ({ g, best });
  const validGame = x => x && Array.isArray(x.board) && x.board.length === N && Array.isArray(x.hand) && x.hand.length === 3
    && x.hand.every(i => i == null || P[i]) && x.phase && typeof x.score === 'number';

  // ---- layout -------------------------------------------------------------
  function layout() {
    const cs = getComputedStyle(app);
    const W = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fixedW = 7 * G + 12, fixedH = 64 /*bar*/ + 36 /*gaps*/ + 7 * G + 12 + 18 /*tray pad*/;
    S = Math.max(18, Math.min(64, Math.floor(Math.min((W - fixedW) / 8, (H - fixedH) / (8 + 5 * 0.48)))));
    const root = document.documentElement.style;
    root.setProperty('--s', S + 'px');
    root.setProperty('--ts', Math.floor(S * 0.48) + 'px');
  }

  // ---- rendering ----------------------------------------------------------
  function buildBoard() {
    for (let i = 0; i < N * N; i++) { const d = document.createElement('div'); d.className = 'cell'; boardEl.appendChild(d); cells.push(d); }
  }
  const has = (r, c) => (g.board[r] >> c) & 1;
  function renderBoard() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const el = cells[r * N + c];
      el.classList.toggle('on', !!has(r, c));
      el.classList.remove('ghost', 'hot');
    }
  }
  function pieceEl(p, cls) {
    const d = document.createElement('div');
    d.className = 'piece ' + (cls || '');
    d.style.gridTemplateColumns = `repeat(${p.w}, var(--pc))`;
    for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) {
      const i = document.createElement('i');
      if (!((p.masks[r] >> c) & 1)) i.className = 'off';
      d.appendChild(i);
    }
    return d;
  }
  function renderTray(fresh) {
    [...trayEl.children].forEach((slot, s) => {
      slot.innerHTML = '';
      slot.className = 'slot';
      const id = g.hand[s];
      if (id == null) return;
      slot.appendChild(pieceEl(P[id]));
      if (fresh) slot.classList.add('fresh');
      if (!E.hasPlacement(g.board, P[id])) slot.classList.add('stuck');
    });
  }
  function renderScore(animate) {
    const target = g.score;
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { shownScore = target; scoreEl.textContent = target; }
    else {
      const from = shownScore, t0 = performance.now(), dur = 320;
      const step = t => { const k = Math.min(1, (t - t0) / dur); shownScore = Math.round(from + (target - from) * k); scoreEl.textContent = shownScore; if (k < 1 && g.score === target) requestAnimationFrame(step); else { shownScore = g.score; scoreEl.textContent = g.score; } };
      requestAnimationFrame(step);
    }
    if (g.score > best) best = g.score;
    bestEl.textContent = best;
    streakEl.textContent = 'Streak ×' + g.combo;
    streakEl.classList.toggle('on', g.combo > 1);
  }
  function renderAll(fresh) { renderBoard(); renderTray(fresh); renderScore(false); overEl.hidden = !g.over; if (g.over) fillOver(); }

  // ---- feedback -----------------------------------------------------------
  function floatText(text, r, c) {
    const d = document.createElement('div'); d.className = 'float'; d.textContent = text;
    const pitch = S + G;
    d.style.left = (6 + c * pitch) + 'px'; d.style.top = (6 + r * pitch) + 'px';
    wrap.appendChild(d); d.addEventListener('animationend', () => d.remove());
  }
  function toast(title, sub) {
    wrap.querySelectorAll('.toast').forEach(t => t.remove());
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = title;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; d.appendChild(s); }
    wrap.appendChild(d); d.addEventListener('animationend', () => d.remove());
  }
  function fillOver() {
    $('overScore').textContent = g.score;
    $('overNote').textContent = g.score >= best && g.score > 0 ? 'New best' : 'Best ' + best;
  }

  // ---- dragging -----------------------------------------------------------
  function targetFor(x, y) {
    // x, y: top-left of the dragged piece in page coordinates
    const b = boardEl.getBoundingClientRect(), pitch = S + G;
    const fc = (x - b.left - 6) / pitch, fr = (y - b.top - 6) / pitch;
    const p = drag.p, r0 = Math.round(fr), c0 = Math.round(fc);
    if (E.canPlace(g.board, p, r0, c0)) return [r0, c0];
    // Forgive near misses: snap to an adjacent valid spot if it is close enough.
    let bestT = null, bestD = 0.75;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (!E.canPlace(g.board, p, r, c)) continue;
      const d = Math.hypot(r - fr, c - fc);
      if (d < bestD) { bestD = d; bestT = [r, c]; }
    }
    return bestT;
  }
  function showPreview(t) {
    const key = t ? t[0] * N + t[1] : -1;
    if (drag.key === key) return;
    drag.key = key; drag.target = t;
    for (const el of cells) el.classList.remove('ghost', 'hot');
    if (!t) return;
    const filled = g.board.slice(), p = drag.p;
    for (let i = 0; i < p.h; i++) filled[t[0] + i] |= p.masks[i] << t[1];
    for (const [r, c] of p.cells) cells[(t[0] + r) * N + t[1] + c].classList.add('ghost');
    const { rows, cols } = E.fullLines(filled);
    for (const r of rows) for (let c = 0; c < N; c++) cells[r * N + c].classList.add('hot');
    for (const c of cols) for (let r = 0; r < N; r++) cells[r * N + c].classList.add('hot');
  }
  function moveDrag(e) {
    const a = app.getBoundingClientRect(), p = drag.p, pitch = S + G;
    const w = p.w * pitch - G, h = p.h * pitch - G;
    let x, y;
    if (drag.touch) {
      // Start just above the thumb, then amplify movement from where the drag began.
      x = drag.x0 + (e.clientX - drag.x0) * REACH - w / 2;
      y = drag.y0 + (e.clientY - drag.y0) * REACH - h - Math.max(46, S * 1.3);
      x = Math.max(a.left - w / 2, Math.min(a.right - w / 2, x));
      y = Math.max(a.top - h / 2, Math.min(a.bottom - h / 2, y));
    } else { x = e.clientX - w / 2; y = e.clientY - h / 2; }
    drag.el.style.transform = `translate(${x - a.left}px, ${y - a.top}px)`;
    showPreview(targetFor(x, y));
  }
  function startDrag(e, slot, s) {
    if (drag || busy || g.over || g.hand[s] == null || (e.button != null && e.button > 0)) return;
    e.preventDefault();
    const p = P[g.hand[s]];
    const el = pieceEl(p, 'drag');
    el.style.gridTemplateColumns = `repeat(${p.w}, var(--pc))`;
    app.appendChild(el);
    drag = { s, p, el, slot, id: e.pointerId, touch: e.pointerType !== 'mouse', key: -2, target: null, x0: e.clientX, y0: e.clientY };
    slot.classList.add('lifted');
    try { slot.setPointerCapture(e.pointerId); } catch (err) {}
    moveDrag(e);
  }
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    for (const el of cells) el.classList.remove('ghost', 'hot');
    if (!cancelled && d.target) { d.el.remove(); commit(d.s, d.target[0], d.target[1]); return; }
    // Send it back to the tray.
    const a = app.getBoundingClientRect(), sr = d.slot.getBoundingClientRect();
    d.el.classList.add('home');
    d.el.style.transform = `translate(${sr.left - a.left + sr.width / 2 - d.el.offsetWidth / 2}px, ${sr.top - a.top + sr.height / 2 - d.el.offsetHeight / 2}px) scale(.48)`;
    setTimeout(() => { d.el.remove(); d.slot.classList.remove('lifted'); }, 170);
  }

  // ---- moves --------------------------------------------------------------
  function commit(s, r, c) {
    const res = E.place(g, s, r, c, Math.random, true);
    if (!res) { renderTray(); return; }
    renderBoard();
    for (const [pr, pc] of res.piece.cells) {
      const el = cells[(r + pr) * N + c + pc];
      el.classList.add('pop'); el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
    }
    const clearing = new Set();
    for (const rr of res.rows) for (let cc = 0; cc < N; cc++) clearing.add(rr * N + cc);
    for (const cc of res.cols) for (let rr = 0; rr < N; rr++) clearing.add(rr * N + cc);
    for (const i of clearing) {
      const el = cells[i];
      el.classList.remove('pop'); el.classList.add('clearing');
      el.addEventListener('animationend', () => el.classList.remove('clearing'), { once: true });
    }
    floatText('+' + res.gained, r + res.piece.h / 2, c + res.piece.w / 2);
    if (res.allClear) toast('Board cleared', '+' + E.ALL_CLEAR_BONUS + ' bonus');
    else if (res.lines > 1) toast(res.lines + ' lines');
    renderScore(true);
    if (res.needsDeal) {
      // Pick the next hand after the drop has painted, so the drop never stutters.
      busy = true; renderTray();
      setTimeout(() => { E.dealNow(g); busy = false; renderTray(true); settle(); }, 60);
    } else { renderTray(); settle(); }
  }
  function settle() {
    save();
    if (g.over) setTimeout(() => { if (g.over) { fillOver(); overEl.hidden = false; } }, 650);
  }
  function restart() {
    confirmEl.hidden = true; overEl.hidden = true;
    g = E.newGame(); shownScore = 0;
    renderAll(true); save();
  }

  // ---- boot ---------------------------------------------------------------
  function start(data) {
    const saved = data && data.g ? data : load();
    best = Math.max(0, +saved.best || 0);
    g = validGame(saved.g) ? saved.g : E.newGame();
    buildBoard(); layout(); renderAll(true);
    [...trayEl.children].forEach((slot, s) => {
      slot.addEventListener('pointerdown', e => startDrag(e, slot, s));
      slot.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) moveDrag(e); });
      slot.addEventListener('pointerup', e => endDrag(e, false));
      slot.addEventListener('pointercancel', e => endDrag(e, true));
    });
    $('restart').addEventListener('click', () => { if (g.score > 0 && !g.over) confirmEl.hidden = false; else restart(); });
    $('confirmYes').addEventListener('click', restart);
    $('confirmNo').addEventListener('click', () => { confirmEl.hidden = true; });
    $('again').addEventListener('click', restart);
    addEventListener('resize', layout);
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    window.claude?.hot?.snapshot?.(snapshot);
    window.__game = () => g; // handy for debugging from the console
  }
  if (window.claude?.hot?.ready) window.claude.hot.ready(start); else start(window.claude?.hot?.data ?? {});
})();
