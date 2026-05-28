import { StateChange } from "../../util/State";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import EventBus from "../../util/EventBus";
import {
	DEFAULT_DIMENSION_STATE,
	DimensionState,
} from "../../dimensions/DimensionState";
import { detectCapabilities } from "../../renderer/RendererCapabilities";
import { GraphRenderer, NodeClickHandler } from "../../renderer/GraphRenderer";
import { FallbackRenderer } from "../../renderer/FallbackRenderer";

/**
 * ForceGraph is now the renderer orchestrator.
 *
 * It owns graph selection, lifecycle, settings forwarding, and D4/D5 state.
 * Concrete renderers own DOM/rendering details.
 */
export class ForceGraph {
	private renderer: GraphRenderer;
	private readonly rootHtmlElement: HTMLElement;
	private readonly isLocalGraph: boolean;
	private graph: Graph;
	private readonly plugin: Graph3dPlugin;
	private readonly unsubscribeHandles: (() => void)[] = [];
	private readonly dimState: DimensionState = { ...DEFAULT_DIMENSION_STATE };
	private nodeClickHandler: NodeClickHandler | null = null;
	private disposed = false;

	constructor(
		plugin: Graph3dPlugin,
		rootHtmlElement: HTMLElement,
		isLocalGraph: boolean
	) {
		this.rootHtmlElement = rootHtmlElement;
		this.isLocalGraph = isLocalGraph;
		this.plugin = plugin;

		this.init();
		this.initListeners();
	}

	private async init(): Promise<void> {
		const capabilities = await detectCapabilities();

		console.info(
			`%c[5DGraph] Runtime capability tier: ${capabilities.tier}`,
			"color: #4f98a3; font-weight: bold",
			`| selected renderer: fallback`,
			`| maxNodes: ${capabilities.maxNodes.toLocaleString()}`,
			`| SAB: ${capabilities.sharedArrayBuffer}`,
			`| WebGPU: ${capabilities.webgpu}`
		);

		// Fallback-only for this patch. WorkerGL/WebGPU slot into this seam next.
		this.renderer = new FallbackRenderer(this.plugin);
		await this.renderer.mount(this.rootHtmlElement);

		if (this.disposed) {
			this.renderer.dispose();
			return;
		}

		this.renderer.setNodeClickHandler(this.nodeClickHandler);
		this.renderer.setGraph(this.getGraphData());
		this.renderer.setDimensions(this.dimState);
	}

	private initListeners(): void {
		this.unsubscribeHandles.push(
			this.plugin.settingsState.onChange(this.onSettingsStateChanged)
		);
		if (this.isLocalGraph) {
			this.unsubscribeHandles.push(
				this.plugin.openFileState.onChange(this.refreshGraphData)
			);
		}
		EventBus.on("graph-changed", this.refreshGraphData);
	}

	private getGraphData = (): Graph => {
		if (this.isLocalGraph && this.plugin.openFileState.value) {
			this.graph = this.plugin.globalGraph
				.clone()
				.getLocalGraph(this.plugin.openFileState.value);
		} else {
			this.graph = this.plugin.globalGraph.clone();
		}

		return this.graph;
	};

	private refreshGraphData = (): void => {
		this.renderer?.setGraph(this.getGraphData());
	};

	private onSettingsStateChanged = (data: StateChange): void => {
		if (this.renderer instanceof FallbackRenderer) {
			this.renderer.applySettingsChange(data.currentPath, data.newValue);
			return;
		}

		this.renderer?.setGraph(this.getGraphData());
	};

	public updateDimensions(): void {
		const [width, height] = [
			this.rootHtmlElement.offsetWidth,
			this.rootHtmlElement.offsetHeight,
		];
		this.setDimensions(width, height);
	}

	public setDimensions(width: number, height: number): void {
		this.renderer?.resize(width, height);
	}

	public setDimensionState(partial: Partial<DimensionState>): void {
		Object.assign(this.dimState, partial);
		this.renderer?.setDimensions(this.dimState);
	}

	public setNodeClickHandler(handler: NodeClickHandler | null): void {
		this.nodeClickHandler = handler;
		this.renderer?.setNodeClickHandler(handler);
	}

	public dispose(): void {
		this.disposed = true;
		this.unsubscribeHandles.forEach((unsubscribe) => unsubscribe());
		this.unsubscribeHandles.splice(0, this.unsubscribeHandles.length);
		EventBus.off("graph-changed", this.refreshGraphData);
		this.renderer?.dispose();
	}
}
