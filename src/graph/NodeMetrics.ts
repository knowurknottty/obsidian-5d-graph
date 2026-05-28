/**
 * D4/D5-ready deterministic metrics for a graph node.
 *
 * D4 is represented by ctime/mtime normalized over the current graph.
 * D5 starts as deterministic semantic mass: graph topology + tags +
 * frontmatter. Word count is reserved for the async content-index pass.
 */
export interface NodeMetrics {
	// D4 — temporal position
	ctimeMs: number;
	mtimeMs: number;
	ctimeNorm: number;
	mtimeNorm: number;

	// Topology
	backlinkCount: number;
	outlinkCount: number;
	linkCount: number;

	// Content / metadata
	wordCount: number;
	tagCount: number;
	frontmatterKeyCount: number;
	frontmatterWeight: number;

	// D5 — normalized semantic mass/depth, 0..1
	depthScore: number;
}

export const DEFAULT_NODE_METRICS: NodeMetrics = {
	ctimeMs: 0,
	mtimeMs: 0,
	ctimeNorm: 0,
	mtimeNorm: 0,
	backlinkCount: 0,
	outlinkCount: 0,
	linkCount: 0,
	wordCount: 0,
	tagCount: 0,
	frontmatterKeyCount: 0,
	frontmatterWeight: 0,
	depthScore: 0,
};
