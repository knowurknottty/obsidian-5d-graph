import ForceGraph3D, { ForceGraph3DInstance } from "3d-force-graph";
import { rgba } from "polished";
import Graph from "../graph/Graph";
import Node from "../graph/Node";
import Link from "../graph/Link";
import Graph3dPlugin from "../main";
import { DimensionState } from "../dimensions/DimensionState";
import { GraphRenderer, NodeClickHandler } from "./GraphRenderer";
import { NodeGroup } from "../settings/categories/GroupSettings";

/**
 * Tier: fallback
 *
 * This is the existing 3d-force-graph backend moved behind GraphRenderer.
 * Behavior is intentionally kept equivalent to the original ForceGraph.ts.
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

	setDimensions(_state: DimensionState): void {
		// Fallback preserves current behavior. D4/D5 are implemented by later tiers.
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
		} else if (path === "display.linkWidth") {
			this.instance.linkWidth(value as number);
		} else if (path === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		}

		this.instance.refresh();
	}

	dispose(): void {
		this.nodeClickHandler = null;
		this.instance?._destructor?.();
	}

	private getNodeColor = (node: Node): string => {
		if (this.isHighlightedNode(node)) {
			return node === this.hoveredNode
				? this.plugin.theme.interactiveAccentHover
				: this.plugin.theme.textAccent;
		}

		let color = this.plugin.theme.textMuted;
		this.plugin.getSettings().groups.groups.forEach((group) => {
			if (NodeGroup.matches(group.query, node)) color = group.color;
		});
		return color;
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
