/** All fetch() calls to the backend. */

export async function fetchState() {
  const res = await fetch("/api/state");
  return res.json();
}

export async function loadPuzzle(text) {
  const res = await fetch("/api/load", { method: "POST", body: text });
  return res.json();
}

export async function solve() {
  const res = await fetch("/api/solve", { method: "POST" });
  return res.json();
}

export async function solveSteps() {
  const res = await fetch("/api/solve-steps", { method: "POST" });
  return res.json();
}

export async function getHint() {
  const res = await fetch("/api/hint", { method: "POST" });
  return res.json();
}

export async function clickCell(r, c, action) {
  const res = await fetch("/api/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ r, c, action }),
  });
  return res.json();
}

export async function validate() {
  const res = await fetch("/api/validate", { method: "POST" });
  return res.json();
}

export async function resetPuzzle() {
  const res = await fetch("/api/reset", { method: "POST" });
  return res.json();
}
