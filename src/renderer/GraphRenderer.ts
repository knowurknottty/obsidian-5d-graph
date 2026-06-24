import Graph from "../graph/Graph";
import { DimensionState } from "../dimensions/DimensionState";
import { RendererTier } from "./RendererCapabilities";

export type NodeClickHandler = (nodeId: string) => void;

/**
 * Common contract for all graph renderer backends.
 *
 * ForceGraph owns orchestration. Renderers own DOM/GPU/library integration.
 */
export interface GraphRenderer {
	readonly tier: RendererTier;

	mount(el: HTMLElement): Promise<void> | void;
	setGraph(graph: Graph): void;
	setDimensions(state: DimensionState): void;
	resize(width: number, height: number): void;
	setHovered(nodeId: string | null): void;
	setNodeClickHandler(handler: NodeClickHandler | null): void;
	dispose(): void;
}
