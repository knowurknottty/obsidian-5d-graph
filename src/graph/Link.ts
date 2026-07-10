import Node from "./Node";

export type ResolvedLinkCache = Record<string, Record<string, number>>;

export default class Link {
	public readonly source: string;
	public readonly target: string;
	public readonly linksAnAttachment: boolean;

	constructor(sourceId: string, targetId: string, linksAnAttachment: boolean) {
		this.source = sourceId;
		this.target = targetId;
		this.linksAnAttachment = linksAnAttachment;
	}

	/**
	 * D3-safe ID extractor.
	 * After 3d-force-graph renders, link.source / link.target are replaced
	 * with Node objects. This helper extracts the string ID regardless.
	 */
	static idOf(val: string | { id: string }): string {
		return typeof val === "string" ? val : val.id;
	}

	// Creates a link index for an array of links
	static createLinkIndex(links: Link[]): Map<string, Map<string, number>> {
		const linkIndex = new Map<string, Map<string, number>>();
		links.forEach((link, index) => {
			const src = Link.idOf(link.source as any);
			if (!linkIndex.has(src)) {
				linkIndex.set(src, new Map<string, number>());
			}
			linkIndex.get(src)?.set(Link.idOf(link.target as any), index);
		});

		return linkIndex;
	}

	// Creates an array of links + index from an array of nodes and the Obsidian API cache
	static createFromCache(
		cache: ResolvedLinkCache,
		nodes: Node[],
		nodeIndex: Map<string, number>
	): [Link[], Map<string, Map<string, number>>] {
		const links = Object.keys(cache)
			.map((node1Id) => {
				return Object.keys(cache[node1Id])
					.map((node2Id) => {
						const [node1Index, node2Index] = [
							nodeIndex.get(node1Id),
							nodeIndex.get(node2Id),
						];
						if (
							node1Index !== undefined &&
							node2Index !== undefined
						) {
							return nodes[node1Index].addNeighbor(
								nodes[node2Index]
							);
						}
						return null;
					})
					.flat();
			})
			.flat()
			// remove duplicates and nulls
			.filter(
				(link, index, self) =>
					link &&
					link.source !== link.target &&
					index ===
						self.findIndex(
							(l: Link | null) =>
								l &&
								Link.idOf(l.source as any) === Link.idOf(link.source as any) &&
								Link.idOf(l.target as any) === Link.idOf(link.target as any)
						)
		) as Link[];

		return [links, Link.createLinkIndex(links)];
	}
}
