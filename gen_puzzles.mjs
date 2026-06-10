// Nurikabe 20x20 puzzle generator
// Correct approach: grow connected black region (no 2x2), then remaining = islands
import { writeFileSync } from 'fs';

const ROWS = 20, COLS = 20, N = ROWS * COLS;
const idx  = (r, c) => r * COLS + c;
const rc   = k => [Math.floor(k / COLS), k % COLS];
const nbrs = (r, c) => {
  const n = [];
  if (r > 0)      n.push([r-1,c]);
  if (r < ROWS-1) n.push([r+1,c]);
  if (c > 0)      n.push([r,c-1]);
  if (c < COLS-1) n.push([r,c+1]);
  return n;
};
const makeLCG = seed => { let s=seed>>>0; return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s}; };
const shuffle = (arr, rng) => { for(let i=arr.length-1;i>0;i--){const j=rng()%(i+1);[arr[i],arr[j]]=[arr[j],arr[i]]} };

// Would marking (r,c) black create a 2x2 black block?
function creates2x2(black, r, c) {
  const tops = [0, -1], lefts = [0, -1];
  for (const dr of tops) for (const dc of lefts) {
    const r0 = r+dr, c0 = c+dc;
    if (r0<0||r0>=ROWS-1||c0<0||c0>=COLS-1) continue;
    const corners = [[r0,c0],[r0,c0+1],[r0+1,c0],[r0+1,c0+1]];
    if (corners.every(([cr,cc]) => (cr===r&&cc===c) || black[idx(cr,cc)])) return true;
  }
  return false;
}

// Find connected white components
function whiteComponents(black) {
  const comp = new Int16Array(N).fill(-1);
  let n = 0;
  for (let k=0; k<N; k++) {
    if (black[k] || comp[k]>=0) continue;
    const q=[k]; comp[k]=n;
    for(let qi=0;qi<q.length;qi++){
      const[r,c]=rc(q[qi]);
      for(const[nr,nc]of nbrs(r,c)){
        const nk=idx(nr,nc);
        if(!black[nk]&&comp[nk]<0){comp[nk]=n;q.push(nk);}
      }
    }
    n++;
  }
  return { comp, n };
}

function generate(seed, targetBlackRatio) {
  const rng  = makeLCG(seed);
  const rand = n => rng() % n;

  const black = new Uint8Array(N);  // 1 = black, 0 = white
  const targetBlack = Math.floor(N * targetBlackRatio);

  // Start from a random interior cell
  const start = idx(2 + rand(ROWS-4), 2 + rand(COLS-4));
  black[start] = 1;
  let blackCount = 1;

  // Frontier: cells adjacent to black that could become black
  const frontier = new Set();
  const [sr, sc] = rc(start);
  for (const [nr, nc] of nbrs(sr, sc)) frontier.add(idx(nr, nc));

  let attempts = 0;
  while (blackCount < targetBlack && frontier.size > 0 && attempts < N * 10) {
    attempts++;
    const arr = [...frontier];
    const pick = arr[rand(arr.length)];
    frontier.delete(pick);
    const [r, c] = rc(pick);
    if (black[pick]) continue;
    if (creates2x2(black, r, c)) continue;
    black[pick] = 1;
    blackCount++;
    for (const [nr, nc] of nbrs(r, c)) {
      const nk = idx(nr, nc);
      if (!black[nk]) frontier.add(nk);
    }
  }

  if (blackCount < N * 0.45) return null;  // not enough black cells

  // Find white components (islands)
  const { comp, n: numIslands } = whiteComponents(black);
  if (numIslands < 10 || numIslands > 50) return null;

  // Compute island sizes
  const islandSizes = new Array(numIslands).fill(0);
  const islandCells = Array.from({length: numIslands}, () => []);
  for (let k=0; k<N; k++) {
    if (!black[k]) {
      islandSizes[comp[k]]++;
      islandCells[comp[k]].push(k);
    }
  }

  // Check island sizes are reasonable (1-10)
  if (islandSizes.some(s => s > 10)) return null;
  if (islandSizes.filter(s => s === 1).length > numIslands * 0.3) return null;  // too many size-1 islands

  // Build puzzle: clue cell = first cell of each island component (sorted by position)
  const grid = Array.from({length: ROWS}, () => new Array(COLS).fill(0));
  for (let i=0; i<numIslands; i++) {
    const cells = islandCells[i].sort((a,b) => a-b);
    const [r, c] = rc(cells[0]);
    grid[r][c] = islandSizes[i];
  }

  return { grid, numIslands, islandSizes, blackCount };
}

const configs = [
  { name: 'medium2_20x20', blackRatio: 0.55, seedRange: [1,   5000] },
  { name: 'hard2_20x20',   blackRatio: 0.60, seedRange: [1,   5000] },
  { name: 'hard3_20x20',   blackRatio: 0.58, seedRange: [500, 5000] },
];

for (const { name, blackRatio, seedRange: [lo, hi] } of configs) {
  let found = false;
  for (let seed = lo; seed < hi && !found; seed++) {
    const res = generate(seed, blackRatio);
    if (!res) continue;
    const { grid, numIslands, islandSizes, blackCount } = res;
    if (numIslands < 15 || numIslands > 40) continue;

    writeFileSync(`public/puzzles/${name}.txt`, grid.map(r=>r.join(' ')).join('\n')+'\n');
    const sorted = [...islandSizes].sort((a,b)=>a-b);
    console.log(`${name}.txt  seed=${seed}  islands=${numIslands}  sizes=[${sorted.join(',')}]  black=${blackCount}`);
    found = true;
  }
  if (!found) console.log(`FAILED to generate ${name}`);
}
