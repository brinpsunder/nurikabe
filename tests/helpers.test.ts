import { describe, it, expect } from 'vitest';
import { parsePuzzle, UNKNOWN, BLACK, WHITE } from '../src/lib/puzzle';
import { gridFrom } from './helpers';

describe('test runner smoke test', () => {
  it('parses a minimal puzzle', () => {
    const g = parsePuzzle('1 0\n0 0');
    expect(g.rows).toBe(2);
    expect(g.cols).toBe(2);
    expect(g.clues.size).toBe(1);
  });
});

describe('gridFrom', () => {
  it('builds a grid from clues only', () => {
    const g = gridFrom('2 0 0');
    expect(g.get(0, 0)).toBe(WHITE);
    expect(g.get(0, 1)).toBe(UNKNOWN);
  });

  it('paints water, island cells and leaves dots unknown', () => {
    const g = gridFrom('2 0 0\n0 0 3', ['.a#', '...']);
    expect(g.get(0, 1)).toBe(WHITE);
    expect(g.getIslandId(0, 1)).toBe(0);           // 'a' = first clue's island
    expect(g.islands[0].cells.has(1)).toBe(true);  // island cell set updated
    expect(g.get(0, 2)).toBe(BLACK);
    expect(g.get(1, 0)).toBe(UNKNOWN);
  });
});
