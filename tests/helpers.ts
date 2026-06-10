import { parsePuzzle, BLACK, WHITE } from '../src/lib/puzzle';
import type { Grid } from '../src/lib/puzzle';

// Build a grid from clue text, then paint extra cells from an overlay.
// Overlay characters, one per cell: '.' = unknown, '#' = water,
// 'a','b','c',… = white cell of the 1st, 2nd, 3rd, … clue (clues are
// numbered in row-major order, matching Map insertion order in the parser).
// Clue cells themselves stay as parsed.
export function gridFrom(clueText: string, overlay?: string[]): Grid {
  const grid = parsePuzzle(clueText);
  if (!overlay) return grid;
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      const ch = overlay[r][c];
      const idx = r * grid.cols + c;
      if (ch === '.' || grid.clues.has(idx)) continue;
      if (ch === '#') {
        grid.set(r, c, BLACK);
      } else {
        const iid = ch.charCodeAt(0) - 97; // 'a' → island 0
        grid.set(r, c, WHITE);
        grid.setIslandId(r, c, iid);
        grid.islands[iid].cells.add(idx);
      }
    }
  return grid;
}
