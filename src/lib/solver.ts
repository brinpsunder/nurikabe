import { Grid, Island, UNKNOWN, BLACK, WHITE, validateSolution } from './puzzle';

type StepCb = (snap: Grid, rule: string) => void;

// touchingIslands() markers (regular island ids are >= 0). MULTI happens to
// equal UNKNOWN numerically; they never live in the same array (touch vs cells).
const NONE  = -2; // cell touches no island
const MULTI = -1; // cell touches two or more different islands

export class Solver {
  grid: Grid;
  whiteTarget: number; // total island cells = sum of all clues
  blackTarget: number; // total water cells = grid size - whiteTarget
  private timeout = 60;
  private start = 0;
  private stepCb: StepCb | null = null;
  private now: () => number; // seconds; injectable so tests control time (DIP)
  private nbr: number[][]; // neighbor indices per cell, precomputed once
  // Reusable BFS scratch (avoids allocating sets/queues in hot loops):
  // a cell is "visited" when stamp[idx] === gen; bumping gen clears all.
  private stamp: Int32Array;
  private gen = 0;
  private bfsQueue: Int32Array;
  private bfsDist: Int32Array;
  private libGen: Int32Array; // per-region liberty dedup in seaRegions
  // Undo log: every markBlack/markWhite records its cell here, so search can
  // rewind cheaply instead of copying the whole grid at every branch.
  private trail: number[] = [];

  constructor(grid: Grid, now: () => number = () => performance.now() / 1000) {
    this.grid = grid;
    this.now = now;
    this.whiteTarget = [...grid.clues.values()].reduce((a, b) => a + b, 0);
    const n = grid.rows * grid.cols;
    this.stamp = new Int32Array(n);
    this.bfsQueue = new Int32Array(n);
    this.bfsDist = new Int32Array(n);
    this.libGen = new Int32Array(n);
    this.nbr = Array.from({ length: n }, (_, idx) => {
      const r = Math.floor(idx / grid.cols), c = idx % grid.cols;
      return grid.neighbors(r, c).map(([nr, nc]) => nr * grid.cols + nc);
    });
    this.blackTarget = grid.rows * grid.cols - this.whiteTarget;
    this.syncIslands();
  }

  solve(stepCallback?: StepCb, timeout = 60): [boolean, number] {
    this.timeout = timeout;
    this.start = this.now();
    this.stepCb = stepCallback ?? null;
    const ok = this.search();
    return [ok, this.now() - this.start];
  }

  // Depth-first search. Propagate; if stuck, branch on the liberties of the
  // incomplete island with the fewest of them. A white cell adjacent to an
  // island can only belong to that island (anything else would merge two
  // islands), so a refuted white guess means the cell is water — each failed
  // branch leaves a permanent deduction behind.
  nodes = 0; // search states explored across this Solver's lifetime (diagnostics)
  private search(): boolean {
    this.nodes++;
    if (this.now() - this.start > this.timeout) return false;
    if (!this.propagate()) return false;
    if (this.grid.isComplete()) return validateSolution(this.grid)[0];

    // Branch where the puzzle is tightest: fewest liberties, then least
    // spare room (reachable cells minus still-needed cells).
    const reach = this.computeReach();
    const slack = new Map<number, number>();
    for (const ids of reach.values())
      for (const id of ids) slack.set(id, (slack.get(id) ?? 0) + 1);
    let best: { isl: Island; libs: number[]; score: number } | null = null;
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const libs = this.islandLiberties(isl);
      const score = libs.length * 100 + (slack.get(isl.id) ?? 0) - remaining;
      if (!best || score < best.score) best = { isl, libs, score };
    }
    // Unreachable after propagate(): if every island were complete,
    // ruleSeaFill would have flooded the rest and isComplete() were true.
    if (!best) return false;

    // Probe before branching: a liberty that breaks the puzzle when tried as
    // water must be island — turns whole subtrees into direct deductions.
    const forced = best.libs.filter(idx => this.probesAsContradiction(idx));
    if (forced.length) {
      for (const idx of forced)
        this.markWhite(idx, best.isl.id, 'Water here would break the puzzle');
      return this.search();
    }

    for (const idx of best.libs) {
      const mark = this.trail.length;
      this.markWhite(idx, best.isl.id, 'Search: try island cell');
      if (this.search()) return true;
      this.undoTo(mark);
      // A white cell next to this island would merge with it, so if white
      // fails the cell must be water.
      this.markBlack(idx, 'Search: guess refuted, cell is water');
    }
    return false;
  }

  // Tentatively set the cell to water and propagate; true if that leads to a
  // contradiction. The grid (and the step callback) are left untouched.
  private probesAsContradiction(idx: number): boolean {
    const mark = this.trail.length;
    const cb = this.stepCb;
    this.stepCb = null; // probes are scratch work, not steps to show
    this.grid.cells[idx] = BLACK;
    this.grid.islandId[idx] = -1;
    this.trail.push(idx);
    const broken = !this.propagate();
    this.undoTo(mark);
    this.stepCb = cb;
    return broken;
  }

  // Try each rule on its own; return the first cell any rule decides,
  // with the rule's explanation. The grid is left untouched.
  hint(): [[number, number], number, string] | null {
    const snap = this.grid.copy();
    const trailMark = this.trail.length; // rules push to the trail; rewind it
    const reach = this.computeReach();
    const rules: [() => boolean, string][] = [
      [() => this.ruleIslandComplete(),   'Complete island is surrounded by water'],
      [() => this.ruleSeparateIslands(),  'Cell between two islands must be water'],
      [() => this.ruleUnreachable(reach), 'No island can reach this cell'],
      [() => this.ruleForcedExpansion(),  'Island has only one way to grow'],
      [() => this.ruleIslandFill(reach),  'Island needs every reachable cell'],
      [() => this.ruleSeaExpansion(),     'Water region has only one way to stay connected'],
      [() => this.ruleSeaFill(),          'All islands are complete — the rest is water'],
      [() => this.ruleNoPool(),           'Fourth cell of a water pool must be island'],
      [() => this.ruleCutCell(),          'Island cannot reach its size without this cell'],
    ];
    for (const [run, name] of rules) {
      const before = [...this.grid.cells];
      run();
      for (let idx = 0; idx < before.length; idx++)
        if (before[idx] !== this.grid.cells[idx]) {
          const value = this.grid.cells[idx];
          this.grid.restore(snap); // restore() also restores island cell sets
          this.trail.length = trailMark;
          return [[Math.floor(idx / this.grid.cols), idx % this.grid.cols], value, name];
        }
      this.grid.restore(snap);
      this.trail.length = trailMark;
    }
    return null;
  }

  // Rebuild each island's cell set from the grid arrays, so a Solver can be
  // constructed from any grid (fresh, GUI-edited, or restored snapshot).
  private syncIslands(): void {
    for (const isl of this.grid.islands) isl.cells = new Set();
    for (let idx = 0; idx < this.grid.cells.length; idx++) {
      const iid = this.grid.islandId[idx];
      if (iid >= 0 && this.grid.cells[idx] === WHITE) this.grid.islands[iid].cells.add(idx);
    }
  }


  private nbrOf(idx: number): number[] { return this.nbr[idx]; }

  // Rewind every mark made after the given trail position.
  private undoTo(mark: number): void {
    while (this.trail.length > mark) {
      const idx = this.trail.pop()!;
      const iid = this.grid.islandId[idx];
      if (this.grid.cells[idx] === WHITE && iid >= 0)
        this.grid.islands[iid].cells.delete(idx);
      this.grid.cells[idx] = UNKNOWN;
      this.grid.islandId[idx] = -1;
    }
  }

  private count(value: number): number {
    let n = 0;
    for (const v of this.grid.cells) if (v === value) n++;
    return n;
  }

  private markBlack(idx: number, rule: string): boolean {
    if (this.grid.cells[idx] !== UNKNOWN) return false;
    this.grid.cells[idx] = BLACK;
    this.grid.islandId[idx] = -1;
    this.trail.push(idx);
    this.stepCb?.(this.grid.copy(), rule);
    return true;
  }

  private markWhite(idx: number, iid: number, rule: string): boolean {
    if (this.grid.cells[idx] !== UNKNOWN) return false;
    this.grid.cells[idx] = WHITE;
    this.grid.islandId[idx] = iid;
    this.grid.islands[iid].cells.add(idx);
    this.trail.push(idx);
    this.stepCb?.(this.grid.copy(), rule);
    return true;
  }

  // For every cell: which island's white cells touch it —
  // NONE, a single island id, or MULTI for two or more different islands.
  touchingIslands(): number[] {
    const cells = this.grid.cells;
    const touch: number[] = new Array(cells.length).fill(NONE);
    for (let i = 0; i < cells.length; i++) {
      const iid = this.grid.islandId[i];
      if (cells[i] !== WHITE || iid < 0) continue;
      for (const n of this.nbr[i]) {
        if (touch[n] === NONE) touch[n] = iid;
        else if (touch[n] !== iid) touch[n] = MULTI;
      }
    }
    return touch;
  }

  // Rule: a white cell here would merge two islands, so it must be water.
  ruleSeparateIslands(): boolean {
    let changed = false;
    const touch = this.touchingIslands();
    for (let idx = 0; idx < touch.length; idx++)
      if (touch[idx] === MULTI && this.grid.cells[idx] === UNKNOWN)
        changed = this.markBlack(idx, 'Cell between two islands must be water') || changed;
    return changed;
  }

  // For every UNKNOWN cell: list of islands that could still claim it.
  // BFS from each incomplete island through unknown cells, limited by the
  // island's remaining size; never enters a cell touching a different island
  // (white there would merge the two islands).
  computeReach(): Map<number, number[]> {
    const reach = new Map<number, number[]>();
    const touch = this.touchingIslands();
    const { stamp, bfsQueue, bfsDist } = this;
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const gen = ++this.gen;
      let qe = 0;
      for (const idx of isl.cells) {
        stamp[idx] = gen;
        for (const n of this.nbrOf(idx))
          if (this.grid.cells[n] === UNKNOWN && stamp[n] !== gen) {
            stamp[n] = gen; bfsQueue[qe] = n; bfsDist[qe++] = 1;
          }
      }
      for (let qi = 0; qi < qe; qi++) {
        const idx = bfsQueue[qi], dist = bfsDist[qi];
        if (dist > remaining) continue;
        if (touch[idx] !== isl.id && touch[idx] !== NONE) continue;
        if (!reach.has(idx)) reach.set(idx, []);
        reach.get(idx)!.push(isl.id);
        for (const n of this.nbrOf(idx))
          if (this.grid.cells[n] === UNKNOWN && stamp[n] !== gen) {
            stamp[n] = gen; bfsQueue[qe] = n; bfsDist[qe++] = dist + 1;
          }
      }
    }
    return reach;
  }

  // Rule: if the cells an island can reach are exactly as many as it still
  // needs, all of them are island cells. Fills at most one island per call —
  // the caller recomputes reach before the next deduction (marking cells
  // white invalidates the map).
  ruleIslandFill(reach: Map<number, number[]>): boolean {
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const mine: number[] = [];
      for (const [idx, ids] of reach) if (ids.includes(isl.id)) mine.push(idx);
      if (mine.length === remaining) {
        for (const idx of mine)
          this.markWhite(idx, isl.id, 'Island needs every reachable cell');
        return true;
      }
    }
    return false;
  }

  // Rule: a cell no island can reach must be water.
  ruleUnreachable(reach: Map<number, number[]>): boolean {
    let changed = false;
    for (let idx = 0; idx < this.grid.cells.length; idx++)
      if (this.grid.cells[idx] === UNKNOWN && !reach.has(idx))
        changed = this.markBlack(idx, 'No island can reach this cell') || changed;
    return changed;
  }

  // Unknown cells directly adjacent to the island — its only ways to grow.
  private islandLiberties(isl: Island): number[] {
    const libs = new Set<number>();
    for (const idx of isl.cells)
      for (const n of this.nbrOf(idx))
        if (this.grid.cells[n] === UNKNOWN) libs.add(n);
    return [...libs];
  }

  // Rule: an incomplete island with a single liberty must take it.
  ruleForcedExpansion(): boolean {
    let changed = false;
    for (const isl of this.grid.islands) {
      if (isl.cells.size >= isl.size) continue;
      const libs = this.islandLiberties(isl);
      if (libs.length === 1)
        changed = this.markWhite(libs[0], isl.id, 'Island has only one way to grow') || changed;
    }
    return changed;
  }

  // Connected groups of water cells, each with its unknown border cells.
  private seaRegions(): { cells: number[]; liberties: number[] }[] {
    const regions: { cells: number[]; liberties: number[] }[] = [];
    const { stamp } = this;
    const seenGen = ++this.gen;   // marks water cells already in a region
    const libGen = this.libGen;   // liberty stamped with a per-region number
    let regionNo = this.gen;      // unique per region; gen is synced at the end
    for (let start = 0; start < this.grid.cells.length; start++) {
      if (this.grid.cells[start] !== BLACK || stamp[start] === seenGen) continue;
      regionNo++;
      const cells = [start];
      stamp[start] = seenGen;
      const liberties: number[] = [];
      for (let qi = 0; qi < cells.length; qi++)
        for (const n of this.nbrOf(cells[qi])) {
          if (this.grid.cells[n] === BLACK && stamp[n] !== seenGen) {
            stamp[n] = seenGen; cells.push(n);
          }
          if (this.grid.cells[n] === UNKNOWN && libGen[n] !== regionNo) {
            libGen[n] = regionNo; liberties.push(n);
          }
        }
      regions.push({ cells, liberties });
    }
    this.gen = regionNo; // future generations must exceed every region number
    return regions;
  }

  // Rule: all water must end up connected. While the sea still has to grow
  // (more water needed, or several separate regions), a region with a single
  // unknown border cell must claim it — every path out goes through it.
  ruleSeaExpansion(): boolean {
    const regions = this.seaRegions();
    const mustGrow = regions.length >= 2 || this.count(BLACK) < this.blackTarget;
    if (!mustGrow) return false;
    let changed = false;
    for (const reg of regions)
      if (reg.liberties.length === 1)
        changed = this.markBlack(reg.liberties[0],
          'Water region has only one way to stay connected') || changed;
    return changed;
  }

  // Rule: when the number of white cells hits the clue total, every island
  // is complete and all remaining unknowns are water.
  ruleSeaFill(): boolean {
    if (this.count(WHITE) !== this.whiteTarget) return false;
    let changed = false;
    for (let idx = 0; idx < this.grid.cells.length; idx++)
      if (this.grid.cells[idx] === UNKNOWN)
        changed = this.markBlack(idx, 'All islands are complete — the rest is water') || changed;
    return changed;
  }

  // Apply rules until none changes anything. Tier 1: cheap rules, all in
  // sequence. Tier 2 (when tier 1 stalls): reach-based rules on a fresh BFS
  // map. Tier 3 (when both stall): the expensive pool/cut-cell analyses.
  // Returns false if the resulting grid is contradictory.
  propagate(): boolean {
    let changed = true;
    while (changed) {
      changed = false;
      changed = this.ruleIslandComplete()  || changed;
      changed = this.ruleSeparateIslands() || changed;
      changed = this.ruleForcedExpansion() || changed;
      changed = this.ruleSeaExpansion()    || changed;
      changed = this.ruleSeaFill()         || changed;
      if (changed) continue;
      const reach = this.computeReach();
      changed = this.ruleUnreachable(reach) || this.ruleIslandFill(reach);
      if (changed) continue;
      changed = this.ruleNoPool() || this.ruleCutCell();
    }
    return this.contradiction() === null;
  }

  // Why the current grid can no longer lead to a solution — or null if it can.
  contradiction(): string | null {
    const { rows, cols } = this.grid;
    for (const isl of this.grid.islands)
      if (isl.cells.size > isl.size) return 'island too big';
    if (this.count(BLACK) > this.blackTarget) return 'too much water';
    if (this.count(WHITE) > this.whiteTarget) return 'too many island cells';

    const reach = this.computeReach();
    const perIsland = new Map<number, number>();
    for (const ids of reach.values())
      for (const id of ids) perIsland.set(id, (perIsland.get(id) ?? 0) + 1);
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining > 0 && (perIsland.get(isl.id) ?? 0) < remaining)
        return 'island cannot reach its size';
    }

    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++)
        if (this.grid.get(r, c) === BLACK && this.grid.get(r, c + 1) === BLACK &&
            this.grid.get(r + 1, c) === BLACK && this.grid.get(r + 1, c + 1) === BLACK)
          return '2×2 water pool';

    const regions = this.seaRegions();
    if (regions.length >= 2 && this.count(BLACK) === this.blackTarget)
      return 'water split';
    const mustGrow = regions.length >= 2 || this.count(BLACK) < this.blackTarget;
    if (mustGrow)
      for (const reg of regions)
        if (reg.liberties.length === 0) return 'water region walled off';

    // The final sea is one connected piece, and it can only occupy cells that
    // are water or still unknown — so every water cell must sit in a single
    // connected component of (water ∪ unknown).
    if (regions.length >= 2) {
      const { stamp } = this;
      const gen = ++this.gen;
      const queue = [regions[0].cells[0]];
      stamp[queue[0]] = gen;
      for (let qi = 0; qi < queue.length; qi++)
        for (const n of this.nbrOf(queue[qi]))
          if (this.grid.cells[n] !== WHITE && stamp[n] !== gen) {
            stamp[n] = gen; queue.push(n);
          }
      for (const reg of regions)
        if (stamp[reg.cells[0]] !== gen) return 'sea cannot connect';
    }

    return null;
  }

  // Rule: if excluding a liberty cell leaves the island with fewer reachable
  // cells than it still needs, that liberty must be an island cell. Acts at
  // most once per call (a new white cell invalidates the analysis).
  ruleCutCell(): boolean {
    const touch = this.touchingIslands();
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      for (const lib of this.islandLiberties(isl)) {
        if (touch[lib] !== isl.id) continue; // only liberties touching just this island
        if (this.reachableWithout(isl, lib, touch) < remaining)
          if (this.markWhite(lib, isl.id, 'Island cannot reach its size without this cell'))
            return true;
      }
    }
    return false;
  }

  // How many unknown cells the island could still claim if `excluded` were
  // off-limits. Same BFS as computeReach (distance bound, other-island
  // blocking); stops early once `remaining` cells are found.
  private reachableWithout(isl: Island, excluded: number, touch: number[]): number {
    const remaining = isl.size - isl.cells.size;
    const { stamp, bfsQueue, bfsDist } = this;
    const gen = ++this.gen;
    stamp[excluded] = gen;
    let qe = 0;
    for (const idx of isl.cells) {
      stamp[idx] = gen;
      for (const n of this.nbrOf(idx))
        if (this.grid.cells[n] === UNKNOWN && stamp[n] !== gen) {
          stamp[n] = gen; bfsQueue[qe] = n; bfsDist[qe++] = 1;
        }
    }
    let found = 0;
    for (let qi = 0; qi < qe; qi++) {
      const idx = bfsQueue[qi], dist = bfsDist[qi];
      if (dist > remaining) continue;
      if (touch[idx] !== isl.id && touch[idx] !== NONE) continue;
      if (++found >= remaining) return found;
      for (const n of this.nbrOf(idx))
        if (this.grid.cells[n] === UNKNOWN && stamp[n] !== gen) {
          stamp[n] = gen; bfsQueue[qe] = n; bfsDist[qe++] = dist + 1;
        }
    }
    return found;
  }

  // Rule: three water cells in a 2×2 square — the fourth cannot be water
  // (it would close a pool), so it is an island cell. Acts only when exactly
  // one incomplete island touches that cell, and at most once per call so
  // the touch map never goes stale.
  ruleNoPool(): boolean {
    const { rows, cols } = this.grid;
    const touch = this.touchingIslands();
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const quad = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1];
        const unknowns = quad.filter(i => this.grid.cells[i] === UNKNOWN);
        const blacks   = quad.filter(i => this.grid.cells[i] === BLACK).length;
        if (blacks !== 3 || unknowns.length !== 1) continue;
        const idx = unknowns[0];
        const iid = touch[idx];
        if (iid >= 0 && this.grid.islands[iid].cells.size < this.grid.islands[iid].size)
          if (this.markWhite(idx, iid, 'Fourth cell of a water pool must be island'))
            return true;
      }
    return false;
  }

  // Rule: an island that has reached its size is surrounded by water.
  ruleIslandComplete(): boolean {
    let changed = false;
    for (const isl of this.grid.islands) {
      if (isl.cells.size !== isl.size) continue;
      for (const idx of isl.cells)
        for (const n of this.nbrOf(idx))
          changed = this.markBlack(n, 'Complete island is surrounded by water') || changed;
    }
    return changed;
  }
}
