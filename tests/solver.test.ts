import { describe, it, expect } from 'vitest';
import { Solver } from '../src/lib/solver';
import { gridFrom } from './helpers';
import { UNKNOWN, BLACK, WHITE, validateSolution } from '../src/lib/puzzle';

describe('Solver basics', () => {
  it('computes white and black cell targets from the clues', () => {
    const s = new Solver(gridFrom('2 0 0\n0 0 3'));
    expect(s.whiteTarget).toBe(5);
    expect(s.blackTarget).toBe(1);
  });

  it('rebuilds island cell sets from the grid (sync on construction)', () => {
    const g = gridFrom('2 0 0');
    g.cells[1] = WHITE;       // simulate GUI writing cells directly
    g.islandId[1] = 0;        // without updating islands[0].cells
    const s = new Solver(g);
    expect(g.islands[0].cells.has(1)).toBe(true);
  });
});
