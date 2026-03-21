"""Quick solver correctness test for all sample puzzles."""
import os
from puzzle import parse_puzzle, validate_solution
from solver import Solver

puzzle_dir = os.path.join(os.path.dirname(__file__), "puzzles")
for fname in sorted(os.listdir(puzzle_dir)):
    if not fname.endswith(".txt"):
        continue
    path = os.path.join(puzzle_dir, fname)
    grid = parse_puzzle(open(path).read())
    solver = Solver(grid)
    solved, elapsed = solver.solve(timeout=60.0)
    if solved:
        valid, msg = validate_solution(grid)
    else:
        valid, msg = False, "unsolved (timeout or no solution)"
    status = "PASS" if (solved and valid) else "FAIL"
    print(f"[{status}] {fname}: solved={solved}, valid={valid}, time={elapsed:.3f}s — {msg}")
