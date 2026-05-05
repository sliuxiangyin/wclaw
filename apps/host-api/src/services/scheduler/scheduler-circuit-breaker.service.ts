type CircuitState = "closed" | "open" | "half-open";

type CircuitInfo = {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
};

const FAILURE_THRESHOLD = 5;
const HALF_OPEN_AFTER_MS = 30_000;
const byPlugin = new Map<string, CircuitInfo>();

function getOrInit(pluginId: string): CircuitInfo {
  const hit = byPlugin.get(pluginId);
  if (hit) return hit;
  const init: CircuitInfo = {
    state: "closed",
    consecutiveFailures: 0,
    openedAt: null
  };
  byPlugin.set(pluginId, init);
  return init;
}

export function canRun(pluginId: string, now = Date.now()) {
  const state = getOrInit(pluginId);
  if (state.state === "open") {
    if (!state.openedAt || now - state.openedAt >= HALF_OPEN_AFTER_MS) {
      state.state = "half-open";
      return true;
    }
    return false;
  }
  return true;
}

export function onTaskSuccess(pluginId: string) {
  const state = getOrInit(pluginId);
  state.state = "closed";
  state.consecutiveFailures = 0;
  state.openedAt = null;
}

export function onTaskFailure(pluginId: string) {
  const state = getOrInit(pluginId);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.state = "open";
    state.openedAt = Date.now();
  }
}

export function getCircuitState(pluginId: string): CircuitState {
  return getOrInit(pluginId).state;
}

