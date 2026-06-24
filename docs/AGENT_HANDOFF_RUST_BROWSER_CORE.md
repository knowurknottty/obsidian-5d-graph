# Agent Handoff Prompt — CAPT 5D Rust Browser/Core

Use this prompt to hand the next build phase to coding agents.

---

## Role

You are the lead systems architect and senior Rust engineer for the CAPT 5D Browser/Core project.

Your mission is to build the real engine behind Obsidian 5D Graph: a local-first, hardware-accelerated, Rust-native knowledge browser and graph runtime. The existing TypeScript Obsidian plugin is only the compatibility adapter. The strategic objective is a Rust core that can eventually power Obsidian, a standalone desktop browser, and agentic knowledge interfaces.

Do not treat this as a toy renderer. Treat it as the foundation for a serious spatial-temporal-semantic cognition environment.

---

## North Star

Build a native Rust 5D knowledge browser that can:

1. ingest a graph snapshot from Obsidian or another vault source;
2. compute deterministic temporal/topological/semantic metrics;
3. render large graphs through GPU-native pipelines;
4. support interactive focus, selection, filtering, and time scrubbing;
5. expose a stable protocol so the Obsidian TypeScript plugin can control it;
6. later integrate Apple Silicon MLX acceleration for local semantic intelligence.

The first milestone is not full AGI, not full browser parity, and not a finished UI. The first milestone is a working Rust-native graph engine and shell that can load, render, and interact with a vault-scale graph.

---

## Strategic Decision

Keep TypeScript only where Obsidian requires it. The final engine must be Rust.

Reasoning:

- Obsidian plugins run inside an Electron/JavaScript environment; that makes TypeScript necessary for the adapter.
- GPU rendering, graph simulation, binary caches, native shell control, local inference, and high-throughput indexing belong in Rust.
- The Obsidian plugin should export graph snapshots and receive interaction events. It should not remain the long-term engine.

---

## Repository Context

The current `obsidian-5d-graph` repository now contains:

```text
src/dimensions/DimensionState.ts
src/renderer/GraphRenderer.ts
src/renderer/RendererCapabilities.ts
src/renderer/FallbackRenderer.ts
src/views/graph/ForceGraph.ts
src/views/graph/Graph3dView.ts
src/graph/NodeMetrics.ts
```

This is the compatibility-adapter spine. It keeps the old 3D graph behavior while preparing for an external/native engine.

Your job is to build the Rust engine that makes the architecture real.

---

## Recommended Workspace

Create a Rust workspace. Either create a sibling repo named `capt-5d-browser-core` or convert the existing repo into a monorepo only if explicitly instructed.

Preferred workspace layout:

```text
capt-5d-browser-core/
  Cargo.toml
  crates/
    capt-graph-core/
      src/lib.rs
    capt-graph-cache/
      src/lib.rs
    capt-render-wgpu/
      src/lib.rs
      shaders/
        nodes.wgsl
        links.wgsl
        force_sim.wgsl
    capt-protocol/
      src/lib.rs
    capt-browser-shell/
      src/main.rs
    capt-mlx-bridge/
      src/lib.rs
  fixtures/
    sample_graph.json
  docs/
    ARCHITECTURE.md
    PROTOCOL.md
    PERFORMANCE_TARGETS.md
```

---

## Core Data Model

Implement the graph as compact, deterministic Rust structs.

```rust
pub type NodeId = u32;
pub type LinkId = u32;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GraphSnapshot {
    pub schema_version: u32,
    pub nodes: Vec<NodeRecord>,
    pub links: Vec<LinkRecord>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NodeRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_attachment: bool,
    pub tags: Vec<String>,
    pub ctime_ms: Option<i64>,
    pub mtime_ms: Option<i64>,
    pub word_count: Option<u32>,
    pub frontmatter_weight: Option<f32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LinkRecord {
    pub source: String,
    pub target: String,
    pub links_attachment: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct NodeMetrics {
    pub ctime_norm: f32,
    pub mtime_norm: f32,
    pub backlink_count: u32,
    pub outlink_count: u32,
    pub link_count: u32,
    pub tag_count: u32,
    pub word_count: u32,
    pub frontmatter_weight: f32,
    pub depth_score: f32,
}
```

Internal runtime representation should use dense IDs and packed buffers, not string lookup in hot loops.

---

## Dimensional Semantics

The graph is 5D:

```text
D1-D3: spatial position
D4:    temporal axis and time filtering
D5:    semantic depth / importance / meaning mass
```

Do not make D5 dependent on embeddings in the alpha. Start deterministic.

Initial D5 formula:

```text
depth_score = clamp01(
  0.35 * normalized_link_mass
+ 0.20 * normalized_backlink_count
+ 0.15 * normalized_word_count
+ 0.15 * normalized_tag_count
+ 0.15 * normalized_frontmatter_weight
)
```

Later, allow embedding similarity, agent memory, resurfacing frequency, and user-attention signals to modify `depth_score`.

---

## GPU Renderer Requirements

Use `wgpu` and WGSL.

Minimum renderer alpha:

- render nodes as instanced billboards or point sprites;
- render links as lines or thin instanced cylinders/segments;
- keep node positions in GPU buffers;
- support camera orbit/pan/zoom;
- support hover/select by CPU-side picking first, GPU picking later;
- support at least 100k nodes in static render mode;
- support at least 10k nodes in simulated force-layout mode.

Do not prematurely implement GPU Barnes-Hut. Start with:

1. static packed render buffers;
2. CPU layout fallback;
3. naive GPU compute force simulation for small/medium graphs;
4. profile before adding Barnes-Hut or spatial partitioning.

Required buffer layout draft:

```rust
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuNode {
    pub pos_ctime: [f32; 4],   // x, y, z, ctime_norm
    pub vel_depth: [f32; 4],   // vx, vy, vz, depth_score
    pub meta: [f32; 4],        // size, backlink_count, word_count, flags
    pub color: [f32; 4],
}
```

WGSL must read the same packed layout.

---

## Browser/Shell Requirements

Do not overcommit to a full browser engine in alpha.

Recommended alpha shell options:

1. `winit` + `wgpu` custom native shell for maximum control;
2. `egui`/`eframe` for fast native UI panels;
3. `wry`/`tao` if a webview pane is required;
4. Servo only as a long-term research target, not the first dependency.

The alpha should be a standalone app that loads a graph fixture and renders it interactively. Embedded web/document browsing can come after the graph core is real.

---

## MLX Bridge Requirements

Treat MLX as an optional Apple Silicon acceleration backend.

Do not block alpha on MLX.

Design `capt-mlx-bridge` as a feature-gated crate:

```toml
[features]
default = []
mlx = []
```

Required abstraction:

```rust
pub trait EmbeddingBackend {
    fn embed_text(&self, input: &str) -> anyhow::Result<Vec<f32>>;
    fn embed_batch(&self, inputs: &[String]) -> anyhow::Result<Vec<Vec<f32>>>;
}
```

Implement stubs only if explicitly authorized. Otherwise, define the trait and leave MLX implementation behind a clear production blocker until FFI bindings are selected and verified.

Possible routes:

- C++ MLX bridge through `cxx` crate;
- Swift/Objective-C shim on macOS;
- external local embedding service over stdio/HTTP during alpha;
- fallback Rust-native embedding backend via Candle/ONNX/llama.cpp.

The graph must remain usable without MLX.

---

## Obsidian Bridge Protocol

Design a simple protocol first.

Transport options:

1. stdio JSON-RPC if the Obsidian plugin launches the native binary;
2. localhost WebSocket if the native app runs as a sidecar;
3. file-based graph snapshot exchange for the earliest alpha.

Initial messages:

```json
{
  "type": "load_graph",
  "schema_version": 1,
  "nodes": [],
  "links": []
}
```

```json
{
  "type": "select_node",
  "node_id": "path/to/note.md"
}
```

```json
{
  "type": "set_dimension_state",
  "time_scrubber": 1.0,
  "time_axis_strength": 0.05,
  "depth_weight": 1.0
}
```

```json
{
  "type": "focus_neighborhood",
  "node_id": "path/to/note.md",
  "radius": 2
}
```

Define this in `capt-protocol` with serde types. Avoid stringly typed logic outside the protocol boundary.

---

## Required Alpha Acceptance Criteria

The alpha is successful only when all of this is true:

- `cargo test` passes.
- `cargo clippy --all-targets --all-features` passes or produces documented exceptions.
- App loads `fixtures/sample_graph.json`.
- App renders nodes and links through `wgpu`.
- User can orbit/pan/zoom.
- User can select a node and see its metadata.
- Deterministic D4/D5 metrics are computed and visible in logs/UI.
- Graph data is internally converted from string IDs to dense numeric IDs.
- No placeholder renderer theater is presented as complete.
- Performance counters are displayed or logged: node count, link count, frame time, upload time.

---

## Hard Constraints

- No fake integrations.
- No pretend MLX backend.
- No placeholder browser engine claims.
- No pseudocode unless explicitly marked as design-only.
- No hot-loop string lookups.
- No global mutable graph state without justification.
- No renderer code coupled to Obsidian APIs.
- No TypeScript expansion beyond the adapter unless needed for bridge compatibility.

---

## First Sprint

Build this first:

1. Create Rust workspace.
2. Implement `capt-protocol` serde schema.
3. Implement `capt-graph-core` dense graph conversion.
4. Implement deterministic `NodeMetrics` computation.
5. Add `fixtures/sample_graph.json`.
6. Add unit tests for graph conversion and metrics.
7. Implement minimal `capt-browser-shell` with `winit` + `wgpu` clear screen.
8. Upload packed node buffer to GPU.
9. Render nodes as instanced points/billboards.
10. Render links in the simplest correct way.
11. Add camera controls.
12. Add performance logging.

Stop after a verified runnable alpha. Then report gaps, performance results, and next sprint recommendations.

---

## Second Sprint

Only after Sprint 1 works:

1. Add force-layout simulation.
2. Add D4 temporal Z-axis mode.
3. Add D5 scale/color/depth modulation.
4. Add sidecar protocol server.
5. Add Obsidian export command in TypeScript plugin.
6. Connect Obsidian graph snapshot to native renderer.

---

## Output Expected From Agent

Return:

1. repo/workspace structure;
2. exact commands to build/test/run;
3. files created and modified;
4. verification results;
5. unresolved blockers;
6. performance measurements;
7. next sprint plan.

If any part cannot be verified, state precisely why.

---

## Final Directive

The Obsidian plugin is the bridge. The Rust engine is the beast.

Build the beast.
