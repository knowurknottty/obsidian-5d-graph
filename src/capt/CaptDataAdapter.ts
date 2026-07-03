/**
 * CAPT 5D Data Adapter
 *
 * Bridges CAPT knowledge systems (CIG, ECHO, Knowledge Bubbles, CodeGraph)
 * into the 5D graph node/link model.
 *
 * Dimensions:
 *   D1/D2/D3 — Spatial (force-directed x/y/z from 3d-force-graph)
 *   D4 — Temporal (node age, modification frequency, causal event timing)
 *   D5 — Semantic Depth (knowledge layer count, causal strength, resonance magnitude)
 *
 * Node id scheme (id === Node.path, and meta is keyed by the same id):
 *   capt://<concept>   — CIG causal concepts; ECHO traces augment the concept
 *                        whose name matches their wing, or create one
 *   bubble://<domain>  — Knowledge Bubble domain hubs
 *   <file path>        — CodeGraph source files
 */

import Node from "../graph/Node";
import Link from "../graph/Link";

// ── CAPT data shapes (mirrors Python CIG/ECHO/Bubble structs) ──────────

export interface CaptCausalNode {
  name: string;
  evidence: number;        // 0..1 causal confidence
  parents: string[];
  children: string[];
  wing?: string;           // ECHO wing classification
  salience?: number;       // 0..1 importance
}

export interface CaptCausalEdge {
  source: string;
  target: string;
  strength: number;        // 0..1 causal strength
  mechanism: string;       // "reinforcement" | "inhibition" | "triggers" | ...
}

export interface CaptEchoTrace {
  trace_id: string;
  text: string;
  wing: string;
  salience: number;
  timestamp: number;       // epoch seconds
  source: string;
}

export interface CaptBubble {
  domain: string;
  version: string;
  trace_count: number;
  token_weight: number;    // 0..1
  avg_salience: number;
  created_at: number;
}

export interface CaptCodeNode {
  path: string;
  language: string;
  imports: string[];
  exports: string[];
  lineCount: number;
}

export interface CaptResonanceVector {
  intellectual: number;
  creative: number;
  analytical: number;
  strategic: number;
  cooperative: number;
  competitive: number;
}

// ── Merged 5D node ─────────────────────────────────────────────────────

export interface Capt5DNodeMeta {
  // Source provenance
  sourceType: "cig" | "echo" | "bubble" | "codegraph" | "obsidian" | "hybrid";
  sourceIds: string[];

  // D4 — temporal
  ctimeMs: number;
  mtimeMs: number;
  eventCount: number;       // causal events involving this node
  lastEventTime: number;

  // D5 — semantic depth
  causalDepth: number;      // hops from root cause (CIG)
  knowledgeLayers: number;  // how many knowledge systems reference this node
  resonanceMagnitude: number; // CIG ResonanceVector magnitude
  tokenWeight: number;      // bubble token weight (0..1)
  salience: number;         // ECHO salience (0..1)

  // Classification
  domain: string;           // primary knowledge domain
  wing: string;             // ECHO wing
  language: string;         // CodeGraph language (if code node)
  tags: string[];
}

const conceptId = (name: string): string => `capt://${name}`;
const bubbleId = (domain: string): string => `bubble://${domain}`;

// ── Adapter ────────────────────────────────────────────────────────────

export class CaptDataAdapter {
  private causalNodes: Map<string, CaptCausalNode> = new Map();
  private causalEdges: CaptCausalEdge[] = [];
  private echoTraces: Map<string, CaptEchoTrace> = new Map();
  private bubbles: CaptBubble[] = [];
  private codeNodes: CaptCodeNode[] = [];

  // Merged output — every map is keyed by Node.id
  private mergedNodes: Map<string, Node> = new Map();
  private mergedLinks: Link[] = [];
  private nodeMeta: Map<string, Capt5DNodeMeta> = new Map();
  private causalDepthCache: Map<string, number> = new Map();

  /**
   * Structural check + normalization for snapshots coming from disk.
   * Missing sections default to empty arrays; a snapshot with no
   * recognizable section at all is rejected.
   */
  static normalizeSnapshot(raw: unknown): CaptSnapshot | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const sections = [
      "cig_nodes",
      "cig_edges",
      "echo_traces",
      "bubbles",
      "code_nodes",
    ];
    if (!sections.some((s) => Array.isArray(obj[s]))) return null;

    return {
      cig_nodes: Array.isArray(obj.cig_nodes) ? (obj.cig_nodes as CaptCausalNode[]) : [],
      cig_edges: Array.isArray(obj.cig_edges) ? (obj.cig_edges as CaptCausalEdge[]) : [],
      echo_traces: Array.isArray(obj.echo_traces) ? (obj.echo_traces as CaptEchoTrace[]) : [],
      bubbles: Array.isArray(obj.bubbles) ? (obj.bubbles as CaptBubble[]) : [],
      code_nodes: Array.isArray(obj.code_nodes) ? (obj.code_nodes as CaptCodeNode[]) : [],
      timestamp: typeof obj.timestamp === "number" ? obj.timestamp : Date.now() / 1000,
    };
  }

  /**
   * Ingest CAPT data from a JSON snapshot.
   * The snapshot is produced by the Python bridge script.
   */
  loadSnapshot(snapshot: CaptSnapshot): void {
    this.causalNodes.clear();
    for (const cn of snapshot.cig_nodes) {
      this.causalNodes.set(cn.name, cn);
    }
    this.causalEdges = snapshot.cig_edges;

    // Index ECHO traces
    const traceMap = new Map<string, CaptEchoTrace>();
    for (const t of snapshot.echo_traces) {
      traceMap.set(t.trace_id, t);
    }
    this.echoTraces = traceMap;

    this.bubbles = snapshot.bubbles;
    this.codeNodes = snapshot.code_nodes;

    this.buildMergedGraph();
  }

  /**
   * Build unified nodes and links from all CAPT sources.
   */
  private buildMergedGraph(): void {
    this.mergedNodes.clear();
    this.mergedLinks = [];
    this.nodeMeta.clear();
    this.causalDepthCache.clear();

    // Phase 1: CIG causal nodes → graph nodes
    for (const [name, cn] of this.causalNodes) {
      const id = conceptId(name);
      const meta: Capt5DNodeMeta = {
        sourceType: "cig",
        sourceIds: [name],
        ctimeMs: 0,
        mtimeMs: 0,
        eventCount: cn.parents.length + cn.children.length,
        lastEventTime: 0,
        causalDepth: this.computeCausalDepth(name),
        knowledgeLayers: 1,
        resonanceMagnitude: 0,
        tokenWeight: 0,
        salience: cn.salience ?? 0.5,
        domain: cn.wing ?? "unknown",
        wing: cn.wing ?? "unknown",
        language: "",
        tags: [],
      };

      const node = new Node(name, id, false, 10, [], [], []);
      this.mergedNodes.set(id, node);
      this.nodeMeta.set(id, meta);
    }

    // Phase 2: CIG edges → graph links
    for (const edge of this.causalEdges) {
      const srcId = conceptId(edge.source);
      const tgtId = conceptId(edge.target);
      const src = this.mergedNodes.get(srcId);
      const tgt = this.mergedNodes.get(tgtId);
      if (!src || !tgt) continue;

      const link = src.addNeighbor(tgt);
      if (link) this.mergedLinks.push(link);

      // Update D5: accumulate resonance from edge strength
      const srcMeta = this.nodeMeta.get(srcId)!;
      const tgtMeta = this.nodeMeta.get(tgtId)!;
      srcMeta.resonanceMagnitude += edge.strength;
      tgtMeta.resonanceMagnitude += edge.strength;
    }

    // Phase 3: ECHO traces → augment existing concepts or create new nodes.
    // Traces sharing a wing collapse into one concept node.
    for (const [, trace] of this.echoTraces) {
      const id = conceptId(trace.wing);
      const existing = this.nodeMeta.get(id);
      if (existing) {
        existing.knowledgeLayers++;
        existing.salience = Math.max(existing.salience, trace.salience);
        existing.eventCount++;
        existing.lastEventTime = Math.max(existing.lastEventTime, trace.timestamp);
        existing.sourceIds.push(trace.trace_id);
        if (existing.sourceType !== "echo") existing.sourceType = "hybrid";

        const traceMs = trace.timestamp * 1000;
        const node = this.mergedNodes.get(id)!;
        node.ctimeMs = node.ctimeMs === 0 ? traceMs : Math.min(node.ctimeMs, traceMs);
        node.mtimeMs = Math.max(node.mtimeMs, traceMs);
        existing.ctimeMs = node.ctimeMs;
        existing.mtimeMs = node.mtimeMs;
      } else {
        const meta: Capt5DNodeMeta = {
          sourceType: "echo",
          sourceIds: [trace.trace_id],
          ctimeMs: trace.timestamp * 1000,
          mtimeMs: trace.timestamp * 1000,
          eventCount: 1,
          lastEventTime: trace.timestamp,
          causalDepth: 0,
          knowledgeLayers: 1,
          resonanceMagnitude: 0,
          tokenWeight: 0,
          salience: trace.salience,
          domain: trace.wing,
          wing: trace.wing,
          language: "",
          tags: [],
        };

        const node = new Node(trace.wing, id, false, 8, [], [], [trace.wing]);
        node.ctimeMs = meta.ctimeMs;
        node.mtimeMs = meta.mtimeMs;
        this.mergedNodes.set(id, node);
        this.nodeMeta.set(id, meta);
      }
    }

    // Phase 4: Knowledge Bubbles → create domain hub nodes
    for (const bubble of this.bubbles) {
      const id = bubbleId(bubble.domain);
      const meta: Capt5DNodeMeta = {
        sourceType: "bubble",
        sourceIds: [bubble.domain],
        ctimeMs: bubble.created_at * 1000,
        mtimeMs: bubble.created_at * 1000,
        eventCount: bubble.trace_count,
        lastEventTime: bubble.created_at,
        causalDepth: 0,
        knowledgeLayers: 2, // bubble + underlying traces
        resonanceMagnitude: 0,
        tokenWeight: bubble.token_weight,
        salience: bubble.avg_salience,
        domain: bubble.domain,
        wing: "",
        language: "",
        tags: [],
      };

      // Size proportional to trace count
      const val = Math.min(20, 5 + Math.log2(bubble.trace_count + 1) * 2);
      const node = new Node(bubble.domain, id, false, val, [], [], [bubble.domain]);
      node.ctimeMs = meta.ctimeMs;
      node.mtimeMs = meta.mtimeMs;
      this.mergedNodes.set(id, node);
      this.nodeMeta.set(id, meta);

      // Connect bubble hub to its concept node if one exists
      const concept = this.mergedNodes.get(conceptId(bubble.domain));
      if (concept) {
        const link = node.addNeighbor(concept);
        if (link) this.mergedLinks.push(link);
      }
    }

    // Phase 5: CodeGraph → code topology nodes
    for (const cn of this.codeNodes) {
      const id = cn.path;
      if (this.mergedNodes.has(id)) continue;

      const meta: Capt5DNodeMeta = {
        sourceType: "codegraph",
        sourceIds: [cn.path],
        ctimeMs: 0,
        mtimeMs: 0,
        eventCount: cn.imports.length + cn.exports.length,
        lastEventTime: 0,
        causalDepth: 0,
        knowledgeLayers: 1,
        resonanceMagnitude: 0,
        tokenWeight: 0,
        salience: 0.3,
        domain: "code",
        wing: "",
        language: cn.language,
        tags: [],
      };

      const val = Math.min(15, 3 + Math.log2(cn.lineCount + 1));
      const name = cn.path.split("/").pop() ?? cn.path;
      const node = new Node(name, id, false, val, [], [], [cn.language]);
      this.mergedNodes.set(id, node);
      this.nodeMeta.set(id, meta);
    }

    // CodeGraph import/export edges
    for (const cn of this.codeNodes) {
      const src = this.mergedNodes.get(cn.path);
      if (!src) continue;
      for (const imp of cn.imports) {
        const tgt = this.mergedNodes.get(imp);
        if (tgt) {
          const link = src.addNeighbor(tgt);
          if (link) this.mergedLinks.push(link);
        }
      }
    }
  }

  /**
   * Compute causal depth (hops from root causes). Memoized across the
   * snapshot; the stack set only guards against cycles.
   */
  private computeCausalDepth(name: string, stack: Set<string> = new Set()): number {
    const cached = this.causalDepthCache.get(name);
    if (cached !== undefined) return cached;
    if (stack.has(name)) return 0;
    stack.add(name);

    const node = this.causalNodes.get(name);
    let depth = 0;
    if (node && node.parents.length > 0) {
      let maxParentDepth = 0;
      for (const parent of node.parents) {
        maxParentDepth = Math.max(
          maxParentDepth,
          this.computeCausalDepth(parent, stack)
        );
      }
      depth = maxParentDepth + 1;
    }

    stack.delete(name);
    this.causalDepthCache.set(name, depth);
    return depth;
  }

  // ── Public accessors ───────────────────────────────────────────────

  getNodes(): Node[] {
    return Array.from(this.mergedNodes.values());
  }

  /**
   * Returns fresh Link copies with string endpoint ids. The renderer's
   * force simulation replaces link.source/target strings with node object
   * references in place, so handing out the stored instances would corrupt
   * subsequent merges.
   */
  getLinks(): Link[] {
    return this.mergedLinks.map((link) => {
      const source =
        typeof link.source === "string" ? link.source : (link.source as unknown as Node).id;
      const target =
        typeof link.target === "string" ? link.target : (link.target as unknown as Node).id;
      return new Link(source, target, link.linksAnAttachment);
    });
  }

  getNodeMeta(nodeId: string): Capt5DNodeMeta | undefined {
    return this.nodeMeta.get(nodeId);
  }

  getAllMeta(): Map<string, Capt5DNodeMeta> {
    return this.nodeMeta;
  }

  getStats(): CaptSnapshotStats {
    const metas = Array.from(this.nodeMeta.values());
    return {
      totalNodes: this.mergedNodes.size,
      cigNodes: metas.filter((m) => m.sourceType === "cig").length,
      echoNodes: metas.filter((m) => m.sourceType === "echo").length,
      bubbleNodes: metas.filter((m) => m.sourceType === "bubble").length,
      codeNodes: metas.filter((m) => m.sourceType === "codegraph").length,
      totalLinks: this.mergedLinks.length,
      domains: [...new Set(metas.map((m) => m.domain))],
    };
  }
}

// ── Snapshot format (produced by Python bridge) ────────────────────────

export interface CaptSnapshot {
  cig_nodes: CaptCausalNode[];
  cig_edges: CaptCausalEdge[];
  echo_traces: CaptEchoTrace[];
  bubbles: CaptBubble[];
  code_nodes: CaptCodeNode[];
  timestamp: number;
}

export interface CaptSnapshotStats {
  totalNodes: number;
  cigNodes: number;
  echoNodes: number;
  bubbleNodes: number;
  codeNodes: number;
  totalLinks: number;
  domains: string[];
}
