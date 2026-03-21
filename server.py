"""Nurikabe — HTTP server backend. Frontend lives in static/."""

from __future__ import annotations
import http.server
import json
import mimetypes
import os
import threading
import time
import webbrowser
from puzzle import Grid, parse_puzzle, validate_solution, UNKNOWN, BLACK, WHITE
from solver import Solver

PORT       = 8765
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


# ---------------------------------------------------------------------------
# App state
# ---------------------------------------------------------------------------

class _State:
    grid:          Grid | None = None
    original_grid: Grid | None = None

S = _State()


def _grid_json(g: Grid, highlights: dict | None = None) -> dict:
    h = highlights or {}
    return {
        "rows":       g.rows,
        "cols":       g.cols,
        "cells":      [g.get(r, c) for r in range(g.rows) for c in range(g.cols)],
        "island_ids": list(g.island_id),
        "clues":      {f"{r},{c}": sz for (r, c), sz in g.clues.items()},
        "highlights": {f"{r},{c}": col for (r, c), col in h.items()},
    }


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

class Handler(http.server.BaseHTTPRequestHandler):

    def log_message(self, *args): pass

    def do_GET(self):
        if self.path == "/":
            self._serve_file("index.html")
        elif self.path.startswith("/static/"):
            self._serve_file(self.path[len("/static/"):])
        elif self.path == "/api/state":
            self._json({"state": _grid_json(S.grid) if S.grid else None})
        else:
            self._send(404, "text/plain", b"Not found")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length).decode("utf-8") if length else ""

        if self.path == "/api/load":
            try:
                S.grid = parse_puzzle(body)
                S.original_grid = S.grid.copy()
                self._json({"state": _grid_json(S.grid)})
            except Exception as e:
                self._json({"error": str(e)}, 400)

        elif self.path == "/api/solve":
            if not S.grid:
                self._json({"error": "no puzzle loaded"}, 400); return
            gc = S.grid.copy()
            solved, elapsed = Solver(gc).solve(timeout=30.0)
            if solved:
                S.grid = gc
            self._json({"solved": solved, "elapsed": elapsed,
                        "state": _grid_json(S.grid)})

        elif self.path == "/api/solve-steps":
            if not S.original_grid:
                self._json({"error": "no puzzle loaded"}, 400); return
            gc    = S.original_grid.copy()
            steps = []
            solved, elapsed = Solver(gc).solve(
                step_callback=lambda snap, rule: steps.append((snap.copy(), rule)),
                timeout=30.0,
            )
            if solved:
                S.grid = gc
            self._json({
                "solved":      solved,
                "elapsed":     elapsed,
                "final_state": _grid_json(S.grid),
                "steps": [
                    {"cells":      [s.get(r, c) for r in range(s.rows) for c in range(s.cols)],
                     "island_ids": list(s.island_id),
                     "rule":       rule}
                    for s, rule in steps
                ],
            })

        elif self.path == "/api/hint":
            if not S.grid:
                self._json({"error": "no puzzle loaded"}, 400); return
            result = Solver(S.grid).hint()
            if result is None:
                self._json({})
            else:
                (r, c), val, explanation = result
                self._json({"r": r, "c": c,
                            "value_str":   "water" if val == BLACK else "island",
                            "explanation": explanation})

        elif self.path == "/api/click":
            if not S.grid:
                self._json({"error": "no puzzle loaded"}, 400); return
            data = json.loads(body)
            r, c = data["r"], data["c"]
            g    = S.grid

            if not (0 <= r < g.rows and 0 <= c < g.cols):
                self._json({"error": "out of bounds"}, 400); return
            if (r, c) in g.clues:
                self._json({"state": _grid_json(g)}); return

            # Support explicit action field (preferred) or legacy prefer field
            action = data.get("action")
            if action == "black":
                target = BLACK
            elif action == "white":
                target = WHITE
            elif action == "unknown":
                target = UNKNOWN
            else:
                # Legacy: prefer field
                target = BLACK if data.get("prefer", -1) < 0 else WHITE

            cur = g.get(r, c)
            new_v = UNKNOWN if cur == target else target

            if new_v == UNKNOWN:
                g.set(r, c, UNKNOWN); g.set_island_id(r, c, -1)
            elif new_v == BLACK:
                g.set(r, c, BLACK); g.set_island_id(r, c, -1)
            else:
                iid = _nearest_island(g, r, c) or 0
                g.set(r, c, WHITE); g.set_island_id(r, c, iid)

            hl = {k: "#ff6b6b" for k in _find_violations(g)}
            self._json({"state": _grid_json(g, hl)})

        elif self.path == "/api/validate":
            if not S.grid:
                self._json({"error": "no puzzle loaded"}, 400); return
            valid, message = validate_solution(S.grid)
            self._json({"valid": valid, "message": message})

        elif self.path == "/api/reset":
            if S.original_grid:
                S.grid = S.original_grid.copy()
                self._json({"state": _grid_json(S.grid)})
            else:
                self._json({"state": None})

        else:
            self._send(404, "text/plain", b"Not found")

    # ------------------------------------------------------------------
    def _serve_file(self, name: str):
        path = os.path.join(STATIC_DIR, name)
        if not os.path.isfile(path):
            self._send(404, "text/plain", b"Not found"); return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            self._send(200, ctype, f.read())

    def _send(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data: dict, code: int = 200):
        self._send(code, "application/json", json.dumps(data).encode())


# ---------------------------------------------------------------------------
# Grid helpers
# ---------------------------------------------------------------------------

def _nearest_island(g: Grid, r: int, c: int):
    from collections import deque
    visited = {(r, c)}
    q = deque([(r, c)])
    while q:
        cr, cc = q.popleft()
        iid = g.get_island_id(cr, cc)
        if iid >= 0:
            return iid
        for nr, nc in g.neighbors(cr, cc):
            if (nr, nc) not in visited:
                visited.add((nr, nc)); q.append((nr, nc))
    return None


def _find_violations(g: Grid) -> set:
    errors: set = set()
    for r in range(g.rows - 1):
        for c in range(g.cols - 1):
            if all(g.get(r+dr, c+dc) == BLACK for dr in (0,1) for dc in (0,1)):
                errors.update([(r,c),(r,c+1),(r+1,c),(r+1,c+1)])
    for r in range(g.rows):
        for c in range(g.cols):
            if g.get(r, c) != WHITE: continue
            iid1 = g.get_island_id(r, c)
            for nr, nc in g.neighbors(r, c):
                if g.get(nr, nc) == WHITE:
                    iid2 = g.get_island_id(nr, nc)
                    if iid2 >= 0 and iid1 >= 0 and iid1 != iid2:
                        errors.add((r,c)); errors.add((nr,nc))
    return errors


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run():
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{PORT}"
    print(f"Nurikabe Solver → {url}")
    webbrowser.open(url)
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()
