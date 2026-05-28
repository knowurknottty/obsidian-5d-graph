/**
 * Shared state contract for future D4 (time) and D5 (semantic depth) controls.
 *
 * The first renderer-spine patch keeps fallback rendering behavior unchanged, but
 * this contract gives ForceGraph and every renderer tier one stable place to
 * exchange dimension state as WorkerGL/WebGPU backends come online.
 */
export interface DimensionState {
	// D4 — temporal axis
	enableTimeAxis: boolean;
	timeScrubber: number;
	timeAxisZRange: number;
	timeAxisStrength: number;

	// D5 — semantic depth
	enableDepthAxis: boolean;
	depthAlpha: number;
	depthBeta: number;
	depthGamma: number;
	depthMaxNodeScale: number;
}

export const DEFAULT_DIMENSION_STATE: DimensionState = {
	enableTimeAxis: false,
	timeScrubber: 1.0,
	timeAxisZRange: 400,
	timeAxisStrength: 0.05,
	enableDepthAxis: false,
	depthAlpha: 0.4,
	depthBeta: 0.4,
	depthGamma: 0.2,
	depthMaxNodeScale: 3.0,
};
