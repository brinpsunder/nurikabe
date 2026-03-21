/** Canvas drawing — tile-style renderer. */

import state from "./state.js";

// Color palette (matches CSS vars)
const COLOR = {
  bg:      "#0a0e1a",
  water:   "#0f2744",
  waterFg: "#2563a0",
  island:  "#fef9f0",
  islandFg:"#5a3e1b",
  unknown: "#1c2535",
  hint:    "#fbbf24",
  error:   "#f87171",
  clueRing:"#4f8ef7",
  grid:    "#0d1a2e",
};

export const CELL_HINT = COLOR.hint;

const GAP  = 2;   // gap between tiles in px
const RADI = 3;   // tile corner radius

const canvas = document.getElementById("grid");
const ctx    = canvas.getContext("2d");

export { canvas };

// -- helpers -----------------------------------------------------------------

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// -- main draw ---------------------------------------------------------------

export function draw(st, extraHighlights) {
  if (!st) return;
  const { rows, cols, cells, clues, highlights } = st;
  const hl = extraHighlights || highlights || {};

  // Compute cell size
  const wrap = document.getElementById("canvas-wrap");
  const maxW = wrap.clientWidth  - 28;
  const maxH = wrap.clientHeight - 28;
  state.cellSize = Math.max(20, Math.min(72, Math.floor(Math.min(maxW / cols, maxH / rows))));
  const cs = state.cellSize;
  const W = cols * cs, H = rows * cs;
  canvas.width = W; canvas.height = H;

  // Background fill (gap color)
  ctx.fillStyle = COLOR.grid;
  ctx.fillRect(0, 0, W, H);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const val = cells[idx];
      const key = r + "," + c;
      const isClue = !!clues[key];

      // Tile bounds
      const x = c * cs + GAP;
      const y = r * cs + GAP;
      const tw = cs - GAP * 2;
      const th = cs - GAP * 2;

      // Fill color
      let fill;
      if      (hl[key])    fill = hl[key];
      else if (val === 0)  fill = COLOR.water;
      else if (val === 1)  fill = COLOR.island;
      else                 fill = COLOR.unknown;

      // Draw tile
      ctx.fillStyle = fill;
      roundRect(x, y, tw, th, RADI);
      ctx.fill();

      // Clue ring
      if (isClue) {
        ctx.strokeStyle = COLOR.clueRing;
        ctx.lineWidth = 1.5;
        roundRect(x + 1, y + 1, tw - 2, th - 2, RADI);
        ctx.stroke();
      }

      // Water tilde
      if (val === 0 && !isClue && cs >= 26) {
        ctx.fillStyle = COLOR.waterFg;
        ctx.font = `${Math.max(8, Math.floor(cs * 0.28))}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("~", c * cs + cs / 2, r * cs + cs / 2);
      }

      // Number label (clue or debug)
      if (isClue) {
        const fs = Math.max(9, Math.floor(cs * 0.38));
        ctx.fillStyle = val === 0 ? "#6b9fd4" : COLOR.islandFg;
        ctx.font = `bold ${fs}px -apple-system, Helvetica, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(clues[key], c * cs + cs / 2, r * cs + cs / 2);
      }
    }
  }
}

/** Green sweep animation on solve. */
export function flashComplete(st) {
  const { rows, cols } = st;
  const cs = state.cellSize;
  let col = 0;
  function sweep() {
    if (col >= cols) { setTimeout(() => draw(st), 500); return; }
    for (let r = 0; r < rows; r++) {
      if (st.cells[r * cols + col] === 1) {
        const x = col * cs + GAP, y = r * cs + GAP;
        const tw = cs - GAP * 2, th = cs - GAP * 2;
        ctx.fillStyle = "#34d399";
        roundRect(x, y, tw, th, RADI);
        ctx.fill();
      }
    }
    col++;
    setTimeout(sweep, 28);
  }
  sweep();
}
