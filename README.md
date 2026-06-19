# Nurikabe Solver

A fast solver for the **Nurikabe** logic puzzle, with an interactive web UI. It solves arbitrary puzzles (tested up to 24×14) by combining human-style logical deduction with backtracking search.

**▶ Live demo: https://brinpsunder.github.io/nurikabe/**

![Solving a 24×14 puzzle step by step](assets/solving_primer_3.gif)

## Features

- **Automatic solving** — solves puzzles up to 24×14 in seconds; runs in a Web Worker so the UI never freezes.
- **Step-by-step playback** — watch the solution build move by move, with each step labelled by the rule applied.
- **Hints** — reveal a single logical move together with the rule that justifies it.
- **Manual solving** — click (or tap) to cycle a cell through unknown → water → island, with live highlighting of rule violations.
- Load built-in samples, a `.txt` file, or pasted text. Works on desktop and mobile.

![Step-by-step solving with the rule shown for each move](assets/solving_primer_2.gif)

## How it works

Two layers:

1. **Logical deduction** — nine human-style rules (complete-island enclosure, island separation, reachability, no 2×2 water pool, …) applied repeatedly to a fixpoint.
2. **Backtracking search** — when deduction stalls, depth-first search branches on the most-constrained island (MRV heuristic), with probing and contradiction detection to prune dead branches early.

Most puzzles are solved almost entirely by deduction; search only engages on the hardest ones. (Nurikabe is NP-complete, so no finite rule set alone can solve every puzzle.)

## Tech

Svelte 5 · TypeScript · Vite · Web Worker · Vitest (49 tests, written test-first)

## Run locally

Requires Node.js.

```sh
make run     # dev server (npm install + npm run dev)
make build   # production build → dist/
make test    # run the test suite
```

## Tests

49 tests covering each deduction rule (positive and negative cases), an integration suite that solves every bundled puzzle within a time budget, and edge cases (unsolvable input, timeout):

```sh
make test
```
