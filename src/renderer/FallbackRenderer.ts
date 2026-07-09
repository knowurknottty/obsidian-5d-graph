import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import { rgba } from "polished";
import Graph from "../graph/Graph";
import Node from "../graph/Node";
import Link from "../graph/Link";
import Graph3dPlugin from "../main";
import { DEFAULT_DIMENSION_STATE, DimensionState } from "../dimensions/DimensionState";
import { GraphRenderer, NodeClickHandler } from "./GraphRenderer";
import { NodeGroup } from "../settings/categories/GroupSettings";

/**
 * Tier: fallback
 *
 * 3d-force-graph backend with full CAPT 5D integration:
 *   D1/D2/D3 — Spatial (force-directed, handled by 3d-force-graph)
 *   D4 — Temporal (z-offset from node age, time scrubber filtering)
 *   D5 — Semantic Depth (node size/scale from knowledge depth, source-based coloring)
 */
export class FallbackRenderer implements GraphRenderer {

	readonly tier = "fallback" as const;

	private instance: ForceGraph3DInstance;
	private graph: Graph;
	private readonly plugin: Graph3dPlugin;
	private readonly highlightedNodes: Set<string> = new Set();
	private readonly highlightedLinks: Set<Link> = new Set();
	private hoveredNode: Node | null = null;
	private nodeClickHandler: NodeClickHandler | null = null;

	// CAPT 5D state
	private dimState: DimensionState = { ...DEFAULT_DIMENSION_STATE };
	private captNodeColorFn: ((node: Node) => string | null) | null = null;
	private captMode: boolean = false;

	constructor(plugin: Graph3dPlugin) {
		this.plugin = plugin;
	}

	async mount(el: HTMLElement): Promise<void> {
		const [width, height] = [el.offsetWidth, el.offsetHeight];
		this.instance = ForceGraph3D()(el)
			.nodeLabel((node: Node) => `<div class="node-label">${node.name}</div>`)
			.nodeRelSize(this.plugin.getSettings().display.nodeSize)
			.backgroundColor(rgba(0, 0, 0, 0.0))
			.width(width)
			.height(height)
			.nodeColor((node: Node) => this.getNodeColor(node))
			.nodeVal((node: Node) => this.getNodeValue(node))
			.nodeVisibility((node: Node) => this.doShowNode(node))
			.onNodeHover((node: Node | null) => this.onNodeHover(node))
			.onNodeClick((node: Node) => this.nodeClickHandler?.(node.id))
			.linkWidth((link: Link) =>
				this.isHighlightedLink(link)
					? this.plugin.getSettings().display.linkThickness * 1.5
					: this.plugin.getSettings().display.linkThickness
			)
			.linkDirectionalParticles((link: Link) =>
				this.isHighlightedLink(link)
					? this.plugin.getSettings().display.particleCount
					: 0
			)
			.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			)
			.linkVisibility((link: Link) => this.doShowLink(link))
			.onLinkHover((link: Link | null) => this.onLinkHover(link))
			.linkColor((link: Link) =>
				this.isHighlightedLink(link)
					? this.plugin.theme.textAccent
					: this.plugin.theme.textMuted
			);
	}

	setGraph(graph: Graph): void {
		this.graph = graph;
		this.instance?.graphData(graph);
	}

	/**
	 * Apply D4/D5 dimension state to the renderer.
	 * Triggers a full re-render of node colors and sizes.
	 */
	setDimensions(state: DimensionState): void {
		this.dimState = state;
		this.captMode = !!(this.captNodeColorFn);

		// Force 3d-force-graph to re-evaluate all node colors and sizes
		if (this.instance) {
			this.instance
				.nodeColor(this.instance.nodeColor())
				.nodeVal(this.instance.nodeVal())
				.nodeRelSize(this.plugin.getSettings().display.nodeSize);

			// D4: Apply time scrubber as a filter (hide nodes outside temporal range)
			if (this.captMode && state.enableTimeAxis) {
				this.instance.nodeVisibility((node: Node) => {
					const base = this.doShowNode(node);
					if (!base) return false;

					// Check temporal filter via __d4_normalized property
					const d4norm = (node as any).__d4_normalized;
					if (d4norm !== undefined) {
						// Time scrubber: show nodes within a window around the scrubber position
						const scrubber = state.timeScrubber;
						const range = 0.3; // ±30% window around scrubber
						const min = Math.max(0, scrubber - range);
						const max = Math.min(1, scrubber + range);
						return d4norm >= min && d4norm <= max;
					}
					return true;
				});
			} else {
				// Reset visibility to default
				this.instance.nodeVisibility((node: Node) => this.doShowNode(node));
			}
		}
	}

	resize(width: number, height: number): void {
		this.instance?.width(width);
		this.instance?.height(height);
	}

	setHovered(nodeId: string | null): void {
		const node = nodeId && this.graph ? this.graph.getNodeById(nodeId) : null;
		this.onNodeHover(node);
	}

	setNodeClickHandler(handler: NodeClickHandler | null): void {
		this.nodeClickHandler = handler;
	}

	/**
	 * Inject the CAPT node color function from ForceGraph.
	 * When set, this overrides default group-based coloring.
	 */
	setCaptNodeColorFn(fn: (node: Node) => string | null): void {
		this.captNodeColorFn = fn;
		this.captMode = true;
	}

	applySettingsChange(path: string, value: unknown): void {
		if (!this.instance) return;

		if (path === "display.nodeSize") {
			this.instance.nodeRelSize(value as number);
		} else if (path === "display.linkWidth") {
			this.instance.linkWidth(value as number);
		} else if (path === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		} else if (path === "display.particleCount") {
			this.instance.linkDirectionalParticles(
				this.plugin.getSettings().display.particleCount
			);
		}

		this.instance.refresh();
	}

	dispose(): void {
		this.nodeClickHandler = null;
		this.captNodeColorFn = null;
		this.instance?._destructor?.();
	}

	/**
	 * Get node color — CAPT source-based coloring when available,
	 * falls back to Obsidian group-based coloring.
	 */
	private getNodeColor = (node: Node): string => {
		if (this.isHighlightedNode(node)) {
			return node === this.hoveredNode
				? this.plugin.theme.interactiveAccentHover
				: this.plugin.theme.textAccent;
		}

		// CAPT source-based coloring (takes priority)
		if (this.captNodeColorFn) {
			const captColor = this.captNodeColorFn(node);
			if (captColor) return captColor;
		}

		// D5 depth-based coloring when depth axis is enabled
		if (this.dimState.enableDepthAxis) {
			const depth = (node as any).__d5_depth;
			if (depth !== undefined) {
				// Deep nodes → purple/violet, Shallow → gold/amber
				const r = Math.round(80 + 175 * (1 - depth));
				const g = Math.round(50 + 100 * depth);
				const b = Math.round(100 + 155 * depth);
				return `rgb(${r}, ${g}, ${b})`;
			}
		}

		// Fallback: Obsidian group-based coloring
		let color = this.plugin.theme.textMuted;
		this.plugin.getSettings().groups.groups.forEach((group) => {
			if (NodeGroup.matches(group.query, node)) color = group.color;
		});
		return color;
	};

	/**
	 * Get node size (val) — D5 depth affects node scale.
	 * Deeper nodes are larger, shallow nodes are smaller.
	 */
	private getNodeValue = (node: Node): number => {
		const baseVal = (node as any).val ?? 1;

		if (!this.dimState.enableDepthAxis) return baseVal;

		const depth = (node as any).__d5_depth;
		if (depth === undefined) return baseVal;

		// Scale: depth 0 → 0.5x, depth 1 → maxNodeScale x
		const scale = 0.5 + depth * (this.dimState.depthMaxNodeScale - 0.5);
		return baseVal * scale;
	};

	private doShowNode = (node: Node): boolean => {
		return (
			(this.plugin.getSettings().filters.doShowOrphans ||
				node.links.length > 0) &&
			(this.plugin.getSettings().filters.doShowAttachments ||
				!node.isAttachment)
		);
	};

	private doShowLink = (link: Link): boolean => {
		return (
			this.plugin.getSettings().filters.doShowAttachments ||
			!link.linksAnAttachment
		);
	};

	private onNodeHover = (node: Node | null): void => {
		if (
			(!node && !this.highlightedNodes.size) ||
			(node && this.hoveredNode === node)
		) {
			return;
		}

		this.clearHighlights();

		if (node) {
			this.highlightedNodes.add(node.id);
			node.neighbors.forEach((neighbor) =>
				this.highlightedNodes.add(neighbor.id)
			);
			const nodeLinks = this.graph.getLinksWithNode(node.id);

			if (nodeLinks) {
				nodeLinks.forEach((link) => this.highlightedLinks.add(link));
			}
		}
		this.hoveredNode = node ?? null;
		this.updateHighlight();
	};

	private onLinkHover = (link: Link | null): void => {
		this.clearHighlights();

		if (link) {
			this.highlightedLinks.add(link);
			this.highlightedNodes.add(link.source);
			this.highlightedNodes.add(link.target);
		}
		this.updateHighlight();
	};

	private isHighlightedLink = (link: Link): boolean => {
		return this.highlightedLinks.has(link);
	};

	private isHighlightedNode = (node: Node): boolean => {
		return this.highlightedNodes.has(node.id);
	};

	private clearHighlights = (): void => {
		this.highlightedNodes.clear();
		this.highlightedLinks.clear();
	};

	private updateHighlight(): void {
		if (!this.instance) return;
		this.instance
			.nodeColor(this.instance.nodeColor())
			.linkColor(this.instance.linkColor())
			.linkDirectionalParticles(this.instance.linkDirectionalParticles());
	}
}
