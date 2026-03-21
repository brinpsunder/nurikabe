/** Step-by-step VCR controller. */

import state from "./state.js";
import { draw } from "./grid.js";
import { setStatus } from "./ui.js";

let playing  = false;
let playTimer = null;

export function isActive() { return state.steps.length > 0; }
export function isPlaying() { return playing; }

function stepDelay() {
  const v = parseInt(document.getElementById("speed").value);
  return Math.round(400 - (v - 1) * (380 / 9));
}

function showStep() {
  const s = state.steps[state.stepIndex];
  draw({ ...state.grid, cells: s.cells, island_ids: s.island_ids, highlights: {} });
  updateCounter();
  setStatus(`Step ${state.stepIndex + 1}/${state.steps.length}: ${s.rule}`);
}

function updateCounter() {
  const el = document.getElementById("step-counter");
  if (el) el.textContent = `Step ${state.stepIndex + 1} / ${state.steps.length}`;
  const rule = document.getElementById("step-rule");
  if (rule && state.steps[state.stepIndex]) {
    rule.textContent = state.steps[state.stepIndex].rule;
  }
}

export function nextStep() {
  if (!isActive()) return;
  if (state.stepIndex < state.steps.length - 1) {
    state.stepIndex++;
    showStep();
  }
}

export function prevStep() {
  if (!isActive()) return;
  if (state.stepIndex > 0) {
    state.stepIndex--;
    showStep();
  }
}

export function toStart() {
  if (!isActive()) return;
  stopPlay();
  state.stepIndex = 0;
  showStep();
}

export function toEnd() {
  if (!isActive()) return;
  stopPlay();
  state.stepIndex = state.steps.length - 1;
  showStep();
}

function stopPlay() {
  playing = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  const btn = document.getElementById("btn-play");
  if (btn) btn.textContent = "\u25b6";
}

function autoPlay() {
  if (!playing) return;
  if (state.stepIndex >= state.steps.length - 1) {
    stopPlay();
    setStatus("Step-by-step complete");
    return;
  }
  state.stepIndex++;
  showStep();
  playTimer = setTimeout(autoPlay, stepDelay());
}

export function playPause() {
  if (!isActive()) return;
  if (playing) {
    stopPlay();
  } else {
    playing = true;
    const btn = document.getElementById("btn-play");
    if (btn) btn.textContent = "\u23f8";
    autoPlay();
  }
}

export function reset() {
  stopPlay();
  state.steps = [];
  state.stepIndex = 0;
  // Hide VCR controls
  const vcr = document.getElementById("vcr-controls");
  if (vcr) vcr.style.display = "none";
}

/** Initialize steps, show VCR controls, and start playing. */
export function loadSteps(steps) {
  state.steps = steps;
  state.stepIndex = 0;
  // Show VCR controls
  const vcr = document.getElementById("vcr-controls");
  if (vcr) vcr.style.display = "";
  showStep();
  // Auto-start playing
  playing = true;
  const btn = document.getElementById("btn-play");
  if (btn) btn.textContent = "\u23f8";
  playTimer = setTimeout(autoPlay, stepDelay());
}
