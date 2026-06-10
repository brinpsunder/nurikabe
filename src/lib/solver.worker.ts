import { parsePuzzle } from './puzzle';
import { Solver } from './solver';

type StepMsg = { cells: number[]; islandId: number[]; rule: string };

self.onmessage = (e: MessageEvent) => {
  const { type, puzzleText, timeout, wantSteps } = e.data;
  if (type === 'cancel') return;

  let grid;
  try {
    grid = parsePuzzle(puzzleText);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message });
    return;
  }

  if (!wantSteps) {
    const [solved, elapsed] = new Solver(grid).solve(undefined, timeout);
    self.postMessage({
      type: 'result', solved, elapsed,
      cells: grid.cells, islandId: grid.islandId,
    });
  } else {
    const snapshots: StepMsg[] = [];
    const MAX_STEPS = 3000;
    const [solved, elapsed] = new Solver(grid).solve((snap, rule) => {
      if (snapshots.length < MAX_STEPS)
        snapshots.push({ cells: [...snap.cells], islandId: [...snap.islandId], rule });
    }, timeout);
    self.postMessage({ type: 'steps', solved, elapsed, snapshots });
  }
};
