## Nurikabe Solver — Svelte + TypeScript
## Requirements: Node.js (https://nodejs.org)

.PHONY: all run build test clean

all: run

## Install deps (once) and start dev server with hotspot access
run:
	npm install
	npm run dev

## Build static dist/ for distribution (no server needed)
build:
	npm install
	npm run build

## Python solver tests (unchanged)
test:
	@echo "=== Solver tests ==="
	@python3 test_solver.py

## Clean build artifacts
clean:
	rm -rf node_modules dist
