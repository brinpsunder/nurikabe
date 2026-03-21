# Nurikabe — Svelte + TypeScript
# Requirements: Node.js (https://nodejs.org)

.PHONY: all run build clean

all: run

run:
	npm install
	npm run dev

build:
	npm install
	npm run build

clean:
	rm -rf node_modules dist
