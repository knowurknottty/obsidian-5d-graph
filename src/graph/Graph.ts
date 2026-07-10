import Link from "./Link";
import Node from "./Node";
import { App } from "obsidian";

export default class Graph {
	public readonly nodes: Node[];
	public readonly links: Link[];

	// Indexes to quickly retrieve nodes and links by id
	private readonly nodeIndex: Map<string, number>;
	private readonly linkIndex: Map<string, Map<string, number>>;

	constructor(
		nodes: Node[],
		links: Link[],
		nodeIndex: Map<string, number>,
		linkIndex: Map<string, Map<string, number>>
	) {
		this.nodes = nodes;
		this.links = links;
		this.nodeIndex = nodeIndex || new Map<string, number>();
		this.linkIndex = linkIndex || new Map<string, Map<string, number>>();
	}

	// Returns a node by its id
	public getNodeById(id: string): Node | null {
		const index = this.nodeIndex.get(id);
		if (index !== undefined) {
			return this.nodes[index];
		}
		return null;
	}

	// Returns a link by its source and target node ids
	public getLinkByIds(
		sourceNodeId: string,
		targetNodeId: string
	): Link | null {
		const sourceLinkMap = this.linkIndex.get(sourceNodeId);
		if (sourceLinkMap) {
			const index = sourceLinkMap.get(targetNodeId);
			if (index !== undefined) {
				return this.links[index];
			}
		}
		return null;
	}

	// Returns the outgoing links of a node
	public getLinksFromNode(sourceNodeId: string): Link[] {
		const sourceLinkMap = this.linkIndex.get(sourceNodeId);
		if (sourceLinkMap) {
			return Array.from(sourceLinkMap.values()).map(
				(index) => this.links[index]
			);
		}
		return [];
	}

	// Returns the outgoing and incoming links of a node
	public getLinksWithNode(nodeId: string): Link[] {
		// D3 replaces string source/target with Node objects after render.
		// Use Link.idOf for D3-safe comparison in both cases.
		return this.links.filter(
			(link) =>
				Link.idOf(link.source as any) === nodeId ||
				Link.idOf(link.target as any) === nodeId
		);
	}

	/**
	 * Returns the local graph of a node (the node + its direct neighbors
	 * + all edges between them).
	 *
	 * Fixes vs. old implementation:
	 * 1. No structuredClone — avoids breaking Node prototype methods
	 *    (isNeighborOf uses reference equality on this.neighbors).
	 * 2. No splice mutation — old code destroyed inter-neighbor edges.
	 * 3. Collects ALL links where both endpoints are in the local set,
	 *    not just links attached to the hub node.
	 */
	public getLocalGraph(nodeId: string): Graph {
		const centralNode = this.getNodeById(nodeId);
		if (!centralNode) return new Graph([], [], new Map(), new Map());

		// Build local node set: hub + its direct neighbors
		const localNodeIds = new Set<string>([centralNode.id]);
		centralNode.neighbors.forEach((n) => localNodeIds.add(n.id));

		// Collect live Node references (no clone)
		const nodes: Node[] = [];
		const nodeIndex = new Map<string, number>();
		localNodeIds.forEach((id) => {
			const n = this.getNodeById(id);
			if (n) {
				nodeIndex.set(n.id, nodes.length);
				nodes.push(n);
			}
		});

		// Collect all links where BOTH endpoints are in the local set.
		// This includes inter-neighbor edges, not just hub-spoke edges.
		const links: Link[] = this.links.filter((link) => {
			const src = Link.idOf(link.source as any);
			const tgt = Link.idOf(link.target as any);
			return localNodeIds.has(src) && localNodeIds.has(tgt);
		});

		const linkIndex = Link.createLinkIndex(links);
		return new Graph(nodes, links, nodeIndex, linkIndex);
	}

	// Clones the graph (global graph only — use getLocalGraph for subgraphs)
	public clone = (): Graph => {
		return new Graph(
			[...this.nodes],
			[...this.links],
			new Map(this.nodeIndex),
			new Map(
				Array.from(this.linkIndex.entries()).map(([k, v]) => [k, new Map(v)])
			)
		);
	};

	// Creates a graph using the Obsidian API
	public static createFromApp = (app: App): Graph => {
		const [nodes, nodeIndex] = Node.createFromFiles(app.vault.getFiles()),
			[links, linkIndex] = Link.createFromCache(
				app.metadataCache.resolvedLinks,
				nodes,
				nodeIndex
			);
		return new Graph(nodes, links, nodeIndex, linkIndex);
	};

	// updates this graph with new data from the Obsidian API
	public update = (app: App) => {
		const newGraph = Graph.createFromApp(app);

		this.nodes.splice(0, this.nodes.length, ...newGraph.nodes);
		this.links.splice(0, this.links.length, ...newGraph.links);

		this.nodeIndex.clear();
		newGraph.nodeIndex.forEach((value, key) => {
			this.nodeIndex.set(key, value);
		});

		this.linkIndex.clear();
		newGraph.linkIndex.forEach((value, key) => {
			this.linkIndex.set(key, value);
		});
	};
}
