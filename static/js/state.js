/** Single app state object. */

const appState = {
  grid: null,       // current grid data from server
  cellSize: 40,     // computed cell pixel size
  steps: [],        // solve steps array
  stepIndex: 0,     // current step position
  tool: "black",    // manual tool: "black" | "white" | "unknown"
};

export default appState;
