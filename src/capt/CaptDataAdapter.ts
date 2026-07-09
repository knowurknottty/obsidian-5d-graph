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

// ── Adapter ────────────────────────────────────────────────────────────

export class CaptDataAdapter {
  private causalNodes: Map<string, CaptCausalNode> = new Map();
  private causalEdges: CaptCausalEdge[] = [];
  private echoTraces: Map<string, CaptEchoTrace> = new Map();
  private bubbles: CaptBubble[] = [];
  private codeNodes: CaptCodeNode[] = [];

  // Merged output
  private mergedNodes: Map<string, Node> = new Map();
  private mergedLinks: Link[] = [];
  private nodeMeta: Map<string, Capt5DNodeMeta> = new Map();

  /**
   * Ingest CAPT data from a JSON snapshot.
   * The snapshot is produced by the Python bridge script.
   */
  loadSnapshot(snapshot: CaptSnapshot): void {
    // Index causal nodes
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

    // Phase 1: CIG causal nodes → graph nodes
    for (const [name, cn] of this.causalNodes) {
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

      const node = new Node(name, `capt://${name}`, false, 10, [], [], []);
      this.mergedNodes.set(name, node);
      this.nodeMeta.set(name, meta);
    }

    // Phase 2: CIG edges → graph links
    for (const edge of this.causalEdges) {
      if (this.mergedNodes.has(edge.source) && this.mergedNodes.has(edge.target)) {
        const src = this.mergedNodes.get(edge.source)!;
        const tgt = this.mergedNodes.get(edge.target)!;
        src.addNeighbor(tgt);

        // Create actual Link object for the renderer
        const link = new Link(edge.source, edge.target, false);
        this.mergedLinks.push(link);

        // Update D5: accumulate resonance from edge strength
        const srcMeta = this.nodeMeta.get(edge.source)!;
        const tgtMeta = this.nodeMeta.get(edge.target)!;
        srcMeta.resonanceMagnitude += edge.strength;
        tgtMeta.resonanceMagnitude += edge.strength;
      }
    }

    // Phase 3: ECHO traces → augment existing or create new nodes
    for (const [, trace] of this.echoTraces) {
      const key = trace.wing;
      if (this.mergedNodes.has(key)) {
        // Augment existing node
        const meta = this.nodeMeta.get(key)!;
        meta.knowledgeLayers++;
        meta.salience = Math.max(meta.salience, trace.salience);
        meta.eventCount++;
        meta.lastEventTime = Math.max(meta.lastEventTime, trace.timestamp);
        meta.sourceIds.push(trace.trace_id);
        if (meta.sourceType !== "hybrid") meta.sourceType = "hybrid";
      } else {
        // Create new ECHO-derived node
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

        const node = new Node(trace.wing, `echo://${trace.trace_id}`, false, 8, [], [], [trace.wing]);
        this.mergedNodes.set(key, node);
        this.nodeMeta.set(key, meta);
      }
    }

    // Phase 4: Knowledge Bubbles → create domain hub nodes
    for (const bubble of this.bubbles) {
      const key = `bubble://${bubble.domain}`;
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
      const node = new Node(bubble.domain, key, false, val, [], [], [bubble.domain]);
      this.mergedNodes.set(key, node);
      this.nodeMeta.set(key, meta);

      // Connect bubble hub to its CIG/ECHO node if exists
      if (this.mergedNodes.has(bubble.domain)) {
        const hub = this.mergedNodes.get(bubble.domain)!;
        node.addNeighbor(hub);
      }
    }

    // Phase 5: CodeGraph → code topology nodes
    for (const cn of this.codeNodes) {
      const key = cn.path;
      if (!this.mergedNodes.has(key)) {
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
        const node = new Node(name, key, false, val, [], [], [cn.language]);
        this.mergedNodes.set(key, node);
        this.nodeMeta.set(key, meta);
      }
    }

    // CodeGraph import/export edges
    for (const cn of this.codeNodes) {
      for (const imp of cn.imports) {
        if (this.mergedNodes.has(imp)) {
          const src = this.mergedNodes.get(cn.path)!;
          const tgt = this.mergedNodes.get(imp)!;
          src.addNeighbor(tgt);
          const link = new Link(cn.path, imp, false);
          this.mergedLinks.push(link);
        }
      }
    }
  }

  /**
   * Compute causal depth (hacks from root causes via BFS).
   */
  private computeCausalDepth(name: string, visited: Set<string> = new Set()): number {
    if (visited.has(name)) return 0;
    visited.add(name);

    const node = this.causalNodes.get(name);
    if (!node || node.parents.length === 0) return 0;

    let maxParentDepth = 0;
    for (const parent of node.parents) {
      const depth = this.computeCausalDepth(parent, visited);
      maxParentDepth = Math.max(maxParentDepth, depth);
    }
    return maxParentDepth + 1;
  }

  // ── Public accessors ───────────────────────────────────────────────

  getNodes(): Node[] {
    return Array.from(this.mergedNodes.values());
  }

  getLinks(): Link[] {
    return this.mergedLinks;
  }

  getNodeMeta(nodeId: string): Capt5DNodeMeta | undefined {
    return this.nodeMeta.get(nodeId);
  }

  getAllMeta(): Map<string, Capt5DNodeMeta> {
    return this.nodeMeta;
  }

  getStats(): CaptSnapshotStats {
    return {
      totalNodes: this.mergedNodes.size,
      cigNodes: Array.from(this.nodeMeta.values()).filter(m => m.sourceType === "cig").length,
      echoNodes: Array.from(this.nodeMeta.values()).filter(m => m.sourceType === "echo").length,
      bubbleNodes: Array.from(this.nodeMeta.values()).filter(m => m.sourceType === "bubble").length,
      codeNodes: Array.from(this.nodeMeta.values()).filter(m => m.sourceType === "codegraph").length,
      totalLinks: this.mergedLinks.length,
      domains: [...new Set(Array.from(this.nodeMeta.values()).map(m => m.domain))],
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
