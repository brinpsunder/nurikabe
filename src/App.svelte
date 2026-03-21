<script lang="ts">
  import { tick } from 'svelte';
  import { parsePuzzle, validateSolution, UNKNOWN, BLACK, WHITE } from './lib/puzzle';
  import type { Grid } from './lib/puzzle';
  import { Solver } from './lib/solver';

  // ── State ─────────────────────────────────────────────────────────────────
  let grid      = $state<Grid | null>(null);
  let origGrid  = $state<Grid | null>(null);
  let status    = $state('Load a puzzle to begin');
  let timer     = $state('');
  let tool      = $state<'black' | 'white' | 'unknown'>('black');
  let hintKey   = $state<string | null>(null);
  let errors    = $state(new Set<string>());
  let showPaste = $state(false);
  let pasteText = $state('');
  let speed     = $state(5);

  // VCR
  type Step = { cells: number[]; islandId: number[]; rule: string };
  let steps     = $state<Step[]>([]);
  let stepIdx   = $state(0);
  let playing   = $state(false);
  let playTimer: ReturnType<typeof setTimeout> | null = null;

  // DOM refs
  let canvasEl:   HTMLCanvasElement | undefined = $state();
  let wrapEl:     HTMLDivElement    | undefined = $state();
  let fileInput:  HTMLInputElement  | undefined = $state();
  let cellSize    = 40;

  const stepDelay = $derived(Math.round(400 - (speed - 1) * (380 / 9)));

  // ── Canvas drawing ────────────────────────────────────────────────────────
  const GAP  = 2;
  const RADI = 3;

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const r = RADI;
    ctx.beginPath();
    ctx.moveTo(x + r, y);        ctx.lineTo(x + w - r, y);
    ctx.arcTo(x+w, y,   x+w, y+r,   r); ctx.lineTo(x+w, y+h-r);
    ctx.arcTo(x+w, y+h, x+w-r, y+h, r); ctx.lineTo(x+r, y+h);
    ctx.arcTo(x,   y+h, x, y+h-r,   r); ctx.lineTo(x, y+r);
    ctx.arcTo(x,   y,   x+r, y,      r); ctx.closePath();
  }

  function drawGrid(cells: number[], islandId: number[], hl: Map<string, string> = new Map()) {
    if (!grid || !canvasEl || !wrapEl) return;
    const { rows, cols, clues } = grid;
    const ctx = canvasEl.getContext('2d')!;
    const maxW = wrapEl.clientWidth  - 16;
    const maxH = wrapEl.clientHeight - 16;
    cellSize = Math.max(22, Math.min(88, Math.floor(Math.min(maxW / cols, maxH / rows))));
    const cs = cellSize;
    canvasEl.width  = cols * cs;
    canvasEl.height = rows * cs;

    // Count actual cells per island to detect overflow
    const islandCount = new Map<number, number>();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === WHITE) {
        const iid = islandId[i];
        if (iid >= 0) islandCount.set(iid, (islandCount.get(iid) ?? 0) + 1);
      }
    }

    // Gap / grid background
    ctx.fillStyle = '#c8d0da';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx  = r * cols + c;
        const val  = cells[idx];
        const iid  = islandId[idx];
        const key  = `${r},${c}`;
        const x    = c * cs + GAP;
        const y    = r * cs + GAP;
        const tw   = cs - GAP * 2;
        const th   = cs - GAP * 2;

        // Overflow: island has more cells than its target size
        const isOverflow = val === WHITE && iid >= 0 &&
          (islandCount.get(iid) ?? 0) > (grid.islands[iid]?.size ?? Infinity);

        // Fill
        let fill: string;
        if      (hl.has(key))    fill = hl.get(key)!;
        else if (val === BLACK)  fill = '#0f172a';
        else if (isOverflow)     fill = '#fdba74';   // orange — island too big
        else if (val === WHITE)  fill = '#fef3c7';   // amber-100 — clearly visible
        else                     fill = '#edf2f7';   // unknown — neutral gray

        ctx.fillStyle = fill;
        rrect(ctx, x, y, tw, th);
        ctx.fill();

        // Clue ring
        if (clues.has(key)) {
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 1.5;
          rrect(ctx, x + 1, y + 1, tw - 2, th - 2);
          ctx.stroke();
        }

        // Water wave
        if (val === BLACK && cs >= 28) {
          ctx.fillStyle = '#1e3a5f';
          ctx.font = `${Math.floor(cs * 0.28)}px Georgia, serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('~', c * cs + cs / 2, r * cs + cs / 2);
        }

        // Number
        if (clues.has(key)) {
          ctx.fillStyle = val === BLACK ? '#475569' : '#1e1b4b';
          ctx.font = `bold ${Math.max(9, Math.floor(cs * 0.4))}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(clues.get(key)!), c * cs + cs / 2, r * cs + cs / 2);
        }
      }
    }
  }

  function redraw(extra?: Map<string, string>) {
    if (!grid) return;
    const hl = new Map<string, string>();
    for (const k of errors) hl.set(k, '#fca5a5');
    if (hintKey) hl.set(hintKey, '#fde68a');
    if (extra) for (const [k, v] of extra) hl.set(k, v);
    drawGrid(grid.cells, grid.islandId, hl);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
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
          if (g.get(nr, nc) === WHITE && iid2 >= 0 && iid1 >= 0 && iid1 !== iid2) {
            e.add(`${r},${c}`); e.add(`${nr},${nc}`);
          }
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

  // ── Load puzzle ───────────────────────────────────────────────────────────
  function loadText(text: string) {
    try {
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

  function openFile() { fileInput?.click(); }

  function handleFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    f.text().then(loadText);
    (e.target as HTMLInputElement).value = '';
  }

  // ── Canvas interaction ────────────────────────────────────────────────────
  function cellAt(x: number, y: number): [number, number] | null {
    if (!grid) return null;
    const c = Math.floor(x / cellSize);
    const r = Math.floor(y / cellSize);
    if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return null;
    return [r, c];
  }

  function handleTap(x: number, y: number) {
    if (!grid) return;
    const pos = cellAt(x, y); if (!pos) return;
    const [r, c] = pos;
    const key = `${r},${c}`;
    if (grid.clues.has(key)) return;
    const cur    = grid.get(r, c);
    const target = tool === 'black' ? BLACK : tool === 'white' ? WHITE : UNKNOWN;
    const newVal = cur === target ? UNKNOWN : target;
    grid.set(r, c, newVal);
    if      (newVal === UNKNOWN) grid.setIslandId(r, c, -1);
    else if (newVal === BLACK)   grid.setIslandId(r, c, -1);
    else                         grid.setIslandId(r, c, nearestIsland(grid, r, c));
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

  // ── Auto-solve ────────────────────────────────────────────────────────────
  async function autoSolve() {
    if (!origGrid) { status = 'No puzzle loaded'; return; }
    stopVcr(); steps = [];
    status = 'Solving…'; timer = '';
    await tick();
    // yield to repaint before blocking
    await new Promise<void>(r => setTimeout(r, 10));
    const gc = origGrid.copy();
    const [solved, elapsed] = new Solver(gc).solve(undefined, 30);
    if (solved && grid) {
      grid.cells    = [...gc.cells];
      grid.islandId = [...gc.islandId];
      grid.islands  = gc.islands;
    }
    errors  = new Set(); hintKey = null;
    timer   = `${elapsed.toFixed(3)}s`;
    status  = solved ? `Solved in ${elapsed.toFixed(3)}s` : 'No solution found';
    redraw();
    if (solved && grid) flashComplete(grid);
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

  // ── Step-by-step ──────────────────────────────────────────────────────────
  async function startSteps() {
    if (!origGrid) return;
    if (steps.length) { togglePlay(); return; }
    stopVcr();
    status = 'Building steps…';
    await tick();
    await new Promise<void>(r => setTimeout(r, 10));
    const collected: Step[] = [];
    new Solver(origGrid.copy()).solve(
      (snap, rule) => collected.push({ cells: [...snap.cells], islandId: [...snap.islandId], rule }),
      30
    );
    steps   = collected;
    stepIdx = 0;
    if (!steps.length) { status = 'No steps generated'; return; }
    showStep();
    playing = true;
    schedulePlay();
  }

  function showStep() {
    if (!grid || !steps.length) return;
    const s = steps[stepIdx];
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

  function stepPrev()  { stopVcr(); if (stepIdx > 0)                   { stepIdx--; showStep(); } }
  function stepNext()  { stopVcr(); if (stepIdx < steps.length - 1)    { stepIdx++; showStep(); } }
  function stepFirst() { stopVcr(); stepIdx = 0;                  showStep(); }
  function stepLast()  { stopVcr(); stepIdx = steps.length - 1;   showStep(); }

  // ── Hint ──────────────────────────────────────────────────────────────────
  function doHint() {
    if (!grid) return;
    const result = new Solver(grid.copy()).hint();
    if (!result) { status = 'No hint available'; return; }
    const [[r, c], val, explanation] = result;
    hintKey = `${r},${c}`;
    status  = `Hint (${r},${c}): ${val === BLACK ? 'water' : 'island'} — ${explanation}`;
    redraw();
    setTimeout(() => { hintKey = null; redraw(); }, 2500);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
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

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    switch (e.key) {
      case ' ':         e.preventDefault(); autoSolve(); break;
      case 's': case 'S': startSteps(); break;
      case 'h': case 'H': doHint(); break;
      case 'r': case 'R': doReset(); break;
      case '1':         tool = 'black';   break;
      case '2':         tool = 'white';   break;
      case '3':         tool = 'unknown'; break;
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

  <!-- ── Header ── -->
  <header>
    <span class="wordmark">Nurikabe</span>
    <div class="header-right">
      <select onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { loadSample(v); (e.target as HTMLSelectElement).value = ''; } }}>
        <option value="">Samples</option>
        <option value="easy_5x5.txt">Easy 5×5</option>
        <option value="medium_10x10.txt">Medium 10×10</option>
        <option value="hard_20x20.txt">Hard 20×20</option>
      </select>
      <button onclick={openFile}>Load</button>
      <button onclick={() => showPaste = true}>Paste</button>
    </div>
  </header>

  <!-- ── Main ── -->
  <main>

    <!-- Canvas -->
    <div id="canvas-wrap" bind:this={wrapEl}>
      <canvas
        bind:this={canvasEl}
        onclick={onClick}
        ontouchend={onTouch}
        style="touch-action:none"
      ></canvas>
      {#if !grid}
        <p class="empty">Select a sample or load a puzzle file</p>
      {/if}
    </div>

    <!-- Controls -->
    <aside>
      {#if grid}
        <p class="info">{grid.rows}×{grid.cols} · {grid.clues.size} islands</p>
      {/if}

      <div class="btn-group">
        <button class="btn accent" onclick={autoSolve}>▶ Solve</button>
        <button class="btn" onclick={startSteps}>⏭ Steps</button>
        <button class="btn" onclick={doHint}>Hint</button>
        <button class="btn" onclick={doReset}>Reset</button>
      </div>

      <!-- VCR -->
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

      <!-- Tools -->
      <div class="tools">
        <button class:active={tool==='black'}   onclick={() => tool='black'}>Water</button>
        <button class:active={tool==='white'}   onclick={() => tool='white'}>Island</button>
        <button class:active={tool==='unknown'} onclick={() => tool='unknown'}>Erase</button>
      </div>
      <button class="btn" onclick={checkSolution}>✓ Check</button>

      {#if timer}<p class="timer">{timer}</p>{/if}
      <p class="status">{status}</p>
    </aside>
  </main>

</div>

<!-- Paste modal -->
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
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Root ── */
  :global(html, body) {
    height: 100%;
    font-family: system-ui, -apple-system, sans-serif;
    background: #f9fafb;
    color: #111827;
    overflow: hidden;
  }

  #app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  /* ── Header ── */
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

  .wordmark {
    font-weight: 700;
    font-size: .95rem;
    letter-spacing: .04em;
    color: #1e1b4b;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  header select, header button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    font-size: .82rem;
    cursor: pointer;
    color: #374151;
    transition: border-color .15s, background .15s;
  }

  header select:hover, header button:hover {
    border-color: #6366f1;
    background: #f5f3ff;
  }

  /* ── Main layout ── */
  main {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Canvas ── */
  #canvas-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: #f3f4f6;
    position: relative;
    overflow: hidden;
  }

  canvas {
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.08);
    cursor: crosshair;
  }

  .empty {
    position: absolute;
    font-size: .85rem;
    color: #9ca3af;
  }

  /* ── Sidebar ── */
  aside {
    width: 200px;
    background: #fff;
    border-left: 1px solid #e5e7eb;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .info {
    font-size: .78rem;
    color: #6b7280;
  }

  /* ── Buttons ── */
  .btn-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .btn {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #f9fafb;
    font-size: .82rem;
    cursor: pointer;
    text-align: left;
    color: #374151;
    transition: all .15s;
  }

  .btn:hover { background: #f3f4f6; border-color: #d1d5db; }

  .btn.accent {
    background: #1e1b4b;
    color: #fff;
    border-color: #1e1b4b;
  }

  .btn.accent:hover { background: #312e81; }

  /* ── VCR ── */
  .vcr {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .vcr-count {
    font-size: .75rem;
    font-variant-numeric: tabular-nums;
    color: #6b7280;
    text-align: center;
  }

  .vcr-btns {
    display: flex;
    justify-content: center;
    gap: 4px;
  }

  .vcr-btns button {
    width: 32px;
    height: 28px;
    border: 1px solid #e5e7eb;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    font-size: .8rem;
    color: #374151;
    transition: all .15s;
  }

  .vcr-btns button:hover, .vcr-btns button.active {
    background: #1e1b4b;
    color: #fff;
    border-color: #1e1b4b;
  }

  .speed {
    width: 100%;
    accent-color: #6366f1;
    cursor: pointer;
  }

  /* ── Tools ── */
  .tools {
    display: flex;
    gap: 4px;
  }

  .tools button {
    flex: 1;
    padding: 6px 2px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #f9fafb;
    font-size: .72rem;
    cursor: pointer;
    color: #6b7280;
    transition: all .15s;
  }

  .tools button:hover    { border-color: #6366f1; color: #1e1b4b; }
  .tools button.active   { background: #1e1b4b; color: #fff; border-color: #1e1b4b; }

  .timer {
    font-variant-numeric: tabular-nums;
    font-size: .78rem;
    color: #6b7280;
  }

  .status {
    font-size: .78rem;
    color: #374151;
    line-height: 1.5;
    min-height: 2.5em;
    padding: 6px 8px;
    background: #f9fafb;
    border-radius: 6px;
    border: 1px solid #e5e7eb;
  }

  /* ── Paste modal ── */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    backdrop-filter: blur(2px);
  }

  .modal {
    background: #fff;
    border-radius: 12px;
    padding: 24px;
    width: min(420px, 92vw);
    box-shadow: 0 20px 60px rgba(0,0,0,.2);
  }

  .modal h2 { font-size: .95rem; font-weight: 600; margin-bottom: 12px; }

  .modal textarea {
    width: 100%;
    height: 150px;
    font-family: monospace;
    font-size: .85rem;
    padding: 8px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    resize: vertical;
    outline: none;
    background: #f9fafb;
  }

  .modal textarea:focus { border-color: #6366f1; }

  .modal-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .modal-btns button {
    padding: 7px 16px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f9fafb;
    font-size: .85rem;
    cursor: pointer;
    transition: all .15s;
  }

  .modal-btns button:last-child {
    background: #1e1b4b;
    color: #fff;
    border-color: #1e1b4b;
  }

  .modal-btns button:hover { background: #f3f4f6; }
  .modal-btns button:last-child:hover { background: #312e81; }

  /* ── Mobile ── */
  @media (max-width: 600px) {
    aside {
      width: 100%;
      border-left: none;
      border-top: 1px solid #e5e7eb;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: flex-start;
      padding: 10px;
      gap: 8px;
      overflow-y: visible;
      max-height: 44vw;
      overflow-x: auto;
    }

    main { flex-direction: column; }

    #canvas-wrap { flex: 1; min-height: 0; }

    .btn-group {
      flex-direction: row;
      flex-wrap: wrap;
      flex: 1;
      min-width: 140px;
    }

    .btn-group .btn { width: auto; flex: 1; min-width: 60px; }

    .vcr, .tools, .status, .timer, .info { flex-shrink: 0; }

    .vcr { width: 100%; }
    .status { width: 100%; }
  }

  /* ── Scrollbar ── */
  aside::-webkit-scrollbar { width: 4px; }
  aside::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
</style>
