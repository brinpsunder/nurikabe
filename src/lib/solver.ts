import { Grid, Island, UNKNOWN, BLACK, WHITE } from './puzzle';

type Cell = [number, number];
type StepCb = (snap: Grid, rule: string) => void;
type Reach = Map<number, number[]>;  // flat index -> island ids that can reach it

export class Solver {
  private grid:    Grid;
  private timeout: number = 60;
  private start:   number = 0;
  private stepCb:  StepCb | null = null;

  constructor(grid: Grid) { this.grid = grid; }

  solve(stepCallback?: StepCb, timeout = 60): [boolean, number] {
    this.timeout = timeout;
    this.start   = performance.now() / 1000;
    this.stepCb  = stepCallback ?? null;
    this._initIslandCells();
    const ok      = this._backtrack();
    const elapsed = performance.now() / 1000 - this.start;
    return [ok, elapsed];
  }

  hint(): [Cell, number, string] | null {
    const snap = this.grid.copy();
    const rules: [() => boolean, string][] = [
      [() => this._ruleCompletion(),                                'Island complete — neighbors must be water'],
      [() => this._ruleAdjacentToMultipleIslands(),                 'Between two islands — must be water'],
      [() => this._ruleIsolation(this._computeReachability()),      'Cell unreachable by any island — must be water'],
      [() => this._ruleNo2x2(),                                     'Prevents 2×2 water block'],
      [() => this._ruleForcedExpansion(),                           'Island must expand to reach target size'],
    ];
    for (const [fn, name] of rules) {
      this._initIslandCells();
      const before = [...this.grid.cells];
      fn();
      for (let idx = 0; idx < before.length; idx++) {
        if (before[idx] !== this.grid.cells[idx]) {
          const r   = Math.floor(idx / this.grid.cols);
          const c   = idx % this.grid.cols;
          const val = this.grid.get(r, c);
          this.grid.restore(snap);
          this._initIslandCells();
          return [[r, c], val, name];
        }
      }
      this.grid.restore(snap);
      this._initIslandCells();
    }
    return null;
  }

  private _initIslandCells(): void {
    for (const isl of this.grid.islands) isl.cells = new Set();
    const n = this.grid.rows * this.grid.cols;
    for (let idx = 0; idx < n; idx++) {
      const iid = this.grid.islandId[idx];
      if (iid >= 0) this.grid.islands[iid].cells.add(idx);
    }
  }

  private _backtrack(): boolean {
    if (performance.now() / 1000 - this.start > this.timeout) return false;
    const reach = this._propagate();
    if (this._contradiction(reach)) return false;
    if (this.grid.isComplete()) return true;

    const cell = this._selectCell(reach);
    if (!cell) return this.grid.isComplete();

    const [r, c] = cell;
    const snap   = this.grid.copy();

    const adj = new Set<number>();
    for (const [nr, nc] of this.grid.neighbors(r, c)) {
      const iid = this.grid.getIslandId(nr, nc);
      if (iid >= 0) adj.add(iid);
    }

    const candidates: [number, number][] = [];
    if (adj.size === 1) {
      const iid = [...adj][0];
      const isl = this.grid.islands[iid];
      if (isl.cells.size < isl.size) candidates.push([WHITE, iid]);
    }
    candidates.push([BLACK, -1]);

    for (const [value, iid] of candidates) {
      this._doAssign(r, c, value, iid);
      if (this._backtrack()) return true;
      this.grid.restore(snap);
      this._initIslandCells();
    }
    return false;
  }

  private _selectCell(reach: Reach): Cell | null {
    const forced: Cell[] = [];
    let adjBest:    [number, number, number] | null = null;
    let nonAdjBest: [number, number, number] | null = null;

    for (let r = 0; r < this.grid.rows; r++) {
      for (let c = 0; c < this.grid.cols; c++) {
        if (this.grid.get(r, c) !== UNKNOWN) continue;
        const idx   = r * this.grid.cols + c;
        const count = reach.get(idx)?.length ?? 0;
        if (count === 0) { forced.push([r, c]); continue; }

        let hasAdj = false;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const iid = this.grid.getIslandId(nr, nc);
          if (iid >= 0 && this.grid.islands[iid].cells.size < this.grid.islands[iid].size) {
            hasAdj = true; break;
          }
        }
        if (hasAdj) { if (!adjBest    || count < adjBest[0])    adjBest    = [count, r, c]; }
        else        { if (!nonAdjBest || count < nonAdjBest[0]) nonAdjBest = [count, r, c]; }
      }
    }

    for (const [r, c] of forced) this._doAssign(r, c, BLACK, -1);
    if (adjBest)    return [adjBest[1],    adjBest[2]];
    if (nonAdjBest) return [nonAdjBest[1], nonAdjBest[2]];
    return null;
  }

  private _doAssign(r: number, c: number, value: number, iid: number): void {
    this.grid.set(r, c, value);
    if (value === BLACK) {
      this.grid.setIslandId(r, c, -1);
    } else if (value === WHITE && iid >= 0) {
      this.grid.setIslandId(r, c, iid);
      this.grid.islands[iid].cells.add(r * this.grid.cols + c);
    }
    if (this.stepCb) this.stepCb(this.grid.copy(), 'Backtrack guess');
  }

  private _propagate(): Reach {
    let reach = this._computeReachability();
    for (let i = 0; i < 300; i++) {
      let changed = this._ruleCompletion();
      changed = this._ruleAdjacentToMultipleIslands() || changed;
      if (changed) reach = this._computeReachability();
      changed = this._ruleIsolation(reach)            || changed;
      changed = this._ruleNo2x2()                     || changed;
      changed = this._ruleForcedExpansion()            || changed;
      changed = this._ruleConnectivityPruning(reach)   || changed;
      if (!changed) break;
      reach = this._computeReachability();
    }
    return reach;
  }

  private _markBlack(r: number, c: number, rule: string): boolean {
    if (this.grid.get(r, c) !== UNKNOWN) return false;
    this.grid.set(r, c, BLACK); this.grid.setIslandId(r, c, -1);
    if (this.stepCb) this.stepCb(this.grid.copy(), rule);
    return true;
  }

  private _markWhite(r: number, c: number, iid: number, rule: string): boolean {
    if (this.grid.get(r, c) !== UNKNOWN) return false;
    this.grid.set(r, c, WHITE); this.grid.setIslandId(r, c, iid);
    this.grid.islands[iid].cells.add(r * this.grid.cols + c);
    if (this.stepCb) this.stepCb(this.grid.copy(), rule);
    return true;
  }

  private _ruleCompletion(): boolean {
    let changed = false;
    const cols = this.grid.cols;
    for (const isl of this.grid.islands) {
      if (isl.cells.size !== isl.size) continue;
      for (const idx of isl.cells) {
        const r = Math.floor(idx / cols), c = idx % cols;
        for (const [nr, nc] of this.grid.neighbors(r, c))
          if (this._markBlack(nr, nc, 'Completion: island full')) changed = true;
      }
    }
    return changed;
  }

  // Any unknown cell touching two different islands must be water (would merge them).
  private _ruleAdjacentToMultipleIslands(): boolean {
    let changed = false;
    for (let r = 0; r < this.grid.rows; r++) {
      for (let c = 0; c < this.grid.cols; c++) {
        if (this.grid.get(r, c) !== UNKNOWN) continue;
        const adj = new Set<number>();
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const iid = this.grid.getIslandId(nr, nc);
          if (iid >= 0) adj.add(iid);
        }
        if (adj.size >= 2)
          if (this._markBlack(r, c, 'Between two islands')) changed = true;
      }
    }
    return changed;
  }

  private _ruleIsolation(reach: Reach): boolean {
    let changed = false;
    for (let r = 0; r < this.grid.rows; r++)
      for (let c = 0; c < this.grid.cols; c++)
        if (this.grid.get(r, c) === UNKNOWN && !(reach.get(r * this.grid.cols + c)?.length))
          if (this._markBlack(r, c, 'Isolation: unreachable')) changed = true;
    return changed;
  }

  private _ruleNo2x2(): boolean {
    let changed = false;
    for (let r = 0; r < this.grid.rows - 1; r++) {
      for (let c = 0; c < this.grid.cols - 1; c++) {
        const corners: Cell[] = [[r,c],[r,c+1],[r+1,c],[r+1,c+1]];
        const blacks   = corners.filter(([cr,cc]) => this.grid.get(cr, cc) === BLACK).length;
        const unknowns = corners.filter(([cr,cc]) => this.grid.get(cr, cc) === UNKNOWN);
        if (blacks !== 3 || unknowns.length !== 1) continue;
        const [nr, nc] = unknowns[0];
        let adjIid: number | null = null;
        for (const [xr, xc] of this.grid.neighbors(nr, nc)) {
          const iid = this.grid.getIslandId(xr, xc);
          if (iid >= 0 && this.grid.islands[iid].cells.size < this.grid.islands[iid].size) {
            adjIid = iid; break;
          }
        }
        if (adjIid !== null && this._markWhite(nr, nc, adjIid, 'No-2×2 rule')) changed = true;
      }
    }
    return changed;
  }

  private _ruleForcedExpansion(): boolean {
    let changed = false;
    const cols = this.grid.cols;
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const visited = new Set<number>(isl.cells);
      const q: [number, number][] = [];  // [flat index, dist]
      let qi = 0;
      for (const idx of isl.cells) {
        const r = Math.floor(idx / cols), c = idx % cols;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = nr * cols + nc;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            q.push([nk, 1]); visited.add(nk);
          }
        }
      }
      const reachable: [number, number][] = [];  // [r, c]
      while (qi < q.length) {
        const [nk, dist] = q[qi++];
        if (dist > remaining) continue;
        const r = Math.floor(nk / cols), c = nk % cols;
        reachable.push([r, c]);
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nnk = nr * cols + nc;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nnk)) {
            visited.add(nnk); q.push([nnk, dist + 1]);
          }
        }
      }
      if (reachable.length === remaining)
        for (const [r, c] of reachable)
          if (this._markWhite(r, c, isl.id, 'Forced expansion')) changed = true;
    }
    return changed;
  }

  // If marking cell X as BLACK would leave island I unable to reach its target size,
  // X must be WHITE (assigned to island I). Only checks cells adjacent to exactly one
  // incomplete island to keep cost bounded.
  private _ruleConnectivityPruning(reach: Reach): boolean {
    let changed = false;
    const cols = this.grid.cols;
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 1) continue;  // forced expansion handles remaining==1

      // Collect frontier unknown cells adjacent to this island
      const frontier = new Set<number>();
      for (const idx of isl.cells) {
        const r = Math.floor(idx / cols), c = idx % cols;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = nr * cols + nc;
          if (this.grid.get(nr, nc) === UNKNOWN) frontier.add(nk);
        }
      }

      for (const xk of frontier) {
        // Check if x is adjacent to only this island (not between 2 islands)
        const xr = Math.floor(xk / cols), xc = xk % cols;
        const reachingIslands = reach.get(xk);
        if (!reachingIslands || reachingIslands.length > 1) continue;
        if (reachingIslands[0] !== isl.id) continue;

        // BFS from island cells through UNKNOWN cells, excluding xk
        const visited = new Set<number>(isl.cells);
        visited.add(xk);  // skip xk
        const q: [number, number][] = [];
        let qi = 0;
        for (const idx of isl.cells) {
          const r = Math.floor(idx / cols), c = idx % cols;
          for (const [nr, nc] of this.grid.neighbors(r, c)) {
            const nk = nr * cols + nc;
            if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
              q.push([nk, 1]); visited.add(nk);
            }
          }
        }
        let reachableCount = 0;
        while (qi < q.length) {
          const [nk, dist] = q[qi++];
          if (dist > remaining) continue;
          reachableCount++;
          if (reachableCount >= remaining - 1) break;  // enough, no need to continue
          const r = Math.floor(nk / cols), c = nk % cols;
          for (const [nr, nc] of this.grid.neighbors(r, c)) {
            const nnk = nr * cols + nc;
            if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nnk)) {
              visited.add(nnk); q.push([nnk, dist + 1]);
            }
          }
        }

        // If excluding xk leaves fewer than (remaining-1) reachable cells, xk must be WHITE
        if (reachableCount < remaining - 1) {
          if (this._markWhite(xr, xc, isl.id, 'Connectivity pruning')) changed = true;
        }
      }
    }
    return changed;
  }

  // Use the pre-computed reach map instead of running separate BFS per island.
  private _contradiction(reach: Reach): boolean {
    // Island reachability: count UNKNOWN cells each island can reach
    const islandReach = new Map<number, number>();
    for (const isls of reach.values())
      for (const iid of isls)
        islandReach.set(iid, (islandReach.get(iid) ?? 0) + 1);

    for (const isl of this.grid.islands) {
      const rem = isl.size - isl.cells.size;
      if (rem < 0) return true;
      if (rem > 0 && (islandReach.get(isl.id) ?? 0) < rem) return true;
    }

    const { rows, cols } = this.grid;
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++)
        if ([[0,0],[0,1],[1,0],[1,1]].every(([dr,dc]) => this.grid.get(r+dr, c+dc) === BLACK))
          return true;

    for (const key of this.grid.clues.keys()) {
      const r = Math.floor(key / cols), c = key % cols;
      if (this.grid.get(r, c) === BLACK) return true;
    }

    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (this.grid.get(r, c) !== WHITE) continue;
        const iid1 = this.grid.getIslandId(r, c);
        if (iid1 < 0) continue;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          if (this.grid.get(nr, nc) === WHITE) {
            const iid2 = this.grid.getIslandId(nr, nc);
            if (iid2 >= 0 && iid1 !== iid2) return true;
          }
        }
      }
    return false;
  }

  private _computeReachability(): Reach {
    const result: Reach = new Map();
    const cols = this.grid.cols;
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const visited = new Set<number>(isl.cells);
      const q: [number, number][] = [];  // [flat index, dist]
      let qi = 0;
      for (const idx of isl.cells) {
        const r = Math.floor(idx / cols), c = idx % cols;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = nr * cols + nc;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            q.push([nk, 1]); visited.add(nk);
          }
        }
      }
      while (qi < q.length) {
        const [nk, dist] = q[qi++];
        if (dist > remaining) continue;
        if (!result.has(nk)) result.set(nk, []);
        result.get(nk)!.push(isl.id);
        const r = Math.floor(nk / cols), c = nk % cols;
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nnk = nr * cols + nc;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nnk)) {
            visited.add(nnk); q.push([nnk, dist + 1]);
          }
        }
      }
    }
    return result;
  }
}
