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

  constructor(grid: Grid, now: () => number = () => performance.now() / 1000) {
    this.grid = grid;
    this.now = now;
    this.whiteTarget = [...grid.clues.values()].reduce((a, b) => a + b, 0);
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
  private search(): boolean {
    if (this.now() - this.start > this.timeout) return false;
    if (!this.propagate()) return false;
    if (this.grid.isComplete()) return validateSolution(this.grid)[0];

    let best: { isl: Island; libs: number[] } | null = null;
    for (const isl of this.grid.islands) {
      if (isl.cells.size >= isl.size) continue;
      const libs = this.islandLiberties(isl);
      if (!best || libs.length < best.libs.length) best = { isl, libs };
    }
    // Unreachable after propagate(): if every island were complete,
    // ruleSeaFill would have flooded the rest and isComplete() were true.
    if (!best) return false;

    for (const idx of best.libs) {
      const snap = this.grid.copy();
      this.markWhite(idx, best.isl.id, 'Search: try island cell');
      if (this.search()) return true;
      this.grid.restore(snap);
      // A white cell next to this island would merge with it, so if white
      // fails the cell must be water.
      this.markBlack(idx, 'Search: guess refuted, cell is water');
    }
    return false;
  }

  // Try each rule on its own; return the first cell any rule decides,
  // with the rule's explanation. The grid is left untouched.
  hint(): [[number, number], number, string] | null {
    const snap = this.grid.copy();
    const reach = this.computeReach();
    const rules: [() => boolean, string][] = [
      [() => this.ruleIslandComplete(),   'Complete island is surrounded by water'],
      [() => this.ruleSeparateIslands(),  'Cell between two islands must be water'],
      [() => this.ruleUnreachable(reach), 'No island can reach this cell'],
      [() => this.ruleForcedExpansion(),  'Island has only one way to grow'],
      [() => this.ruleIslandFill(reach),  'Island needs every reachable cell'],
      [() => this.ruleSeaExpansion(),     'Water region has only one way to stay connected'],
      [() => this.ruleSeaFill(),          'All islands are complete — the rest is water'],
    ];
    for (const [run, name] of rules) {
      const before = [...this.grid.cells];
      run();
      for (let idx = 0; idx < before.length; idx++)
        if (before[idx] !== this.grid.cells[idx]) {
          const value = this.grid.cells[idx];
          this.grid.restore(snap); // restore() also restores island cell sets
          return [[Math.floor(idx / this.grid.cols), idx % this.grid.cols], value, name];
        }
      this.grid.restore(snap);
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

  private neighborIdx(idx: number): number[] {
    const r = Math.floor(idx / this.grid.cols), c = idx % this.grid.cols;
    return this.grid.neighbors(r, c).map(([nr, nc]) => nr * this.grid.cols + nc);
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
    this.stepCb?.(this.grid.copy(), rule);
    return true;
  }

  private markWhite(idx: number, iid: number, rule: string): boolean {
    if (this.grid.cells[idx] !== UNKNOWN) return false;
    this.grid.cells[idx] = WHITE;
    this.grid.islandId[idx] = iid;
    this.grid.islands[iid].cells.add(idx);
    this.stepCb?.(this.grid.copy(), rule);
    return true;
  }

  // For every cell: which island's white cells touch it —
  // NONE, a single island id, or MULTI for two or more different islands.
  touchingIslands(): number[] {
    const { rows, cols } = this.grid;
    const touch: number[] = new Array(rows * cols).fill(NONE);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const iid = this.grid.getIslandId(r, c);
        if (this.grid.get(r, c) !== WHITE || iid < 0) continue;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const idx = nr * cols + nc;
          if (touch[idx] === NONE) touch[idx] = iid;
          else if (touch[idx] !== iid) touch[idx] = MULTI;
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
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const visited = new Set<number>(isl.cells);
      const queue: [number, number][] = []; // [cell index, distance]
      for (const idx of isl.cells)
        for (const n of this.neighborIdx(idx))
          if (this.grid.cells[n] === UNKNOWN && !visited.has(n)) {
            visited.add(n); queue.push([n, 1]);
          }
      for (let qi = 0; qi < queue.length; qi++) {
        const [idx, dist] = queue[qi];
        if (dist > remaining) continue;
        if (touch[idx] !== isl.id && touch[idx] !== NONE) continue;
        if (!reach.has(idx)) reach.set(idx, []);
        reach.get(idx)!.push(isl.id);
        for (const n of this.neighborIdx(idx))
          if (this.grid.cells[n] === UNKNOWN && !visited.has(n)) {
            visited.add(n); queue.push([n, dist + 1]);
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
      for (const n of this.neighborIdx(idx))
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
    const seen = new Set<number>();
    const regions: { cells: number[]; liberties: number[] }[] = [];
    for (let start = 0; start < this.grid.cells.length; start++) {
      if (this.grid.cells[start] !== BLACK || seen.has(start)) continue;
      const cells = [start];
      seen.add(start);
      const liberties = new Set<number>();
      for (let qi = 0; qi < cells.length; qi++)
        for (const n of this.neighborIdx(cells[qi])) {
          if (this.grid.cells[n] === BLACK && !seen.has(n)) { seen.add(n); cells.push(n); }
          if (this.grid.cells[n] === UNKNOWN) liberties.add(n);
        }
      regions.push({ cells, liberties: [...liberties] });
    }
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

  // Apply rules until none changes anything. Cheap rules first; the
  // reach-based rules (which need a fresh BFS map) only run when the cheap
  // ones have stalled, so the map is never stale.
  // Returns false if the resulting grid is contradictory.
  propagate(): boolean {
    let changed = true;
    while (changed) {
      changed = this.ruleIslandComplete() || this.ruleSeparateIslands()
             || this.ruleForcedExpansion() || this.ruleSeaExpansion()
             || this.ruleSeaFill();
      if (changed) continue;
      const reach = this.computeReach();
      changed = this.ruleUnreachable(reach) || this.ruleIslandFill(reach);
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
    const mustGrow = regions.length >= 2 || this.count(BLACK) < this.blackTarget;
    if (mustGrow)
      for (const reg of regions)
        if (reg.liberties.length === 0) return 'water region walled off';

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
    const visited = new Set<number>(isl.cells);
    visited.add(excluded);
    const queue: [number, number][] = [];
    for (const idx of isl.cells)
      for (const n of this.neighborIdx(idx))
        if (this.grid.cells[n] === UNKNOWN && !visited.has(n)) {
          visited.add(n); queue.push([n, 1]);
        }
    let found = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const [idx, dist] = queue[qi];
      if (dist > remaining) continue;
      if (touch[idx] !== isl.id && touch[idx] !== NONE) continue;
      if (++found >= remaining) return found;
      for (const n of this.neighborIdx(idx))
        if (this.grid.cells[n] === UNKNOWN && !visited.has(n)) {
          visited.add(n); queue.push([n, dist + 1]);
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
        for (const n of this.neighborIdx(idx))
          changed = this.markBlack(n, 'Complete island is surrounded by water') || changed;
    }
    return changed;
  }
}
