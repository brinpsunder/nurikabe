/** Tool selector + click handling for manual solving. */

import state from "./state.js";
import { canvas, draw } from "./grid.js";
import { setStatus } from "./ui.js";
import * as api from "./api.js";

const TOOL_CURSORS = {
  black:   "crosshair",
  white:   "pointer",
  unknown: "default",
};

export function selectTool(tool) {
  state.tool = tool;
  canvas.style.cursor = TOOL_CURSORS[tool] || "crosshair";
  // Update active button styling
  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  });
}

export function initToolButtons() {
  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => selectTool(btn.dataset.tool));
  });
  // Set initial state
  selectTool("black");
}

export function initCanvasClick() {
  canvas.addEventListener("click", async (e) => {
    if (!state.grid) return;
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / state.cellSize);
    const r = Math.floor((e.clientY - rect.top)  / state.cellSize);
    const data = await api.clickCell(r, c, state.tool);
    if (data.state) { state.grid = data.state; draw(state.grid); }
    if (data.error) setStatus(data.error);
  });
}

export async function checkSolution() {
  if (!state.grid) { setStatus("No puzzle loaded"); return; }
  const data = await api.validate();
  if (data.error) { setStatus(data.error); return; }
  if (data.valid) {
    setStatus("Valid solution!");
  } else {
    setStatus("Not valid: " + data.message);
  }
}
