/** Entry point — wires all modules together. */

import state from "./state.js";
import * as api from "./api.js";
import { draw, flashComplete, canvas, CELL_HINT } from "./grid.js";
import { setStatus, setTimer, setInfo, openPaste, closePaste } from "./ui.js";
import * as stepper from "./stepper.js";
import { selectTool, initToolButtons, initCanvasClick, checkSolution } from "./manual.js";

// ---------------------------------------------------------------------------
// Load / Paste
// ---------------------------------------------------------------------------

function openFile() {
  document.getElementById("file-input").click();
}

function loadFile(evt) {
  const f = evt.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = e => loadText(e.target.result);
  reader.readAsText(f);
  evt.target.value = "";
}

async function loadText(text) {
  const data = await api.loadPuzzle(text);
  if (data.error) { setStatus("Error: " + data.error); return; }
  state.grid = data.state;
  draw(state.grid); setInfo(state.grid);
  setTimer("Timer: \u2014"); setStatus("Puzzle loaded");
  stepper.reset();
}

function submitPaste() {
  const txt = document.getElementById("paste-text").value;
  closePaste();
  loadText(txt);
}

// ---------------------------------------------------------------------------
// Auto-solve
// ---------------------------------------------------------------------------

async function autoSolve() {
  if (!state.grid) { setStatus("No puzzle loaded"); return; }
  stepper.reset();
  setStatus("Solving\u2026");
  const data = await api.solve();
  if (data.error) { setStatus(data.error); return; }
  state.grid = data.state;
  draw(state.grid);
  setTimer(`Timer: ${data.elapsed.toFixed(3)} s`);
  setStatus(data.solved ? `Solved! (${data.elapsed.toFixed(3)}s)` : "No solution found");
  if (data.solved) flashComplete(state.grid);
}

// ---------------------------------------------------------------------------
// Step-by-step
// ---------------------------------------------------------------------------

async function stepSolve() {
  if (!state.grid) { setStatus("No puzzle loaded"); return; }
  if (stepper.isActive()) { stepper.playPause(); return; }

  setStatus("Building steps\u2026");
  const data = await api.solveSteps();
  if (data.error) { setStatus(data.error); return; }
  if (data.final_state) state.grid = data.final_state;
  setStatus(`${data.steps.length} steps captured`);
  stepper.loadSteps(data.steps);
}

// ---------------------------------------------------------------------------
// Hint
// ---------------------------------------------------------------------------

async function doHint() {
  if (!state.grid) { setStatus("No puzzle loaded"); return; }
  const data = await api.getHint();
  if (data.r === undefined) { setStatus("No hint available"); return; }
  const hl = { [`${data.r},${data.c}`]: CELL_HINT };
  draw(state.grid, hl);
  setStatus(`Hint (${data.r},${data.c}): ${data.value_str} \u2014 ${data.explanation}`);
  setTimeout(() => draw(state.grid), 2000);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function doReset() {
  const data = await api.resetPuzzle();
  if (!data.state) return;
  state.grid = data.state;
  draw(state.grid); setStatus("Reset");
  stepper.reset();
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  switch (e.key) {
    case " ":         e.preventDefault(); autoSolve(); break;
    case "s": case "S": stepSolve(); break;
    case "h": case "H": doHint(); break;
    case "r": case "R": doReset(); break;
    case "1":         selectTool("black"); break;
    case "2":         selectTool("white"); break;
    case "3":         selectTool("unknown"); break;
    case "ArrowLeft":  if (stepper.isActive()) { e.preventDefault(); stepper.prevStep(); } break;
    case "ArrowRight": if (stepper.isActive()) { e.preventDefault(); stepper.nextStep(); } break;
  }
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

window.addEventListener("resize", () => { if (state.grid) draw(state.grid); });

// ---------------------------------------------------------------------------
// Wire up DOM events
// ---------------------------------------------------------------------------

// Toolbar buttons
document.getElementById("btn-load").addEventListener("click", openFile);
document.getElementById("btn-paste").addEventListener("click", openPaste);
document.getElementById("file-input").addEventListener("change", loadFile);

// Sidebar action buttons
document.getElementById("btn-solve").addEventListener("click", autoSolve);
document.getElementById("btn-step").addEventListener("click", stepSolve);
document.getElementById("btn-hint").addEventListener("click", doHint);
document.getElementById("btn-reset").addEventListener("click", doReset);
document.getElementById("btn-check").addEventListener("click", checkSolution);

// Paste modal
document.getElementById("btn-paste-cancel").addEventListener("click", closePaste);
document.getElementById("btn-paste-ok").addEventListener("click", submitPaste);

// VCR controls
document.getElementById("btn-to-start").addEventListener("click", stepper.toStart);
document.getElementById("btn-prev").addEventListener("click", stepper.prevStep);
document.getElementById("btn-play").addEventListener("click", stepper.playPause);
document.getElementById("btn-next").addEventListener("click", stepper.nextStep);
document.getElementById("btn-to-end").addEventListener("click", stepper.toEnd);

// Manual tool buttons + canvas click
initToolButtons();
initCanvasClick();

// ---------------------------------------------------------------------------
// Init — load existing state if server already has a puzzle
// ---------------------------------------------------------------------------

(async () => {
  const data = await api.fetchState();
  if (data.state) { state.grid = data.state; draw(state.grid); setInfo(state.grid); }
})();
