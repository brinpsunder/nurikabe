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
}
