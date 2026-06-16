<script lang="ts">
  import { tick } from 'svelte';
  import { parsePuzzle, validateSolution, UNKNOWN, BLACK, WHITE } from './lib/puzzle';
  import type { Grid } from './lib/puzzle';
  import { Solver } from './lib/solver';

  let puzzleText = '';
  let solverWorker: Worker | null = null;

  function getWorker(): Worker {
    solverWorker?.terminate();
    solverWorker = new Worker(
      new URL('./lib/solver.worker.ts', import.meta.url),
      { type: 'module' }
    );
    return solverWorker;
  }

  let grid      = $state<Grid | null>(null);
  let origGrid  = $state<Grid | null>(null);
  let status    = $state('Load a puzzle to begin');
  let timer     = $state('');
  let hintKey   = $state<string | null>(null);
  let errors    = $state(new Set<string>());
  let showPaste = $state(false);
  let pasteText = $state('');
  let speed     = $state(5);

  type Step = { cells: number[]; islandId: number[]; rule: string };
  let steps     = $state<Step[]>([]);
  let stepIdx   = $state(0);
  let playing   = $state(false);
  let playTimer: ReturnType<typeof setTimeout> | null = null;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let wrapEl:   HTMLDivElement    | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let cellSize = 40;

  const stepDelay = $derived(Math.round(400 - (speed - 1) * (380 / 9)));

  const GAP  = 2;
  const RADI = 3;

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const r = RADI;
    ctx.beginPath();
    ctx.moveTo(x + r, y);           ctx.lineTo(x + w - r, y);
    ctx.arcTo(x+w, y,   x+w, y+r,   r); ctx.lineTo(x+w, y+h-r);
    ctx.arcTo(x+w, y+h, x+w-r, y+h, r); ctx.lineTo(x+r, y+h);
    ctx.arcTo(x,   y+h, x, y+h-r,   r); ctx.lineTo(x, y+r);
    ctx.arcTo(x,   y,   x+r, y,      r); ctx.closePath();
  }

  function drawGrid(cells: number[], islandId: number[], hl: Map<string, string> = new Map()) {
    if (!grid || !canvasEl || !wrapEl) return;
    const { rows, cols, clues } = grid;
    const ctx = canvasEl.getContext('2d')!;
    cellSize = Math.max(22, Math.min(88, Math.floor(Math.min(
      (wrapEl.clientWidth  - 16) / cols,
      (wrapEl.clientHeight - 16) / rows
    ))));
    const cs = cellSize;
    canvasEl.width  = cols * cs;
    canvasEl.height = rows * cs;

    const islandCount = new Map<number, number>();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === WHITE) {
        const iid = islandId[i];
        if (iid >= 0) islandCount.set(iid, (islandCount.get(iid) ?? 0) + 1);
      }
    }

    ctx.fillStyle = '#c8d0da';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const val = cells[idx];
        const iid = islandId[idx];
        const key    = `${r},${c}`;
        const cluIdx = idx;  // flat index for clue lookup
        const x = c * cs + GAP, y = r * cs + GAP;
        const tw = cs - GAP * 2, th = cs - GAP * 2;

        const overflow = val === WHITE && iid >= 0 &&
          (islandCount.get(iid) ?? 0) > (grid.islands[iid]?.size ?? Infinity);

        ctx.fillStyle = hl.has(key)   ? hl.get(key)!
                      : val === BLACK  ? '#0f172a'
                      : overflow       ? '#fdba74'
                      : val === WHITE  ? '#fef3c7'
                      :                  '#edf2f7';
        rrect(ctx, x, y, tw, th);
        ctx.fill();

        if (clues.has(cluIdx)) {
          ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.5;
          rrect(ctx, x + 1, y + 1, tw - 2, th - 2);
          ctx.stroke();
        }

        if (val === BLACK && cs >= 28) {
          ctx.fillStyle = '#1e3a5f';
          ctx.font = `${Math.floor(cs * 0.28)}px Georgia, serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('~', c * cs + cs / 2, r * cs + cs / 2);
        }

        if (clues.has(cluIdx)) {
          ctx.fillStyle = val === BLACK ? '#475569' : '#1e1b4b';
          ctx.font = `bold ${Math.max(9, Math.floor(cs * 0.4))}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(clues.get(cluIdx)!), c * cs + cs / 2, r * cs + cs / 2);
        }
      }
    }
  }

  function redraw() {
    if (!grid) return;
    const hl = new Map<string, string>();
    for (const k of errors) hl.set(k, '#fca5a5');
    if (hintKey) hl.set(hintKey, '#fde68a');
    drawGrid(grid.cells, grid.islandId, hl);
  }

  function findViolations(g: Grid): Set<string> {
    const e = new Set<string>();
    for (let r = 0; r < g.rows - 1; r++)
      for (let c = 0; c < g.cols - 1; c++)
        if ([[0,0],[0,1],[1,0],[1,1]].every(([dr,dc]) => g.get(r+dr,c+dc) === BLACK))
          [[0,0],[0,1],[1,0],[1,1]].forEach(([dr,dc]) => e.add(`${r+dr},${c+dc}`));
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        if (g.get(r, c) !== WHITE) continue;
        const iid1 = g.getIslandId(r, c);
        for (const [nr, nc] of g.neighbors(r, c)) {
          const iid2 = g.getIslandId(nr, nc);
          if (g.get(nr, nc) === WHITE && iid2 >= 0 && iid1 >= 0 && iid1 !== iid2)
            { e.add(`${r},${c}`); e.add(`${nr},${nc}`); }
        }
      }
    return e;
  }

  function nearestIsland(g: Grid, r: number, c: number): number {
    const vis = new Set([`${r},${c}`]);
    const q: [number, number][] = [[r, c]]; let qi = 0;
    while (qi < q.length) {
      const [cr, cc] = q[qi++];
      const iid = g.getIslandId(cr, cc);
      if (iid >= 0) return iid;
      for (const [nr, nc] of g.neighbors(cr, cc)) {
        const k = `${nr},${nc}`;
        if (!vis.has(k)) { vis.add(k); q.push([nr, nc]); }
      }
    }
    return 0;
  }

  function loadText(text: string) {
    try {
      puzzleText = text;
      grid     = parsePuzzle(text);
      origGrid = grid.copy();
      status   = `${grid.rows}×${grid.cols} · ${grid.clues.size} islands`;
      timer    = ''; hintKey = null; errors = new Set();
      stopVcr(); steps = []; stepIdx = 0;
      requestAnimationFrame(() => redraw());
    } catch (e) { status = `Error: ${(e as Error).message}`; }
  }

  async function loadSample(name: string) {
    try { loadText(await fetch(`/puzzles/${name}`).then(r => r.text())); }
    catch { status = 'Could not load sample'; }
  }

  function handleFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    f.text().then(loadText);
    (e.target as HTMLInputElement).value = '';
  }

  function handleTap(x: number, y: number) {
    if (!grid) return;
    const c = Math.floor(x / cellSize), r = Math.floor(y / cellSize);
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return;
    if (grid.clues.has(r * grid.cols + c)) return;
    // A manual click takes over from step playback: end the VCR but keep the
    // current position (grid already mirrors the shown step, see showStep).
    if (steps.length) { stopVcr(); steps = []; stepIdx = 0; }
    const cur    = grid.get(r, c);
    const newVal = cur === UNKNOWN ? BLACK : cur === BLACK ? WHITE : UNKNOWN;
    grid.set(r, c, newVal);
    grid.setIslandId(r, c, newVal === WHITE ? nearestIsland(grid, r, c) : -1);
    errors  = findViolations(grid);
    hintKey = null;
    redraw();
  }

  function onClick(e: MouseEvent) {
    const rect = canvasEl!.getBoundingClientRect();
    handleTap(e.clientX - rect.left, e.clientY - rect.top);
  }

  function onTouch(e: TouchEvent) {
    e.preventDefault();
    const rect = canvasEl!.getBoundingClientRect();
    const t = e.changedTouches[0];
    handleTap(t.clientX - rect.left, t.clientY - rect.top);
  }

  async function autoSolve() {
    if (!puzzleText) { status = 'No puzzle loaded'; return; }
    stopVcr(); steps = [];
    status = 'Solving…'; timer = '';
    await tick();
    const w = getWorker();
    w.onmessage = (e: MessageEvent) => {
      const { type, solved, elapsed, cells, islandId, message } = e.data;
      if (type === 'error') { status = `Solver error: ${message}`; return; }
      if (type !== 'result') return;
      if (solved && grid) {
        grid.cells    = cells;
        grid.islandId = islandId;
      }
      errors = new Set(); hintKey = null;
      timer  = `${elapsed.toFixed(3)}s`;
      status = solved ? `Solved in ${elapsed.toFixed(3)}s` : 'No solution found (timeout)';
      redraw();
      if (solved && grid) flashComplete(grid);
    };
    w.onerror = (e) => { status = `Solver error: ${e.message}`; };
    w.postMessage({ type: 'solve', puzzleText, timeout: 120, wantSteps: false });
  }

  function flashComplete(g: Grid) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d')!;
    const cs  = cellSize;
    let col   = 0;
    function sweep() {
      if (col >= g.cols) { setTimeout(redraw, 400); return; }
      for (let r = 0; r < g.rows; r++) {
        if (g.cells[r * g.cols + col] === WHITE) {
          ctx.fillStyle = '#86efac';
          rrect(ctx, col*cs+GAP, r*cs+GAP, cs-GAP*2, cs-GAP*2);
          ctx.fill();
        }
      }
      col++; setTimeout(sweep, 25);
    }
    sweep();
  }

  async function startSteps() {
    if (!puzzleText) return;
    if (steps.length) { togglePlay(); return; }
    stopVcr();
    status = 'Building steps…';
    await tick();
    const w = getWorker();
    w.onmessage = (e: MessageEvent) => {
      const { type, snapshots, message } = e.data;
      if (type === 'error') { status = `Steps error: ${message}`; return; }
      if (type !== 'steps') return;
      steps = snapshots; stepIdx = 0;
      if (!steps.length) { status = 'No steps generated'; return; }
      showStep(); playing = true; schedulePlay();
    };
    w.onerror = (e) => { status = `Steps error: ${e.message}`; };
    w.postMessage({ type: 'solve', puzzleText, timeout: 120, wantSteps: true });
  }

  function showStep() {
    if (!grid || !steps.length) return;
    const s = steps[stepIdx];
    // Keep the working grid in sync with the shown step so manual editing,
    // Hint and Check all continue from the position currently on screen.
    grid.cells    = [...s.cells];
    grid.islandId = [...s.islandId];
    drawGrid(s.cells, s.islandId);
    status = `Step ${stepIdx + 1}/${steps.length}: ${s.rule}`;
  }

  function schedulePlay() {
    if (!playing) return;
    playTimer = setTimeout(() => {
      if (!playing) return;
      if (stepIdx < steps.length - 1) { stepIdx++; showStep(); schedulePlay(); }
      else { playing = false; status = 'Steps complete'; }
    }, stepDelay);
  }

  function togglePlay() {
    if (!steps.length) return;
    playing = !playing;
    if (playing) schedulePlay();
    else if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  }

  function stopVcr() {
    playing = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  }

  function stepPrev()  { stopVcr(); if (stepIdx > 0)              { stepIdx--; showStep(); } }
  function stepNext()  { stopVcr(); if (stepIdx < steps.length-1) { stepIdx++; showStep(); } }
  function stepFirst() { stopVcr(); stepIdx = 0;                showStep(); }
  function stepLast()  { stopVcr(); stepIdx = steps.length - 1; showStep(); }

  function doHint() {
    if (!grid) { status = 'No puzzle loaded'; return; }
    if (grid.isComplete()) { status = 'Puzzle is complete — use Reset to try again'; return; }
    const result = new Solver(grid.copy()).hint();
    if (!result) { status = 'No logical deduction found — try guessing'; return; }
    const [[r, c], val, explanation] = result;
    hintKey = `${r},${c}`;
    status  = `Hint (${r},${c}): ${val === BLACK ? 'water' : 'island'} — ${explanation}`;
    redraw();
    setTimeout(() => { hintKey = null; redraw(); }, 2500);
  }

  function doReset() {
    if (!origGrid) return;
    grid    = origGrid.copy();
    errors  = new Set(); hintKey = null; timer = ''; status = 'Reset';
    stopVcr(); steps = []; stepIdx = 0;
    redraw();
  }

  function checkSolution() {
    if (!grid) return;
    const [ok, msg] = validateSolution(grid);
    status = ok ? '✓ Valid solution!' : `✗ ${msg}`;
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    switch (e.key) {
      case ' ':          e.preventDefault(); autoSolve(); break;
      case 's': case 'S': startSteps(); break;
      case 'h': case 'H': doHint(); break;
      case 'r': case 'R': doReset(); break;
      case 'ArrowLeft':  if (steps.length) { e.preventDefault(); stepPrev(); } break;
      case 'ArrowRight': if (steps.length) { e.preventDefault(); stepNext(); } break;
    }
  }

  $effect(() => {
    const onResize = () => { if (grid) requestAnimationFrame(() => redraw()); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<svelte:window onkeydown={onKey} />

<input bind:this={fileInput} type="file" accept=".txt" style="display:none" onchange={handleFile}>

<div id="app">
  <header>
    <span class="wordmark">Nurikabe</span>
    <div class="header-right">
      <select onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v) { loadSample(v); (e.target as HTMLSelectElement).value = ''; }
      }}>
        <option value="">Samples</option>
        <option value="easy_5x5.txt">Easy 5×5</option>
        <option value="medium_10x10.txt">Medium 10×10</option>
        <option value="hard_20x20.txt">Hard 20×20</option>
        <option value="primer1_18x10.txt">Primer 1 (18×10)</option>
        <option value="primer2_24x14.txt">Primer 2 (24×14)</option>
        <option value="primer3_24x14.txt">Primer 3 (24×14)</option>
        <option value="vrazji1_24x14.txt">Vražji 1 (24×14)</option>
        <option value="vrazji2_24x14.txt">Vražji 2 (24×14)</option>
      </select>
      <button onclick={() => fileInput?.click()}>Load</button>
      <button onclick={() => showPaste = true}>Paste</button>
    </div>
  </header>

  <main>
    <div id="canvas-wrap" bind:this={wrapEl}>
      <canvas bind:this={canvasEl} onclick={onClick} ontouchend={onTouch} style="touch-action:none"></canvas>
      {#if !grid}<p class="empty">Select a sample or load a puzzle file</p>{/if}
    </div>

    <aside>
      {#if grid}<p class="info">{grid.rows}×{grid.cols} · {grid.clues.size} islands</p>{/if}

      <div class="btn-group">
        <button class="btn accent" onclick={autoSolve}>▶ Solve</button>
        <button class="btn" onclick={startSteps}>⏭ Steps</button>
        <button class="btn" onclick={doHint}>Hint</button>
        <button class="btn" onclick={doReset}>Reset</button>
      </div>

      {#if steps.length}
        <div class="vcr">
          <span class="vcr-count">{stepIdx + 1} / {steps.length}</span>
          <div class="vcr-btns">
            <button onclick={stepFirst}>⏮</button>
            <button onclick={stepPrev}>◀</button>
            <button class:active={playing} onclick={togglePlay}>{playing ? '⏸' : '▶'}</button>
            <button onclick={stepNext}>▶</button>
            <button onclick={stepLast}>⏭</button>
          </div>
          <input class="speed" type="range" min="1" max="10" bind:value={speed}>
        </div>
      {/if}

      <button class="btn" id="btn-check" onclick={checkSolution}>✓ Check</button>

      {#if timer}<p class="timer">{timer}</p>{/if}
      <p class="status">{status}</p>
    </aside>
  </main>
</div>

{#if showPaste}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" role="presentation" onclick={() => showPaste = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" role="dialog" onclick={(e) => e.stopPropagation()}>
      <h2>Paste puzzle</h2>
      <textarea bind:value={pasteText} placeholder="Numbers, 0 = empty&#10;&#10;2 0 0 3&#10;0 0 0 0"></textarea>
      <div class="modal-btns">
        <button onclick={() => showPaste = false}>Cancel</button>
        <button onclick={() => { loadText(pasteText); showPaste = false; }}>Load</button>
      </div>
    </div>
  </div>
{/if}

<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :global(html, body) {
    height: 100%;
    font-family: system-ui, -apple-system, sans-serif;
    background: #f9fafb;
    color: #111827;
    overflow: hidden;
  }

  #app { display: flex; flex-direction: column; height: 100dvh; }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 48px;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
    gap: 12px;
  }

  .wordmark { font-weight: 700; font-size: .95rem; letter-spacing: .04em; color: #1e1b4b; }

  .header-right { display: flex; align-items: center; gap: 8px; }

  header select, header button {
    height: 32px; padding: 0 12px;
    border: 1px solid #d1d5db; border-radius: 6px;
    background: #fff; font-size: .82rem; cursor: pointer; color: #374151;
    transition: border-color .15s, background .15s;
  }
  header select:hover, header button:hover { border-color: #6366f1; background: #f5f3ff; }

  main { flex: 1; display: flex; min-height: 0; overflow: hidden; }

  #canvas-wrap {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 12px; background: #f3f4f6; position: relative; overflow: hidden;
  }

  canvas { border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.08); cursor: crosshair; }

  .empty { position: absolute; font-size: .85rem; color: #9ca3af; }

  aside {
    width: 200px; background: #fff; border-left: 1px solid #e5e7eb;
    padding: 14px 12px; display: flex; flex-direction: column; gap: 10px;
    overflow-y: auto; flex-shrink: 0;
  }

  .info { font-size: .78rem; color: #6b7280; }

  .btn-group { display: flex; flex-direction: column; gap: 5px; }

  .btn {
    width: 100%; padding: 8px 10px;
    border: 1px solid #e5e7eb; border-radius: 6px;
    background: #f9fafb; font-size: .82rem; cursor: pointer;
    text-align: left; color: #374151; transition: all .15s;
  }
  .btn:hover { background: #f3f4f6; border-color: #d1d5db; }
  .btn.accent { background: #1e1b4b; color: #fff; border-color: #1e1b4b; }
  .btn.accent:hover { background: #312e81; }

  .vcr {
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 8px; display: flex; flex-direction: column; gap: 7px;
  }
  .vcr-count { font-size: .75rem; font-variant-numeric: tabular-nums; color: #6b7280; text-align: center; }
  .vcr-btns { display: flex; justify-content: center; gap: 4px; }
  .vcr-btns button {
    width: 32px; height: 28px; border: 1px solid #e5e7eb; border-radius: 5px;
    background: #fff; cursor: pointer; font-size: .8rem; color: #374151; transition: all .15s;
  }
  .vcr-btns button:hover, .vcr-btns button.active { background: #1e1b4b; color: #fff; border-color: #1e1b4b; }
  .speed { width: 100%; accent-color: #6366f1; cursor: pointer; }

  .timer { font-variant-numeric: tabular-nums; font-size: .78rem; color: #6b7280; }

  .status {
    font-size: .78rem; color: #374151; line-height: 1.5; min-height: 2.5em;
    padding: 6px 8px; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;
  }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 10; backdrop-filter: blur(2px);
  }
  .modal {
    background: #fff; border-radius: 12px; padding: 24px;
    width: min(420px, 92vw); box-shadow: 0 20px 60px rgba(0,0,0,.2);
  }
  .modal h2 { font-size: .95rem; font-weight: 600; margin-bottom: 12px; }
  .modal textarea {
    width: 100%; height: 150px; font-family: monospace; font-size: .85rem;
    padding: 8px; border: 1px solid #d1d5db; border-radius: 6px;
    resize: vertical; outline: none; background: #f9fafb;
  }
  .modal textarea:focus { border-color: #6366f1; }
  .modal-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .modal-btns button {
    padding: 7px 16px; border: 1px solid #d1d5db; border-radius: 6px;
    background: #f9fafb; font-size: .85rem; cursor: pointer; transition: all .15s;
  }
  .modal-btns button:last-child { background: #1e1b4b; color: #fff; border-color: #1e1b4b; }
  .modal-btns button:hover { background: #f3f4f6; }
  .modal-btns button:last-child:hover { background: #312e81; }

  @media (max-width: 600px) {
    main { flex-direction: column; }
    #canvas-wrap { flex: 1; min-height: 0; padding: 8px; }
    aside {
      width: 100%; height: auto; flex-shrink: 0;
      border-left: none; border-top: 1px solid #e5e7eb;
      padding: 10px 12px; gap: 8px; overflow-y: visible;
    }
    .info { display: none; }
    .btn-group { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .btn-group .btn { width: auto; padding: 11px 4px; text-align: center; font-size: .78rem; }
    #btn-check { width: 100%; text-align: center; padding: 10px; }
    .status { min-height: auto; font-size: .75rem; }
    .timer  { font-size: .75rem; }
    .vcr { width: 100%; }
  }

  aside::-webkit-scrollbar { width: 4px; }
  aside::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
</style>
