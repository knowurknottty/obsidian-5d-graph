import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import { rgba } from "polished";
import Graph from "../graph/Graph";
import Node from "../graph/Node";
import Link from "../graph/Link";
import Graph3dPlugin from "../main";
import {
	DEFAULT_DIMENSION_STATE,
	DimensionState,
} from "../dimensions/DimensionState";
import { GraphRenderer, NodeClickHandler } from "./GraphRenderer";
import { NodeGroup } from "../settings/categories/GroupSettings";
import type { Node5D } from "../views/graph/ForceGraph";

const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** After the simulation starts, d3 replaces link endpoint ids with node refs. */
const endpointId = (endpoint: string | Node): string =>
	typeof endpoint === "string" ? endpoint : endpoint.id;

/**
 * Tier: fallback
 *
 * 3d-force-graph backend behind the GraphRenderer contract.
 *
 * D4 (time) renders as a soft z-positioning force toward each node's
 * temporal layer plus scrubber-driven visibility. D5 (depth) renders as
 * node radius scaling and depth-blended color.
 *
 * Hot paths (accessors run per node per refresh) read from caches that are
 * invalidated on graph/settings changes instead of recomputing:
 *   - group colors (regex matching) → groupColorCache
 *   - node adjacency for hover highlighting → adjacency map
 */
export class FallbackRenderer implements GraphRenderer {
	readonly tier = "fallback" as const;

	private instance: ForceGraph3DInstance;
	private graph: Graph;
	private readonly plugin: Graph3dPlugin;
	private dimState: DimensionState = { ...DEFAULT_DIMENSION_STATE };
	private readonly highlightedNodes: Set<string> = new Set();
	private readonly highlightedLinks: Set<Link> = new Set();
	private hoveredNode: Node | null = null;
	private nodeClickHandler: NodeClickHandler | null = null;

	// Per-graph caches for hot accessor paths
	private readonly groupColorCache: Map<string, string | null> = new Map();
	private adjacency: Map<string, Link[]> = new Map();
	private simulationNodes: Node5D[] = [];

	constructor(plugin: Graph3dPlugin) {
		this.plugin = plugin;
	}

	async mount(el: HTMLElement): Promise<void> {
		const [width, height] = [el.offsetWidth, el.offsetHeight];
		this.instance = ForceGraph3D()(el)
			.nodeLabel(
				(node: Node) => `<div class="node-label">${escapeHtml(node.name)}</div>`
			)
			.nodeRelSize(this.plugin.getSettings().display.nodeSize)
			.nodeVal((node: Node5D) => this.getNodeVal(node))
			.backgroundColor(rgba(0, 0, 0, 0.0))
			.width(width)
			.height(height)
			.nodeColor((node: Node) => this.getNodeColor(node))
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
		this.groupColorCache.clear();
		this.adjacency = this.buildAdjacency(graph);
		this.clearHighlights();
		this.hoveredNode = null;
		this.instance?.graphData(graph);
	}

	/**
	 * Apply D4/D5 state without touching graph data, preserving simulation
	 * positions and camera. Re-assigning accessors triggers the library's
	 * per-channel refresh.
	 */
	setDimensions(state: DimensionState): void {
		this.dimState = { ...state };
		if (!this.instance) return;

		if (state.enableTimeAxis) {
			this.instance.d3Force("temporal", this.temporalForce);
			this.instance.d3ReheatSimulation();
		} else if (this.instance.d3Force("temporal")) {
			this.instance.d3Force("temporal", null as never);
			this.instance.d3ReheatSimulation();
		}

		this.instance
			.nodeVal(this.instance.nodeVal())
			.nodeColor(this.instance.nodeColor())
			.nodeVisibility(this.instance.nodeVisibility())
			.linkVisibility(this.instance.linkVisibility());
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

	applySettingsChange(path: string, value: unknown): void {
		if (!this.instance) return;

		if (path === "display.nodeSize") {
			this.instance.nodeRelSize(value as number);
		} else if (path === "display.linkThickness") {
			this.instance.linkWidth(this.instance.linkWidth());
		} else if (path === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		} else if (path === "display.particleCount") {
			this.instance.linkDirectionalParticles(
				this.instance.linkDirectionalParticles()
			);
		} else if (path.startsWith("groups")) {
			this.groupColorCache.clear();
			this.instance.nodeColor(this.instance.nodeColor());
		} else if (path.startsWith("filters")) {
			this.instance
				.nodeVisibility(this.instance.nodeVisibility())
				.linkVisibility(this.instance.linkVisibility());
		}

		this.instance.refresh();
	}

	dispose(): void {
		this.nodeClickHandler = null;
		this.simulationNodes = [];
		this.instance?._destructor?.();
	}

	// ── D4 temporal force ─────────────────────────────────────────────

	/**
	 * Soft positioning force pulling each dated node's z toward its
	 * temporal layer: oldest at -zRange/2, newest at +zRange/2.
	 */
	private temporalForce = Object.assign(
		(alpha: number) => {
			const zRange = this.dimState.timeAxisZRange;
			const strength = this.dimState.timeAxisStrength;
			for (const node of this.simulationNodes) {
				if (node.__d4_normalized === undefined) continue;
				const targetZ = (node.__d4_normalized - 0.5) * zRange;
				const nodeAny = node as Node5D & { z?: number; vz?: number };
				nodeAny.vz =
					(nodeAny.vz ?? 0) +
					(targetZ - (nodeAny.z ?? 0)) * strength * alpha;
			}
		},
		{
			initialize: (nodes: Node5D[]) => {
				this.simulationNodes = nodes;
			},
		}
	);

	// ── Node visuals ──────────────────────────────────────────────────

	/** D5: scale node radius by semantic depth up to depthMaxNodeScale. */
	private getNodeVal = (node: Node5D): number => {
		const base = node.val ?? 1;
		if (node.__d5_depth === undefined) return base;
		return base * (1 + node.__d5_depth * (this.dimState.depthMaxNodeScale - 1));
	};

	private getNodeColor = (node: Node5D): string => {
		if (this.isHighlightedNode(node)) {
			return node === this.hoveredNode
				? this.plugin.theme.interactiveAccentHover
				: this.plugin.theme.textAccent;
		}

		// D5 depth blend wins, then CAPT provenance, then user groups
		if (node.__d5_color) return node.__d5_color;
		if (node.__capt_color) return node.__capt_color;

		return this.getGroupColor(node) ?? this.plugin.theme.textMuted;
	};

	private getGroupColor(node: Node): string | null {
		const cached = this.groupColorCache.get(node.id);
		if (cached !== undefined) return cached;

		let color: string | null = null;
		for (const group of this.plugin.getSettings().groups.groups) {
			if (NodeGroup.matches(group.query, node)) color = group.color;
		}
		this.groupColorCache.set(node.id, color);
		return color;
	}

	private doShowNode = (node: Node5D): boolean => {
		const filters = this.plugin.getSettings().filters;
		if (!filters.doShowOrphans && node.links.length === 0) return false;
		if (!filters.doShowAttachments && node.isAttachment) return false;

		// D4 time scrubber: hide nodes newer than the scrub position
		if (this.dimState.enableTimeAxis && this.isScrubbedOut(node)) {
			return false;
		}

		return true;
	};

	private doShowLink = (link: Link): boolean => {
		if (
			!this.plugin.getSettings().filters.doShowAttachments &&
			link.linksAnAttachment
		) {
			return false;
		}

		// Hide links whose endpoints are scrubbed out by the D4 time axis
		if (this.dimState.enableTimeAxis) {
			const source = this.resolveEndpoint(link.source);
			const target = this.resolveEndpoint(link.target);
			if (
				(source && this.isScrubbedOut(source)) ||
				(target && this.isScrubbedOut(target))
			) {
				return false;
			}
		}

		return true;
	};

	private resolveEndpoint(endpoint: string | Node): Node5D | null {
		if (typeof endpoint !== "string") return endpoint as Node5D;
		return (this.graph?.getNodeById(endpoint) as Node5D) ?? null;
	}

	private isScrubbedOut(node: Node5D): boolean {
		return (
			node.__d4_normalized !== undefined &&
			node.__d4_normalized > this.dimState.timeScrubber
		);
	}

	// ── Hover highlighting ────────────────────────────────────────────

	private buildAdjacency(graph: Graph): Map<string, Link[]> {
		const adjacency = new Map<string, Link[]>();
		for (const link of graph.links) {
			const source = endpointId(link.source);
			const target = endpointId(link.target);
			if (!adjacency.has(source)) adjacency.set(source, []);
			if (!adjacency.has(target)) adjacency.set(target, []);
			adjacency.get(source)?.push(link);
			adjacency.get(target)?.push(link);
		}
		return adjacency;
	}

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
			const nodeLinks = this.adjacency.get(node.id);
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
			this.highlightedNodes.add(endpointId(link.source));
			this.highlightedNodes.add(endpointId(link.target));
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
