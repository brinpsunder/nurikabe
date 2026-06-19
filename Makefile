# Nurikabe — Svelte + TypeScript
# Requirements: Node.js (https://nodejs.org)

.PHONY: all run build test clean

all: run

run:
	npm install
	npm run dev

build:
	npm install
	npm run build

test:
	npm install
	npm test

clean:
	rm -rf node_modules dist
