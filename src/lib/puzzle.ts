export const UNKNOWN = -1;
export const BLACK   =  0;  // water
export const WHITE   =  1;  // island

export class Island {
  id:     number;
  origin: [number, number];
  size:   number;
  cells:  Set<string>;  // "r,c" string keys

  constructor(origin: [number, number], size: number, id: number) {
    this.id     = id;
    this.origin = origin;
    this.size   = size;
    this.cells  = new Set([`${origin[0]},${origin[1]}`]);
  }
}

export class Grid {
  rows:     number;
  cols:     number;
  clues:    Map<string, number>;  // "r,c" -> island size
  cells:    number[];             // UNKNOWN / BLACK / WHITE per cell
  islandId: number[];             // island id per cell, -1 = none
  islands:  Island[];

  constructor(rows: number, cols: number, clues: Map<string, number>) {
    this.rows     = rows;
    this.cols     = cols;
    this.clues    = clues;
    const n       = rows * cols;
    this.cells    = new Array(n).fill(UNKNOWN);
    this.islandId = new Array(n).fill(-1);
    this.islands  = [];
    this._buildIslands();
  }

  private _idx(r: number, c: number): number { return r * this.cols + c; }

  private _buildIslands(): void {
    let iid = 0;
    for (const [key, sz] of this.clues) {
      const [r, c] = key.split(',').map(Number);
      const isl    = new Island([r, c], sz, iid);
      this.islands.push(isl);
      const idx = this._idx(r, c);
      this.cells[idx]    = WHITE;
      this.islandId[idx] = iid;
      iid++;
    }
  }

  get(r: number, c: number): number          { return this.cells[this._idx(r, c)]; }
  set(r: number, c: number, v: number): void { this.cells[this._idx(r, c)] = v; }

  getIslandId(r: number, c: number): number          { return this.islandId[this._idx(r, c)]; }
  setIslandId(r: number, c: number, id: number): void { this.islandId[this._idx(r, c)] = id; }

  neighbors(r: number, c: number): [number, number][] {
    const res: [number, number][] = [];
    if (r > 0)              res.push([r - 1, c]);
    if (r < this.rows - 1) res.push([r + 1, c]);
    if (c > 0)              res.push([r, c - 1]);
    if (c < this.cols - 1) res.push([r, c + 1]);
    return res;
  }

  copy(): Grid {
    const g      = Object.create(Grid.prototype) as Grid;
    g.rows       = this.rows;
    g.cols       = this.cols;
    g.clues      = this.clues;                    // immutable, shared
    g.cells      = [...this.cells];
    g.islandId   = [...this.islandId];
    g.islands    = this.islands.map(isl => {
      const c    = new Island(isl.origin, isl.size, isl.id);
      c.cells    = new Set(isl.cells);
      return c;
    });
    return g;
  }

  restore(snap: Grid): void {
    this.cells    = [...snap.cells];
    this.islandId = [...snap.islandId];
    for (let i = 0; i < snap.islands.length; i++)
      this.islands[i].cells = new Set(snap.islands[i].cells);
  }

  isComplete(): boolean { return this.cells.every(v => v !== UNKNOWN); }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parsePuzzle(text: string): Grid {
  const rowsData: number[][] = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/\./g, '0');
    const tokens = line.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) continue;
    const row: number[] = [];
    for (const t of tokens) {
      const n = parseInt(t, 10);
      if (isNaN(n)) throw new Error(`Invalid token '${t}'`);
      row.push(n);
    }
    if (row.length) rowsData.push(row);
  }

  if (!rowsData.length) throw new Error('Empty puzzle');
  const numCols = rowsData[0].length;
  for (let i = 0; i < rowsData.length; i++)
    if (rowsData[i].length !== numCols)
      throw new Error(`Row ${i} has ${rowsData[i].length} cols, expected ${numCols}`);

  const clues = new Map<string, number>();
  for (let r = 0; r < rowsData.length; r++)
    for (let c = 0; c < rowsData[r].length; c++) {
      const v = rowsData[r][c];
      if (v < 0) throw new Error(`Negative clue at (${r},${c})`);
      if (v > 0) clues.set(`${r},${c}`, v);
    }

  if (!clues.size) throw new Error('No island clues found');
  return new Grid(rowsData.length, numCols, clues);
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateSolution(grid: Grid): [boolean, string] {
  const { rows, cols } = grid;

  // 1. No UNKNOWN cells
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid.get(r, c) === UNKNOWN) return [false, 'Grid has unknown cells'];

  // 2. Each island clue correct size, no overlap
  const visitedWhite = new Set<string>();
  for (const [key, sz] of grid.clues) {
    const [cr, cc] = key.split(',').map(Number);
    if (grid.get(cr, cc) !== WHITE) return [false, `Clue (${cr},${cc}) is not white`];
    const q: [number, number][] = [[cr, cc]];
    let qi = 0;
    const isle = new Set<string>();
    while (qi < q.length) {
      const [r, c] = q[qi++];
      const k = `${r},${c}`;
      if (isle.has(k)) continue;
      isle.add(k);
      for (const [nr, nc] of grid.neighbors(r, c))
        if (grid.get(nr, nc) === WHITE && !isle.has(`${nr},${nc}`))
          q.push([nr, nc]);
    }
    if (isle.size !== sz)
      return [false, `Island at (${cr},${cc}) has ${isle.size} cells, expected ${sz}`];
    for (const cell of isle)
      if (visitedWhite.has(cell)) return [false, `Islands merged at ${cell}`];
    for (const cell of isle) visitedWhite.add(cell);
  }

  // 3. All white cells belong to an island
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid.get(r, c) === WHITE && !visitedWhite.has(`${r},${c}`))
        return [false, `White cell (${r},${c}) not part of any island`];

  // 4. No 2×2 black block
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++)
      if ([[0,0],[0,1],[1,0],[1,1]].every(([dr,dc]) => grid.get(r+dr, c+dc) === BLACK))
        return [false, `2×2 black block at (${r},${c})`];

  // 5. Black cells connected
  const blacks: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid.get(r, c) === BLACK) blacks.push([r, c]);
  if (!blacks.length) return [false, 'No black cells'];

  const vb = new Set<string>();
  const bq: [number, number][] = [blacks[0]];
  let bqi = 0;
  while (bqi < bq.length) {
    const [r, c] = bq[bqi++];
    const k = `${r},${c}`;
    if (vb.has(k)) continue;
    vb.add(k);
    for (const [nr, nc] of grid.neighbors(r, c))
      if (grid.get(nr, nc) === BLACK && !vb.has(`${nr},${nc}`))
        bq.push([nr, nc]);
  }
  if (vb.size !== blacks.length) return [false, 'Black cells are not all connected'];

  return [true, 'Valid solution'];
}
