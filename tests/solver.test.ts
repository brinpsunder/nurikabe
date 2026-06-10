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

  it('surrounds a multi-cell complete island', () => {
    const g = gridFrom('2 0 0', ['.a.']); // island 0 = cells (0,0)+(0,1), complete
    const s = new Solver(g);
    expect(s.ruleIslandComplete()).toBe(true);
    expect(g.get(0, 2)).toBe(BLACK); // neighbor of the expanded cell
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

describe('ruleForcedExpansion', () => {
  it('grows an island that has exactly one liberty', () => {
    const g = gridFrom('2 0\n0 0', ['.#', '..']);
    const s = new Solver(g);
    expect(s.ruleForcedExpansion()).toBe(true);
    expect(g.get(1, 0)).toBe(WHITE);
    expect(g.getIslandId(1, 0)).toBe(0);
  });

  it('does nothing when an island has two liberties', () => {
    const g = gridFrom('2 0\n0 0');
    expect(new Solver(g).ruleForcedExpansion()).toBe(false);
  });
});

describe('ruleIslandFill', () => {
  it('fills an island whose reachable cells exactly match its remaining size', () => {
    const g = gridFrom('3 0 0\n0 0 0', ['...', '###']);
    const s = new Solver(g);
    expect(s.ruleIslandFill(s.computeReach())).toBe(true);
    expect(g.get(0, 1)).toBe(WHITE);
    expect(g.get(0, 2)).toBe(WHITE);
    expect(g.getIslandId(0, 2)).toBe(0);
  });

  it('does nothing when the island has spare room', () => {
    const g = gridFrom('2 0\n0 0'); // needs 1 more cell, can reach 2 cells
    const s = new Solver(g);
    expect(s.ruleIslandFill(s.computeReach())).toBe(false);
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

  it('marks nothing when every unknown cell is reachable', () => {
    const g = gridFrom('2 0'); // single unknown cell, within reach
    const s = new Solver(g);
    expect(s.ruleUnreachable(s.computeReach())).toBe(false);
    expect(g.get(0, 1)).toBe(UNKNOWN);
  });
});

describe('ruleSeaExpansion', () => {
  it('extends a water region that has a single escape cell', () => {
    const g = gridFrom('1 0 0 1', ['.#..']); // 2 water cells needed in total
    const s = new Solver(g);
    expect(s.ruleSeaExpansion()).toBe(true);
    expect(g.get(0, 2)).toBe(BLACK);
  });

  it('does nothing when the sea is already complete and connected', () => {
    const g = gridFrom('1 0', ['.#']); // 1 water cell needed, 1 placed
    expect(new Solver(g).ruleSeaExpansion()).toBe(false);
  });
});

describe('ruleSeaFill', () => {
  it('floods all remaining cells once every island is complete', () => {
    const g = gridFrom('1 0\n0 1'); // both islands are size-1 clues, already complete
    const s = new Solver(g);
    expect(s.ruleSeaFill()).toBe(true);
    expect(g.get(0, 1)).toBe(BLACK);
    expect(g.get(1, 0)).toBe(BLACK);
  });

  it('does nothing while islands are incomplete', () => {
    const g = gridFrom('2 0 0');
    expect(new Solver(g).ruleSeaFill()).toBe(false);
  });
});
