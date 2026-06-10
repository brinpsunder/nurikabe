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
    return [false, this.now() - this.start]; // real search in a later task
  }

  hint(): [[number, number], number, string] | null {
    return null; // real implementation in a later task
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

  // Rule: a cell no island can reach must be water.
  ruleUnreachable(reach: Map<number, number[]>): boolean {
    let changed = false;
    for (let idx = 0; idx < this.grid.cells.length; idx++)
      if (this.grid.cells[idx] === UNKNOWN && !reach.has(idx))
        changed = this.markBlack(idx, 'No island can reach this cell') || changed;
    return changed;
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
