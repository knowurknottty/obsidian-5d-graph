/**
 * Runtime capability probe for selecting the best available graph renderer.
 *
 * Only the fallback renderer is wired in this patch. The extra capability data is
 * logged now and becomes actionable when WorkerGL/WebGPU tiers are added.
 */
export type RendererTier = "webgpu" | "worker-gl" | "fallback";

export interface RendererCapabilities {
	tier: RendererTier;
	webgpu: boolean;
	sharedArrayBuffer: boolean;
	workerAvailable: boolean;
	maxNodes: number;
}

export async function detectCapabilities(): Promise<RendererCapabilities> {
	let webgpu = false;

	try {
		const gpu = (navigator as Navigator & { gpu?: any }).gpu;
		if (gpu?.requestAdapter) {
			const adapter = await gpu.requestAdapter({
				powerPreference: "high-performance",
			});
			webgpu = adapter !== null;
		}
	} catch {
		webgpu = false;
	}

	const sharedArrayBuffer =
		typeof SharedArrayBuffer !== "undefined" &&
		(typeof crossOriginIsolated === "undefined" || crossOriginIsolated);
	const workerAvailable = typeof Worker !== "undefined";

	if (webgpu) {
		return {
			tier: "webgpu",
			webgpu: true,
			sharedArrayBuffer,
			workerAvailable,
			maxNodes: 500_000,
		};
	}

	if (workerAvailable) {
		return {
			tier: "worker-gl",
			webgpu: false,
			sharedArrayBuffer,
			workerAvailable: true,
			maxNodes: sharedArrayBuffer ? 25_000 : 10_000,
		};
	}

	return {
		tier: "fallback",
		webgpu: false,
		sharedArrayBuffer: false,
		workerAvailable: false,
		maxNodes: 2_000,
	};
}
