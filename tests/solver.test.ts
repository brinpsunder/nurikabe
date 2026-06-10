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

describe('ruleIslandComplete', () => {
  it('surrounds a complete island with water', () => {
    const g = gridFrom('1 0\n0 0');
    const s = new Solver(g);
    expect(s.ruleIslandComplete()).toBe(true);
    expect(g.get(0, 1)).toBe(BLACK);
    expect(g.get(1, 0)).toBe(BLACK);
    expect(g.get(1, 1)).toBe(UNKNOWN); // diagonal is not a neighbor
    expect(s.ruleIslandComplete()).toBe(false); // second run changes nothing
  });

  it('leaves incomplete islands alone', () => {
    const g = gridFrom('2 0\n0 0');
    expect(new Solver(g).ruleIslandComplete()).toBe(false);
  });
});

describe('ruleSeparateIslands', () => {
  it('marks a cell touching two different islands as water', () => {
    const g = gridFrom('2 0 2');
    const s = new Solver(g);
    expect(s.ruleSeparateIslands()).toBe(true);
    expect(g.get(0, 1)).toBe(BLACK);
  });

  it('does not mark a cell touching only one island', () => {
    const g = gridFrom('2 0 0');
    const s = new Solver(g);
    expect(s.ruleSeparateIslands()).toBe(false);
    expect(g.get(0, 1)).toBe(UNKNOWN);
  });
});

describe('computeReach / ruleUnreachable', () => {
  it('marks cells beyond every island\'s reach as water', () => {
    const g = gridFrom('2 0 0 0'); // island needs 1 more cell, reach distance 1
    const s = new Solver(g);
    expect(s.ruleUnreachable(s.computeReach())).toBe(true);
    expect(g.get(0, 1)).toBe(UNKNOWN); // reachable
    expect(g.get(0, 2)).toBe(BLACK);
    expect(g.get(0, 3)).toBe(BLACK);
  });

  it('reach never enters a cell that touches a different island', () => {
    const g = gridFrom('3 0 1'); // middle cell touches both islands
    const reach = new Solver(g).computeReach();
    expect(reach.has(1)).toBe(false);
  });
});
