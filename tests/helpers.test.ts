import { describe, it, expect } from 'vitest';
import { parsePuzzle } from '../src/lib/puzzle';

describe('test runner smoke test', () => {
  it('parses a minimal puzzle', () => {
    const g = parsePuzzle('1 0\n0 0');
    expect(g.rows).toBe(2);
    expect(g.cols).toBe(2);
    expect(g.clues.size).toBe(1);
  });
});
