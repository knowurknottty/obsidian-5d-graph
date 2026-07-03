import { StateChange } from "../../util/State";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import Node from "../../graph/Node";
import EventBus from "../../util/EventBus";
import {
  DEFAULT_DIMENSION_STATE,
  DimensionState,
} from "../../dimensions/DimensionState";
import { detectCapabilities } from "../../renderer/RendererCapabilities";
import { GraphRenderer, NodeClickHandler } from "../../renderer/GraphRenderer";
import { FallbackRenderer } from "../../renderer/FallbackRenderer";
import { CaptDataAdapter, Capt5DNodeMeta, CaptSnapshot } from "../../capt/CaptDataAdapter";

/**
 * Per-node 5D attributes written by the orchestrator and read by renderers.
 * They live on the node objects themselves so the renderer's accessor
 * closures can pick them up without extra lookups per frame.
 */
export interface Node5D extends Node {
  __d4_normalized?: number; // 0 = oldest, 1 = newest
  __d5_depth?: number; // 0..1 semantic depth
  __d5_color?: string; // depth-blended color (only set while D5 is on)
  __capt_color?: string; // knowledge-source provenance color
}

const CAPT_SOURCE_COLORS: Record<string, string> = {
  cig: "#ff6b6b", // Red — causal inference
  echo: "#4ecdc4", // Teal — episodic memory
  bubble: "#45b7d1", // Blue — knowledge bubbles
  codegraph: "#96ceb4", // Green — code topology
  hybrid: "#dda0dd", // Plum — multi-source
  obsidian: "#888888", // Gray — vanilla Obsidian
};

/**
 * ForceGraph is the 5D renderer orchestrator.
 *
 * It owns graph selection, lifecycle, settings forwarding, D4/D5 state,
 * and CAPT knowledge graph integration.
 *
 * Dimensions:
 *   D1/D2/D3 — Spatial (force-directed x/y/z)
 *   D4 — Temporal (node age via z-offset, time scrubbing)
 *   D5 — Semantic Depth (node size/color from knowledge layers)
 *
 * D4/D5 work on any vault: file ctime/mtime drives the time axis and link/tag
 * topology drives depth. Loading a CAPT snapshot enriches both dimensions
 * with causal depth, knowledge layers, resonance, and salience.
 */
export class ForceGraph {
  private renderer: GraphRenderer | null = null;
  private readonly rootHtmlElement: HTMLElement;
  private readonly isLocalGraph: boolean;
  private graph!: Graph;
  private readonly plugin: Graph3dPlugin;
  private readonly unsubscribeHandles: (() => void)[] = [];
  private readonly dimState: DimensionState = { ...DEFAULT_DIMENSION_STATE };
  private nodeClickHandler: NodeClickHandler | null = null;
  private disposed = false;

  // CAPT 5D integration
  private captAdapter: CaptDataAdapter = new CaptDataAdapter();
  private captMeta: Map<string, Capt5DNodeMeta> = new Map();
  private captMode = false;

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

    const renderer = new FallbackRenderer(this.plugin);
    await renderer.mount(this.rootHtmlElement);

    if (this.disposed) {
      renderer.dispose();
      return;
    }

    this.renderer = renderer;
    this.renderer.setNodeClickHandler(this.nodeClickHandler);
    this.refreshGraphData();
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
    EventBus.on("capt-snapshot-loaded", this.onCaptSnapshotLoaded);
    EventBus.on("dimension-state-changed", this.onDimensionStateChanged);
  }

  // ── CAPT 5D Integration ──────────────────────────────────────────

  /**
   * Load a CAPT knowledge snapshot into the graph.
   * Merges CIG causal nodes, ECHO traces, Knowledge Bubbles, and CodeGraph
   * into the Obsidian graph as additional nodes and links.
   */
  public loadCaptSnapshot(snapshot: CaptSnapshot): void {
    this.captAdapter.loadSnapshot(snapshot);
    this.captMeta = this.captAdapter.getAllMeta();
    this.captMode = true;

    console.log(
      `%c[5DGraph] CAPT snapshot loaded:`,
      "color: #4f98a3; font-weight: bold",
      this.captAdapter.getStats()
    );

    this.refreshGraphData();
    EventBus.trigger("capt-stats-updated", this.get5DStats());
  }

  /**
   * Merge CAPT-generated nodes and links into the given graph.
   * Runs against the freshly cloned graph on every refresh, because
   * getGraphData() rebuilds the graph from the vault each time.
   */
  private mergeCaptIntoGraph(graph: Graph): void {
    const captNodes = this.captAdapter.getNodes();
    const captLinks = this.captAdapter.getLinks();

    for (const captNode of captNodes) {
      graph.addNode(captNode);
    }

    for (const captLink of captLinks) {
      if (
        graph.getNodeById(captLink.source) &&
        graph.getNodeById(captLink.target)
      ) {
        graph.addLink(captLink);
      }
    }
  }

  /**
   * Apply D4 (time) and D5 (depth) attributes to every node, in a single
   * O(nodes) pass with min/max ranges hoisted out of the loop.
   *
   * Works with or without a CAPT snapshot: CAPT metadata is used when
   * present, otherwise file timestamps and link/tag topology stand in.
   */
  private applyDimensionTransforms(): void {
    if (!this.graph) return;

    const d4 = this.dimState.enableTimeAxis;
    const d5 = this.dimState.enableDepthAxis;
    const nodes = this.graph.nodes as Node5D[];

    // Pass 1: value ranges for normalization
    let minTime = Infinity;
    let maxTime = -Infinity;
    let maxLinks = 0;
    let maxTags = 0;
    for (const node of nodes) {
      const ctime = this.nodeCtime(node);
      if (ctime > 0) {
        if (ctime < minTime) minTime = ctime;
        if (ctime > maxTime) maxTime = ctime;
      }
      if (node.links.length > maxLinks) maxLinks = node.links.length;
      if (node.tags.length > maxTags) maxTags = node.tags.length;
    }
    const timeRange = maxTime > minTime ? maxTime - minTime : 1;

    // Pass 2: write per-node attributes
    for (const node of nodes) {
      const meta = this.captMeta.get(node.id);

      if (this.captMode && meta) {
        node.__capt_color = CAPT_SOURCE_COLORS[meta.sourceType] ?? CAPT_SOURCE_COLORS.obsidian;
      } else {
        delete node.__capt_color;
      }

      if (d4) {
        const ctime = this.nodeCtime(node);
        if (ctime > 0 && maxTime > minTime) {
          node.__d4_normalized = (ctime - minTime) / timeRange;
        } else {
          delete node.__d4_normalized;
        }
      } else {
        delete node.__d4_normalized;
      }

      if (d5) {
        const depth = meta
          ? this.computeDepthScore(meta)
          : this.computeVaultDepthScore(node, maxLinks, maxTags, minTime, timeRange);
        node.__d5_depth = depth;
        node.__d5_color = this.depthColor(depth);
      } else {
        delete node.__d5_depth;
        delete node.__d5_color;
      }
    }
  }

  private nodeCtime(node: Node5D): number {
    const meta = this.captMeta.get(node.id);
    if (meta && meta.ctimeMs > 0) return meta.ctimeMs;
    return node.ctimeMs ?? 0;
  }

  /**
   * Compute a unified depth score (0..1) from CAPT knowledge signals.
   */
  private computeDepthScore(meta: Capt5DNodeMeta): number {
    const alpha = this.dimState.depthAlpha;
    const beta = this.dimState.depthBeta;
    const gamma = this.dimState.depthGamma;

    // Normalize each signal to 0..1
    const causalNorm = Math.min(1.0, meta.causalDepth / 5); // 5 hops = max depth
    const layersNorm = Math.min(1.0, meta.knowledgeLayers / 4); // 4 layers = max
    const resonanceNorm = Math.min(1.0, meta.resonanceMagnitude / 3); // 3.0 = max
    const tokenNorm = meta.tokenWeight;
    const salienceNorm = meta.salience;

    // Weighted combination
    const depth =
      alpha * causalNorm +
      beta * layersNorm +
      gamma * (resonanceNorm * 0.3 + tokenNorm * 0.3 + salienceNorm * 0.4);

    return Math.min(1.0, Math.max(0.0, depth));
  }

  /**
   * Deterministic depth for plain vault nodes: link connectivity stands in
   * for causal depth, tag richness for knowledge layers, and modification
   * recency for resonance.
   */
  private computeVaultDepthScore(
    node: Node5D,
    maxLinks: number,
    maxTags: number,
    minTime: number,
    timeRange: number
  ): number {
    const alpha = this.dimState.depthAlpha;
    const beta = this.dimState.depthBeta;
    const gamma = this.dimState.depthGamma;

    const linkNorm = maxLinks > 0 ? node.links.length / maxLinks : 0;
    const tagNorm = maxTags > 0 ? node.tags.length / maxTags : 0;
    const recencyNorm =
      node.mtimeMs > 0 && isFinite(minTime)
        ? Math.min(1, Math.max(0, (node.mtimeMs - minTime) / timeRange))
        : 0;

    const depth = alpha * linkNorm + beta * tagNorm + gamma * recencyNorm;
    return Math.min(1.0, Math.max(0.0, depth));
  }

  /** Deep nodes shift toward purple, shallow toward yellow. */
  private depthColor(depth: number): string {
    const r = Math.round(255 * (0.3 + 0.7 * (1 - depth)));
    const g = Math.round(100 * depth);
    const b = Math.round(255 * depth);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // ── Graph lifecycle ────────────────────────────────────────────────

  private getGraphData(): Graph {
    if (this.isLocalGraph && this.plugin.openFileState.value) {
      return this.plugin.globalGraph
        .clone()
        .getLocalGraph(this.plugin.openFileState.value);
    }
    return this.plugin.globalGraph.clone();
  }

  /**
   * Full rebuild: re-clone the vault graph, re-merge CAPT knowledge,
   * recompute dimension attributes, then hand the renderer new data.
   */
  private refreshGraphData = (): void => {
    if (!this.renderer) return;
    this.graph = this.getGraphData();
    // Local graphs stay scoped to the open file's neighborhood; the CAPT
    // universe only merges into the global view.
    if (this.captMode && !this.isLocalGraph) {
      this.mergeCaptIntoGraph(this.graph);
    }
    this.applyDimensionTransforms();
    this.renderer.setGraph(this.graph);
    this.renderer.setDimensions({ ...this.dimState });
  };

  private onSettingsStateChanged = (data: StateChange): void => {
    if (this.renderer instanceof FallbackRenderer) {
      this.renderer.applySettingsChange(data.currentPath, data.newValue);
      return;
    }

    this.refreshGraphData();
  };

  private onCaptSnapshotLoaded = (snapshot: CaptSnapshot): void => {
    this.loadCaptSnapshot(snapshot);
  };

  private onDimensionStateChanged = (state: Partial<DimensionState>): void => {
    this.setDimensionState(state);
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

  /**
   * Cheap dimension update: recompute per-node attributes in place and let
   * the renderer refresh its visuals. Does NOT rebuild graph data, so the
   * force simulation (and camera) are preserved while scrubbing sliders.
   */
  public setDimensionState(partial: Partial<DimensionState>): void {
    Object.assign(this.dimState, partial);
    this.applyDimensionTransforms();
    this.renderer?.setDimensions({ ...this.dimState });
  }

  public setNodeClickHandler(handler: NodeClickHandler | null): void {
    this.nodeClickHandler = handler;
    this.renderer?.setNodeClickHandler(handler);
  }

  /**
   * Get current 5D stats for the status panel.
   */
  public get5DStats(): {
    captMode: boolean;
    d4Enabled: boolean;
    d5Enabled: boolean;
    totalNodes: number;
    captNodes: number;
    domains: string[];
  } {
    const stats = this.captAdapter.getStats();
    return {
      captMode: this.captMode,
      d4Enabled: this.dimState.enableTimeAxis,
      d5Enabled: this.dimState.enableDepthAxis,
      totalNodes: this.graph?.nodes.length ?? 0,
      captNodes: stats.totalNodes,
      domains: stats.domains,
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.unsubscribeHandles.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeHandles.splice(0, this.unsubscribeHandles.length);
    EventBus.off("graph-changed", this.refreshGraphData);
    EventBus.off("capt-snapshot-loaded", this.onCaptSnapshotLoaded);
    EventBus.off("dimension-state-changed", this.onDimensionStateChanged);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
