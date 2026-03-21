import { Grid, Island, UNKNOWN, BLACK, WHITE } from './puzzle';

type Cell = [number, number];
type StepCb = (snap: Grid, rule: string) => void;

export class Solver {
  private grid:    Grid;
  private timeout: number = 30;
  private start:   number = 0;
  private stepCb:  StepCb | null = null;

  constructor(grid: Grid) { this.grid = grid; }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  solve(stepCallback?: StepCb, timeout = 30): [boolean, number] {
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
      [() => this._ruleCompletion(),      'Island complete — neighbors must be water'],
      [() => this._ruleIsolation(),       'Cell unreachable by any island — must be water'],
      [() => this._ruleNo2x2(),           'Prevents 2×2 water block'],
      [() => this._ruleForcedExpansion(), 'Island must expand to reach target size'],
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

  // ---------------------------------------------------------------------------
  // Island sync
  // ---------------------------------------------------------------------------

  private _initIslandCells(): void {
    for (const isl of this.grid.islands) isl.cells = new Set();
    const n = this.grid.rows * this.grid.cols;
    for (let idx = 0; idx < n; idx++) {
      const iid = this.grid.islandId[idx];
      if (iid >= 0) {
        const r = Math.floor(idx / this.grid.cols);
        const c = idx % this.grid.cols;
        this.grid.islands[iid].cells.add(`${r},${c}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Backtracking
  // ---------------------------------------------------------------------------

  private _backtrack(): boolean {
    if (performance.now() / 1000 - this.start > this.timeout) return false;
    this._propagate();
    if (this._contradiction()) return false;
    if (this.grid.isComplete()) return true;

    const cell = this._selectCell();
    if (!cell) return this.grid.isComplete();

    const [r, c]  = cell;
    const snap    = this.grid.copy();

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
    if (candidates[0][0] !== WHITE && adj.size === 1) {
      const iid = [...adj][0];
      const isl = this.grid.islands[iid];
      if (isl.cells.size < isl.size) candidates.push([WHITE, iid]);
    }

    for (const [value, iid] of candidates) {
      this._doAssign(r, c, value, iid);
      if (this._backtrack()) return true;
      this.grid.restore(snap);
      this._initIslandCells();
    }
    return false;
  }

  private _selectCell(): Cell | null {
    const reach = this._computeReachability();
    const forced: Cell[] = [];
    let adjBest:    [number, number, number] | null = null;
    let nonAdjBest: [number, number, number] | null = null;

    for (let r = 0; r < this.grid.rows; r++) {
      for (let c = 0; c < this.grid.cols; c++) {
        if (this.grid.get(r, c) !== UNKNOWN) continue;
        const count = reach.get(`${r},${c}`)?.length ?? 0;
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
      this.grid.islands[iid].cells.add(`${r},${c}`);
    }
    if (this.stepCb) this.stepCb(this.grid.copy(), 'Backtrack guess');
  }

  // ---------------------------------------------------------------------------
  // Propagation
  // ---------------------------------------------------------------------------

  private _propagate(): void {
    for (let i = 0; i < 300; i++) {
      const c = this._ruleCompletion()    ||
                this._ruleIsolation()     ||
                this._ruleNo2x2()         ||
                this._ruleForcedExpansion();
      if (!c) break;
    }
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
    this.grid.islands[iid].cells.add(`${r},${c}`);
    if (this.stepCb) this.stepCb(this.grid.copy(), rule);
    return true;
  }

  private _ruleCompletion(): boolean {
    let changed = false;
    for (const isl of this.grid.islands) {
      if (isl.cells.size !== isl.size) continue;
      for (const key of isl.cells) {
        const [r, c] = key.split(',').map(Number);
        for (const [nr, nc] of this.grid.neighbors(r, c))
          if (this._markBlack(nr, nc, 'Completion: island full')) changed = true;
      }
    }
    return changed;
  }

  private _ruleIsolation(): boolean {
    let changed = false;
    const reach = this._computeReachability();
    for (let r = 0; r < this.grid.rows; r++)
      for (let c = 0; c < this.grid.cols; c++)
        if (this.grid.get(r, c) === UNKNOWN && !(reach.get(`${r},${c}`)?.length))
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
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const visited = new Set<string>(isl.cells);
      const q: [Cell, number][] = [];
      let qi = 0;
      for (const key of isl.cells) {
        const [r, c] = key.split(',').map(Number);
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = `${nr},${nc}`;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            q.push([[nr, nc], 1]); visited.add(nk);
          }
        }
      }
      const reachable: Cell[] = [];
      while (qi < q.length) {
        const [[r, c], dist] = q[qi++];
        if (dist > remaining) continue;
        reachable.push([r, c]);
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = `${nr},${nc}`;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            visited.add(nk); q.push([[nr, nc], dist + 1]);
          }
        }
      }
      if (reachable.length === remaining)
        for (const [r, c] of reachable)
          if (this._markWhite(r, c, isl.id, 'Forced expansion')) changed = true;
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Contradiction
  // ---------------------------------------------------------------------------

  private _contradiction(): boolean {
    const { rows, cols } = this.grid;
    for (const isl of this.grid.islands) {
      const rem = isl.size - isl.cells.size;
      if (rem < 0) return true;
      if (rem > 0 && this._islandReachable(isl) < rem) return true;
    }
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++)
        if ([[0,0],[0,1],[1,0],[1,1]].every(([dr,dc]) => this.grid.get(r+dr, c+dc) === BLACK))
          return true;
    for (const key of this.grid.clues.keys()) {
      const [r, c] = key.split(',').map(Number);
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

  // ---------------------------------------------------------------------------
  // Reachability helpers
  // ---------------------------------------------------------------------------

  private _computeReachability(): Map<string, number[]> {
    const result = new Map<string, number[]>();
    for (const isl of this.grid.islands) {
      const remaining = isl.size - isl.cells.size;
      if (remaining <= 0) continue;
      const visited = new Set<string>(isl.cells);
      const q: [Cell, number][] = [];
      let qi = 0;
      for (const key of isl.cells) {
        const [r, c] = key.split(',').map(Number);
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = `${nr},${nc}`;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            q.push([[nr, nc], 1]); visited.add(nk);
          }
        }
      }
      while (qi < q.length) {
        const [[r, c], dist] = q[qi++];
        if (dist > remaining) continue;
        const k = `${r},${c}`;
        if (!result.has(k)) result.set(k, []);
        result.get(k)!.push(isl.id);
        for (const [nr, nc] of this.grid.neighbors(r, c)) {
          const nk = `${nr},${nc}`;
          if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
            visited.add(nk); q.push([[nr, nc], dist + 1]);
          }
        }
      }
    }
    return result;
  }

  private _islandReachable(isl: Island): number {
    const remaining = isl.size - isl.cells.size;
    if (remaining <= 0) return 0;
    const visited = new Set<string>(isl.cells);
    const q: [Cell, number][] = [];
    let qi = 0;
    for (const key of isl.cells) {
      const [r, c] = key.split(',').map(Number);
      for (const [nr, nc] of this.grid.neighbors(r, c)) {
        const nk = `${nr},${nc}`;
        if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
          q.push([[nr, nc], 1]); visited.add(nk);
        }
      }
    }
    let count = 0;
    while (qi < q.length) {
      const [[r, c], dist] = q[qi++];
      if (dist > remaining) continue;
      count++;
      for (const [nr, nc] of this.grid.neighbors(r, c)) {
        const nk = `${nr},${nc}`;
        if (this.grid.get(nr, nc) === UNKNOWN && !visited.has(nk)) {
          visited.add(nk); q.push([[nr, nc], dist + 1]);
        }
      }
    }
    return count;
  }
}
