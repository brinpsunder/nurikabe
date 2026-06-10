import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePuzzle, validateSolution } from '../src/lib/puzzle';
import { Solver } from '../src/lib/solver';

// The grade gate: every shipped puzzle must solve, be valid, and stay inside
// its time budget (seconds, with ~2x headroom over measured times so slower
// machines do not flake).
const FILES: [string, number][] = [
  ['easy_5x5.txt',      1],
  ['medium_10x10.txt',  1],
  ['hard_20x20.txt',    1],
  ['primer1_18x10.txt', 1],
  ['primer2_24x14.txt', 1],
  ['primer3_24x14.txt', 8],
  ['vrazji1_24x14.txt', 4],
  ['vrazji2_24x14.txt', 8],
];

describe('full puzzle suite', () => {
  for (const [file, budget] of FILES) {
    it(`solves ${file} within ${budget}s`, () => {
      const g = parsePuzzle(readFileSync(`public/puzzles/${file}`, 'utf8'));
      const s = new Solver(g);
      const [ok, elapsed] = s.solve(undefined, 30);
      console.log(`${file}: ${elapsed.toFixed(3)}s, ${s.nodes} search nodes`);
      expect(ok).toBe(true);
      expect(validateSolution(g)[0]).toBe(true);
      expect(elapsed).toBeLessThan(budget);
    }, 35000);
  }
});
