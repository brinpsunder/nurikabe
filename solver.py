"""Nurikabe solver: constraint propagation + backtracking."""

from __future__ import annotations
import time
from collections import deque
from puzzle import Grid, Island, UNKNOWN, BLACK, WHITE


class Solver:
    def __init__(self, grid: Grid):
        self.grid     = grid
        self._timeout = 30.0
        self._start   = 0.0
        self._step_cb = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def solve(self, step_callback=None, timeout: float = 30.0) -> tuple[bool, float]:
        self._timeout = timeout
        self._start   = time.time()
        self._step_cb = step_callback

        self._init_island_cells()
        ok      = self._backtrack()
        elapsed = time.time() - self._start
        return ok, elapsed

    def hint(self) -> tuple[tuple[int, int], int, str] | None:
        """Return (cell, value, explanation) for the next deducible move."""
        snapshot = self.grid.copy()
        for rule_fn, rule_name in [
            (self._rule_completion,       "Island complete — neighbors must be water"),
            (self._rule_isolation,        "Cell unreachable by any island — must be water"),
            (self._rule_no_2x2,           "Prevents 2×2 water block"),
            (self._rule_forced_expansion, "Island must expand to reach target size"),
        ]:
            self._init_island_cells()
            before = bytearray(self.grid.cells)
            rule_fn()
            for idx in range(len(before)):
                if before[idx] != self.grid.cells[idx]:
                    r, c = divmod(idx, self.grid.cols)
                    val = self.grid.get(r, c)
                    self.grid.restore(snapshot)
                    self._init_island_cells()
                    return (r, c), val, rule_name
            self.grid.restore(snapshot)
            self._init_island_cells()
        return None

    # ------------------------------------------------------------------
    # Island sync
    # ------------------------------------------------------------------

    def _init_island_cells(self) -> None:
        for isl in self.grid.islands:
            isl.cells = set()
        for idx in range(self.grid.rows * self.grid.cols):
            iid = self.grid.island_id[idx]
            if iid >= 0:
                r, c = divmod(idx, self.grid.cols)
                self.grid.islands[iid].cells.add((r, c))

    # ------------------------------------------------------------------
    # Backtracking
    # ------------------------------------------------------------------

    def _backtrack(self) -> bool:
        if time.time() - self._start > self._timeout:
            return False

        self._propagate()
        if self._contradiction():
            return False
        if self.grid.is_complete():
            return True

        cell = self._select_cell()
        if cell is None:
            return self.grid.is_complete()

        r, c    = cell
        snapshot = self.grid.copy()

        # Which island(s) directly border this cell?
        adj: set[int] = set()
        for nr, nc in self.grid.neighbors(r, c):
            iid = self.grid.get_island_id(nr, nc)
            if iid >= 0:
                adj.add(iid)

        # Build (value, island_id) candidate list
        candidates: list[tuple[int, int]] = []
        if len(adj) == 1:
            iid = next(iter(adj))
            isl = self.grid.islands[iid]
            if len(isl.cells) < isl.size:
                candidates.append((WHITE, iid))  # adjacent to exactly one island → prefer WHITE
        candidates.append((BLACK, -1))
        # If we didn't add WHITE first but there's one adjacent island, also try WHITE last
        if candidates[0][0] != WHITE and len(adj) == 1:
            iid = next(iter(adj))
            isl = self.grid.islands[iid]
            if len(isl.cells) < isl.size:
                candidates.append((WHITE, iid))

        for value, iid in candidates:
            self._do_assign(r, c, value, iid)
            if self._backtrack():
                return True
            self.grid.restore(snapshot)
            self._init_island_cells()

        return False

    def _select_cell(self) -> tuple[int, int] | None:
        """
        MRV with adjacency preference:
        1. Force-black unreachable cells (count=0).
        2. Among remaining UNKNOWN cells, prefer cells adjacent to an island
           (we can try WHITE for those), breaking ties by fewest reachable islands.
        3. Fall back to non-adjacent cells (BLACK-only candidates).
        """
        reachability = self._compute_reachability()

        forced: list[tuple[int, int]] = []
        adj_best:     tuple[int, int, int] | None = None   # (count, r, c)
        non_adj_best: tuple[int, int, int] | None = None

        for r in range(self.grid.rows):
            for c in range(self.grid.cols):
                if self.grid.get(r, c) != UNKNOWN:
                    continue
                count = len(reachability.get((r, c), []))
                if count == 0:
                    forced.append((r, c))
                    continue
                # Is any *non-full* island adjacent?
                has_adj = any(
                    (iid := self.grid.get_island_id(nr, nc)) >= 0
                    and len(self.grid.islands[iid].cells) < self.grid.islands[iid].size
                    for nr, nc in self.grid.neighbors(r, c)
                )
                if has_adj:
                    if adj_best is None or count < adj_best[0]:
                        adj_best = (count, r, c)
                else:
                    if non_adj_best is None or count < non_adj_best[0]:
                        non_adj_best = (count, r, c)

        for (r, c) in forced:
            self._do_assign(r, c, BLACK, -1)

        if adj_best is not None:
            return (adj_best[1], adj_best[2])
        if non_adj_best is not None:
            return (non_adj_best[1], non_adj_best[2])
        return None

    def _do_assign(self, r: int, c: int, value: int, iid: int) -> None:
        self.grid.set(r, c, value)
        if value == BLACK:
            self.grid.set_island_id(r, c, -1)
        elif value == WHITE and iid >= 0:
            self.grid.set_island_id(r, c, iid)
            self.grid.islands[iid].cells.add((r, c))
        if self._step_cb:
            self._step_cb(self.grid.copy(), "Backtrack guess")

    # ------------------------------------------------------------------
    # Propagation (fixed-point loop)
    # ------------------------------------------------------------------

    def _propagate(self) -> bool:
        changed_total = False
        for _ in range(300):
            changed  = self._rule_completion()
            changed |= self._rule_isolation()
            changed |= self._rule_no_2x2()
            changed |= self._rule_forced_expansion()
            if changed:
                changed_total = True
            else:
                break
        return changed_total

    def _mark_black(self, r: int, c: int, rule: str) -> bool:
        if self.grid.get(r, c) == UNKNOWN:
            self.grid.set(r, c, BLACK)
            self.grid.set_island_id(r, c, -1)
            if self._step_cb:
                self._step_cb(self.grid.copy(), rule)
            return True
        return False

    def _mark_white(self, r: int, c: int, iid: int, rule: str) -> bool:
        if self.grid.get(r, c) == UNKNOWN:
            self.grid.set(r, c, WHITE)
            self.grid.set_island_id(r, c, iid)
            self.grid.islands[iid].cells.add((r, c))
            if self._step_cb:
                self._step_cb(self.grid.copy(), rule)
            return True
        return False

    # ------------------------------------------------------------------
    # Propagation rules
    # ------------------------------------------------------------------

    def _rule_completion(self) -> bool:
        """Full island → mark all unknown neighbors BLACK."""
        changed = False
        for isl in self.grid.islands:
            if len(isl.cells) == isl.size:
                for (r, c) in list(isl.cells):
                    for nr, nc in self.grid.neighbors(r, c):
                        changed |= self._mark_black(nr, nc, "Completion: island full")
        return changed

    def _rule_isolation(self) -> bool:
        """UNKNOWN cell unreachable by any island → BLACK."""
        changed = False
        reach = self._compute_reachability()
        for r in range(self.grid.rows):
            for c in range(self.grid.cols):
                if self.grid.get(r, c) == UNKNOWN and not reach.get((r, c)):
                    changed |= self._mark_black(r, c, "Isolation: unreachable")
        return changed

    def _rule_no_2x2(self) -> bool:
        """3 cells in a 2×2 block are BLACK → 4th must be WHITE (if adjacent to island)."""
        changed = False
        for r in range(self.grid.rows - 1):
            for c in range(self.grid.cols - 1):
                corners  = [(r, c), (r, c+1), (r+1, c), (r+1, c+1)]
                blacks   = sum(1 for rc in corners if self.grid.get(*rc) == BLACK)
                unknowns = [rc for rc in corners if self.grid.get(*rc) == UNKNOWN]
                if blacks == 3 and len(unknowns) == 1:
                    nr, nc  = unknowns[0]
                    adj_iid = None
                    for xr, xc in self.grid.neighbors(nr, nc):
                        iid = self.grid.get_island_id(xr, xc)
                        if iid >= 0 and len(self.grid.islands[iid].cells) < self.grid.islands[iid].size:
                            adj_iid = iid
                            break
                    if adj_iid is not None:
                        changed |= self._mark_white(nr, nc, adj_iid, "No-2×2 rule")
        return changed

    def _rule_forced_expansion(self) -> bool:
        """
        Island can only reach exactly N UNKNOWN cells (BFS, dist ≤ remaining) and
        needs N more → all reachable cells must be WHITE.
        """
        changed = False
        for isl in self.grid.islands:
            remaining = isl.size - len(isl.cells)
            if remaining <= 0:
                continue
            visited: set[tuple[int, int]] = set(isl.cells)
            q: deque[tuple[tuple[int, int], int]] = deque()
            for (r, c) in isl.cells:
                for nr, nc in self.grid.neighbors(r, c):
                    if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                        q.append(((nr, nc), 1))
                        visited.add((nr, nc))
            reachable: list[tuple[int, int]] = []
            while q:
                (r, c), dist = q.popleft()
                if dist > remaining:
                    continue
                reachable.append((r, c))
                for nr, nc in self.grid.neighbors(r, c):
                    if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                        visited.add((nr, nc))
                        q.append(((nr, nc), dist + 1))
            if len(reachable) == remaining:
                for (r, c) in reachable:
                    changed |= self._mark_white(r, c, isl.id, "Forced expansion")
        return changed

    # ------------------------------------------------------------------
    # Contradiction detection
    # ------------------------------------------------------------------

    def _contradiction(self) -> bool:
        rows, cols = self.grid.rows, self.grid.cols

        for isl in self.grid.islands:
            remaining = isl.size - len(isl.cells)
            if remaining < 0:
                return True
            if remaining > 0 and self._island_reachable_count(isl) < remaining:
                return True

        # 2×2 BLACK block
        for r in range(rows - 1):
            for c in range(cols - 1):
                if all(self.grid.get(r + dr, c + dc) == BLACK
                       for dr in (0, 1) for dc in (0, 1)):
                    return True

        # Clue cell is BLACK
        for (r, c) in self.grid.clues:
            if self.grid.get(r, c) == BLACK:
                return True

        # Two different islands touching
        for r in range(rows):
            for c in range(cols):
                if self.grid.get(r, c) != WHITE:
                    continue
                iid1 = self.grid.get_island_id(r, c)
                if iid1 < 0:
                    continue
                for nr, nc in self.grid.neighbors(r, c):
                    if self.grid.get(nr, nc) == WHITE:
                        iid2 = self.grid.get_island_id(nr, nc)
                        if iid2 >= 0 and iid1 != iid2:
                            return True

        return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _compute_reachability(self) -> dict[tuple[int, int], list[int]]:
        """For each UNKNOWN cell: list of island ids that can reach it within remaining steps."""
        result: dict[tuple[int, int], list[int]] = {}
        for isl in self.grid.islands:
            remaining = isl.size - len(isl.cells)
            if remaining <= 0:
                continue
            visited: set[tuple[int, int]] = set(isl.cells)
            q: deque[tuple[tuple[int, int], int]] = deque()
            for (r, c) in isl.cells:
                for nr, nc in self.grid.neighbors(r, c):
                    if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                        q.append(((nr, nc), 1))
                        visited.add((nr, nc))
            while q:
                (r, c), dist = q.popleft()
                if dist > remaining:
                    continue
                result.setdefault((r, c), []).append(isl.id)
                for nr, nc in self.grid.neighbors(r, c):
                    if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                        visited.add((nr, nc))
                        q.append(((nr, nc), dist + 1))
        return result

    def _island_reachable_count(self, isl: Island) -> int:
        remaining = isl.size - len(isl.cells)
        if remaining <= 0:
            return 0
        visited: set[tuple[int, int]] = set(isl.cells)
        q: deque[tuple[tuple[int, int], int]] = deque()
        for (r, c) in isl.cells:
            for nr, nc in self.grid.neighbors(r, c):
                if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                    q.append(((nr, nc), 1))
                    visited.add((nr, nc))
        count = 0
        while q:
            (r, c), dist = q.popleft()
            if dist > remaining:
                continue
            count += 1
            for nr, nc in self.grid.neighbors(r, c):
                if self.grid.get(nr, nc) == UNKNOWN and (nr, nc) not in visited:
                    visited.add((nr, nc))
                    q.append(((nr, nc), dist + 1))
        return count
