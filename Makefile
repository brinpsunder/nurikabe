PYTHON := python3

.PHONY: all run test clean

all: run

## Run the web app (starts server, opens browser)
run:
	$(PYTHON) main.py

## Quick solver test on all sample puzzles
test:
	@echo "=== Solver tests ==="
	@$(PYTHON) test_solver.py

## Clean up
clean:
	rm -rf __pycache__ *.pyc
