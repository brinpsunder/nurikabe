"""Grid model, file parser, and solution validator for Nurikabe."""

from __future__ import annotations
from collections import deque

UNKNOWN = -1
BLACK   =  0   # water
WHITE   =  1   # island


class Island:
    def __init__(self, origin: tuple[int, int], size: int, island_id: int):
        self.origin    = origin
        self.size      = size
        self.id        = island_id
        self.cells: set[tuple[int, int]] = {origin}

    def __repr__(self) -> str:
        return f"Island(id={self.id}, origin={self.origin}, size={self.size}, cells={len(self.cells)})"


class Grid:
    def __init__(self, rows: int, cols: int, clues: dict[tuple[int, int], int]):
        self.rows   = rows
        self.cols   = cols
        self.clues  = clues  # {(r,c): size}

        n = rows * cols
        # -1 = UNKNOWN, 0 = BLACK, 1 = WHITE
        self.cells: bytearray = bytearray(b'\xff' * n)  # 0xff == 255 used as sentinel; we map below
        # Use signed-style: store as 0=BLACK,1=WHITE,2=UNKNOWN internally in bytearray
        # Convention: 0->BLACK, 1->WHITE, 2->UNKNOWN
        self.cells = bytearray([2] * n)  # 2 == UNKNOWN sentinel

        # island id per cell; -1 = none
        self.island_id: list[int] = [-1] * n

        # Islands indexed by id
        self.islands: list[Island] = []
        self._build_islands()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _idx(self, r: int, c: int) -> int:
        return r * self.cols + c

    def _build_islands(self) -> None:
        for iid, ((r, c), sz) in enumerate(self.clues.items()):
            isl = Island((r, c), sz, iid)
            self.islands.append(isl)
            idx = self._idx(r, c)
            self.cells[idx] = 1  # WHITE
            self.island_id[idx] = iid

    # ------------------------------------------------------------------
    # Public cell accessors
    # ------------------------------------------------------------------
    def get(self, r: int, c: int) -> int:
        """Return UNKNOWN(-1), BLACK(0), or WHITE(1)."""
        v = self.cells[self._idx(r, c)]
        return -1 if v == 2 else v  # 2->UNKNOWN(-1), 0->BLACK, 1->WHITE

    def set(self, r: int, c: int, value: int) -> None:
        """Set cell to UNKNOWN(-1), BLACK(0), or WHITE(1)."""
        self.cells[self._idx(r, c)] = 2 if value == UNKNOWN else value

    def get_island_id(self, r: int, c: int) -> int:
        return self.island_id[self._idx(r, c)]

    def set_island_id(self, r: int, c: int, iid: int) -> None:
        self.island_id[self._idx(r, c)] = iid

    def neighbors(self, r: int, c: int) -> list[tuple[int, int]]:
        result = []
        if r > 0:             result.append((r - 1, c))
        if r < self.rows - 1: result.append((r + 1, c))
        if c > 0:             result.append((r, c - 1))
        if c < self.cols - 1: result.append((r, c + 1))
        return result

    # ------------------------------------------------------------------
    # Snapshot / copy
    # ------------------------------------------------------------------
    def copy(self) -> Grid:
        g = Grid.__new__(Grid)
        g.rows      = self.rows
        g.cols      = self.cols
        g.clues     = self.clues  # immutable, shared
        g.cells     = bytearray(self.cells)
        g.island_id = list(self.island_id)
        g.islands   = [Island(isl.origin, isl.size, isl.id) for isl in self.islands]
        for isl_orig, isl_copy in zip(self.islands, g.islands):
            isl_copy.cells = set(isl_orig.cells)
        return g

    def restore(self, snapshot: Grid) -> None:
        self.cells[:]     = snapshot.cells
        self.island_id[:] = snapshot.island_id
        for i, isl in enumerate(snapshot.islands):
            self.islands[i].cells = set(isl.cells)

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def is_complete(self) -> bool:
        for r in range(self.rows):
            for c in range(self.cols):
                if self.get(r, c) == UNKNOWN:
                    return False
        return True

    def count_unknown(self) -> int:
        return sum(1 for v in self.cells if v == 2)

    # ------------------------------------------------------------------
    # Debug
    # ------------------------------------------------------------------
    def __str__(self) -> str:
        chars = {UNKNOWN: '.', BLACK: '#', WHITE: 'O'}
        rows_str = []
        for r in range(self.rows):
            row = []
            for c in range(self.cols):
                v = self.get(r, c)
                if v == WHITE and (r, c) in self.clues:
                    row.append(str(self.clues[(r, c)]))
                else:
                    row.append(chars[v])
            rows_str.append(' '.join(row))
        return '\n'.join(rows_str)


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse_puzzle(text: str) -> Grid:
    """Parse puzzle text into a Grid. Raises ValueError on bad input."""
    rows_data = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        # Replace dots with 0
        line = line.replace('.', '0')
        # Split on whitespace or commas
        import re
        tokens = re.split(r'[\s,]+', line)
        if not tokens:
            continue
        row = []
        for t in tokens:
            if t == '':
                continue
            try:
                row.append(int(t))
            except ValueError:
                raise ValueError(f"Invalid token '{t}' in puzzle")
        if row:
            rows_data.append(row)

    if not rows_data:
        raise ValueError("Empty puzzle")

    num_rows = len(rows_data)
    num_cols = len(rows_data[0])
    for i, row in enumerate(rows_data):
        if len(row) != num_cols:
            raise ValueError(f"Row {i} has {len(row)} cols, expected {num_cols}")

    clues: dict[tuple[int, int], int] = {}
    for r, row in enumerate(rows_data):
        for c, val in enumerate(row):
            if val < 0:
                raise ValueError(f"Negative clue at ({r},{c})")
            if val > 0:
                clues[(r, c)] = val

    if not clues:
        raise ValueError("No island clues found")

    return Grid(num_rows, num_cols, clues)


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

def validate_solution(grid: Grid) -> tuple[bool, str]:
    
    """
    Check if the grid is a valid Nurikabe solution.
    Returns (True, "Valid solution") or (False, reason).
    """
    rows, cols = grid.rows, grid.cols

    # 1. No UNKNOWN cells
    for r in range(rows):
        for c in range(cols):
            if grid.get(r, c) == UNKNOWN:
                return False, "Grid has unknown cells"

    # 2. Each island clue has correct total size
    #    Use BFS/DFS from clue cells
    visited_white: set[tuple[int, int]] = set()

    for (cr, cc), sz in grid.clues.items():
        if grid.get(cr, cc) != WHITE:
            return False, f"Clue cell ({cr},{cc}) is not WHITE"
        # BFS flood fill this island
        q = deque([(cr, cc)])
        island_cells = set()
        while q:
            r, c = q.popleft()
            if (r, c) in island_cells:
                continue
            island_cells.add((r, c))
            for nr, nc in grid.neighbors(r, c):
                if grid.get(nr, nc) == WHITE and (nr, nc) not in island_cells:
                    q.append((nr, nc))
        # Island must be exactly sz cells
        if len(island_cells) != sz:
            return False, f"Island at ({cr},{cc}) has {len(island_cells)} cells, expected {sz}"
        # Must not overlap another clue's island (they'd merge)
        for cell in island_cells:
            if cell in visited_white:
                return False, f"Islands are connected (merged at {cell})"
        visited_white |= island_cells

    # 3. All WHITE cells belong to some island
    for r in range(rows):
        for c in range(cols):
            if grid.get(r, c) == WHITE and (r, c) not in visited_white:
                return False, f"WHITE cell ({r},{c}) not part of any clue island"

    # 4. No 2×2 block of BLACK
    for r in range(rows - 1):
        for c in range(cols - 1):
            if all(grid.get(r + dr, c + dc) == BLACK
                   for dr in (0, 1) for dc in (0, 1)):
                return False, f"2×2 BLACK block at ({r},{c})"

    # 5. BLACK cells form a single connected component
    black_cells = [(r, c) for r in range(rows) for c in range(cols)
                   if grid.get(r, c) == BLACK]
    if not black_cells:
        return False, "No BLACK cells"
    visited_black: set[tuple[int, int]] = set()
    q = deque([black_cells[0]])
    while q:
        r, c = q.popleft()
        if (r, c) in visited_black:
            continue
        visited_black.add((r, c))
        for nr, nc in grid.neighbors(r, c):
            if grid.get(nr, nc) == BLACK and (nr, nc) not in visited_black:
                q.append((nr, nc))
    if len(visited_black) != len(black_cells):
        return False, "BLACK (water) cells are not all connected"

    return True, "Valid solution"
