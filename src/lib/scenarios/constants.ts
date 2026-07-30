/** Plugin id for simulated scenario entities on the globe. */
export const SIM_SCENARIOS_PLUGIN_ID = "sim-scenarios";

/** Default tick interval for the scenario runner (ms). */
export const DEFAULT_SCENARIO_TICK_MS = 2000;

/**
 * How long a run may go without a client polling `/api/ops/scenarios/state`
 * before the runner stops it (ms). A closed tab never sends Stop, so this is
 * the termination path for an abandoned run.
 */
export const SCENARIO_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
