/** DOM helpers — status, info, timer, modals. */

export function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

export function setTimer(t) {
  document.getElementById("timer").textContent = t;
}

export function setInfo(st) {
  if (!st) return;
  const total = Object.values(st.clues).reduce((a, b) => a + b, 0);
  document.getElementById("info").textContent =
    `Puzzle: ${st.rows}\u00d7${st.cols}\n${Object.keys(st.clues).length} islands\n${total} white cells`;
}

export function openPaste() {
  document.getElementById("paste-modal").classList.add("open");
}

export function closePaste() {
  document.getElementById("paste-modal").classList.remove("open");
}
