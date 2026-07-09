import { StateChange } from "../../util/State";
import Graph3dPlugin from "../../main";
import Graph from "../../graph/Graph";
import Node from "../../graph/Node";
import Link from "../../graph/Link";
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
 * ForceGraph is the 5D renderer orchestrator.
 *
 * It owns graph selection, lifecycle, settings forwarding, D4/D5 state,
 * and CAPT knowledge graph integration.
 *
 * Dimensions:
 *   D1/D2/D3 — Spatial (force-directed x/y/z)
 *   D4 — Temporal (node age via z-offset, time scrubbing)
 *   D5 — Semantic Depth (node size/color from knowledge layers)
 */
export class ForceGraph {
  private renderer!: GraphRenderer;
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
  private captMode: boolean = false;
  private d4TimeEnabled: boolean = false;
  private d5DepthEnabled: boolean = false;

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

    this.renderer = new FallbackRenderer(this.plugin);
    await this.renderer.mount(this.rootHtmlElement);

    if (this.disposed) {
      this.renderer.dispose();
      return;
    }

    this.renderer.setNodeClickHandler(this.nodeClickHandler);
    this.renderer.setCaptNodeColorFn(this.getCaptNodeColor.bind(this));
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

    // Merge CAPT nodes into the Obsidian graph
    this.mergeCaptIntoGraph();
    this.refreshGraphData();
  }

  /**
   * Merge CAPT-generated nodes and links into the main graph.
   */
  private mergeCaptIntoGraph(): void {
    const captNodes = this.captAdapter.getNodes();
    const captLinks = this.captAdapter.getLinks();

    // Add CAPT nodes that don't already exist
    for (const captNode of captNodes) {
      if (!this.graph.getNodeById(captNode.id)) {
        // @ts-ignore — push to readonly for dynamic graph building
        this.graph.nodes.push(captNode);
      }
    }

    // Add CAPT links
    for (const captLink of captLinks) {
      const existing = this.graph.getLinkByIds(captLink.source, captLink.target);
      if (!existing) {
        // @ts-ignore
        this.graph.links.push(captLink);
      }
    }

    console.log(
      `%c[5DGraph] Merged: ${captNodes.length} CAPT nodes, ${captLinks.length} CAPT links`,
      "color: #4f98a3"
    );
  }

  /**
   * Apply D4 (time) and D5 (depth) transformations to node positions and sizes.
   * Called on each render frame when D4 or D5 is enabled.
   */
  public applyDimensionTransforms(): void {
    if (!this.captMode) return;

    const meta = this.captMeta;
    const d4 = this.d4TimeEnabled;
    const d5 = this.d5DepthEnabled;

    if (!d4 && !d5) return;

    // Apply to each node in the graph via custom attributes
    for (const node of this.graph.nodes) {
      const m = meta.get(node.id);
      if (!m) continue;

      // D4: Temporal z-offset based on node age
      // Older nodes float higher (negative z), newer nodes sink lower (positive z)
      if (d4 && m.ctimeMs > 0) {
        const allCTimes = Array.from(meta.values())
          .filter(x => x.ctimeMs > 0)
          .map(x => x.ctimeMs);
        if (allCTimes.length > 0) {
          const minTime = Math.min(...allCTimes);
          const maxTime = Math.max(...allCTimes);
          const range = maxTime - minTime || 1;
          const normalized = (m.ctimeMs - minTime) / range; // 0=oldest, 1=newest

          // Store temporal offset for renderer
          (node as any).__d4_z_offset = normalized * this.dimState.timeAxisZRange;
          (node as any).__d4_normalized = normalized;
        }
      }

      // D5: Semantic depth affects node visual properties
      if (d5) {
        const depthScore = this.computeDepthScore(m);
        (node as any).__d5_depth = depthScore;
        (node as any).__d5_knowledge_layers = m.knowledgeLayers;
        (node as any).__d5_resonance = m.resonanceMagnitude;
        (node as any).__d5_token_weight = m.tokenWeight;
      }
    }
  }

  /**
   * Compute a unified depth score (0..1) from multiple knowledge signals.
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
   * Get CAPT-specific color for a node based on its knowledge domain and depth.
   */
  public getCaptNodeColor(node: Node): string | null {
    if (!this.captMode) return null;

    const meta = this.captMeta.get(node.id);
    if (!meta) return null;

    // Color by source type
    const sourceColors: Record<string, string> = {
      cig: "#ff6b6b",      // Red — causal inference
      echo: "#4ecdc4",     // Teal — episodic memory
      bubble: "#45b7d1",   // Blue — knowledge bubbles
      codegraph: "#96ceb4", // Green — code topology
      hybrid: "#dda0dd",   // Plum — multi-source
      obsidian: "#888888",  // Gray — vanilla Obsidian
    };

    let color = sourceColors[meta.sourceType] ?? "#888888";

    // If D5 depth is enabled, blend with depth-based color
    if (this.d5DepthEnabled) {
      const depth = this.computeDepthScore(meta);
      // Deep nodes shift toward purple, shallow toward yellow
      const r = Math.round(255 * (0.3 + 0.7 * (1 - depth)));
      const g = Math.round(100 * depth);
      const b = Math.round(255 * depth);
      color = `rgb(${r}, ${g}, ${b})`;
    }

    return color;
  }

  // ── Existing graph logic (preserved) ──────────────────────────────

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
    this.applyDimensionTransforms();
    this.renderer?.setGraph(this.getGraphData());
  };

  private onSettingsStateChanged = (data: StateChange): void => {
    if (this.renderer instanceof FallbackRenderer) {
      this.renderer.applySettingsChange(data.currentPath, data.newValue);
      return;
    }

    this.renderer?.setGraph(this.getGraphData());
  };

  private onCaptSnapshotLoaded = (snapshot: CaptSnapshot): void => {
    this.loadCaptSnapshot(snapshot);
  };

  private onDimensionStateChanged = (state: DimensionState): void => {
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

  public setDimensionState(partial: Partial<DimensionState>): void {
    Object.assign(this.dimState, partial);

    // Track D4/D5 toggle state
    if ("enableTimeAxis" in partial) {
      this.d4TimeEnabled = partial.enableTimeAxis ?? false;
    }
    if ("enableDepthAxis" in partial) {
      this.d5DepthEnabled = partial.enableDepthAxis ?? false;
    }

    this.refreshGraphData();

    // Push full dimension state to the renderer for D4/D5 visual effects
    this.renderer?.setDimensions(this.dimState);
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
      d4Enabled: this.d4TimeEnabled,
      d5Enabled: this.d5DepthEnabled,
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
  }
}
