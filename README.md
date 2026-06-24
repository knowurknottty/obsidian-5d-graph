# Obsidian 5D Graph

**Obsidian 5D Graph** is evolving from a 3D Obsidian graph plugin into a hardware-accelerated knowledge-navigation substrate: a spatial, temporal, and semantic graph interface for local-first cognition.

This repository currently contains the Obsidian compatibility layer. The long-term engine should not remain a TypeScript-only visualization. The correct end-state is a Rust-native graph/browser core with a thin TypeScript adapter for Obsidian.

## What this is

The current plugin provides a 3D graph view for an Obsidian vault and has begun the transition toward a renderer-tier architecture:

- **Fallback renderer**: current `3d-force-graph` backend, preserved for compatibility.
- **Renderer interface**: a stable seam for future native/WebGPU/worker-backed renderers.
- **Dimension state contract**: early D4/D5 control structure for time and semantic depth.
- **Node metrics contract**: deterministic structure for time, topology, tags, metadata, and future semantic mass.

The goal is not merely a prettier graph. The goal is a local-first knowledge cockpit where notes, files, agents, embeddings, timelines, memory, and semantic gravity become navigable as a living cognitive map.

## Strategic architecture decision

The system should split into two layers:

```text
obsidian-5d-graph/
  TypeScript Obsidian adapter
  - reads Obsidian vault/cache state
  - exposes commands, settings, and plugin UI
  - sends graph snapshots to the engine
  - receives render/selection/focus events

capt-5d-browser-core/
  Rust native core
  - graph index
  - temporal/semantic metrics
  - GPU renderer via wgpu
  - MLX bridge on Apple Silicon
  - local embedding/search/memory layer
  - standalone knowledge browser shell
```

TypeScript remains only where the host platform requires it. Rust owns the serious engine.

## Why not stay TypeScript?

TypeScript is acceptable for an Obsidian integration layer, but it is the wrong center of gravity for the final system.

A real 5D knowledge browser needs:

- deterministic memory-safe graph indexing;
- high-throughput layout and simulation;
- GPU-native rendering;
- binary cache formats;
- local embedding and inference paths;
- predictable worker/task scheduling;
- portable native packaging;
- performance budgets that survive large vaults.

That points to Rust.

## Proposed final stack

```text
Language core:      Rust
Rendering:          wgpu + WGSL
Window/app shell:   wry/tao, Tauri, egui, or a custom winit shell
Browser research:   Servo as a long-term embedding/reference option, not alpha dependency
ML engine:          MLX on Apple Silicon through C/C++/Swift FFI bridge
Fallback ML:        Candle, ONNX Runtime, llama.cpp, or other local inference backends
Obsidian bridge:    TypeScript plugin adapter
Data transport:     JSON first, then MessagePack/FlatBuffers/Cap'n Proto after contracts stabilize
Storage:            SQLite + content-addressed graph cache
```

## Dimensional model

The name “5D” is not decorative. It defines the graph model:

```text
D1-D3: spatial graph layout
D4:    temporal structure — created, modified, resurfaced, decayed, revived
D5:    semantic depth — importance, centrality, embeddings, tags, frontmatter, agent memory
```

Initial D5 should stay deterministic before embeddings are introduced:

```text
depthScore =
  backlink mass
+ outlink mass
+ tag density
+ frontmatter weight
+ content length
+ recurrence/attention score
```

Embeddings and ML should modify the semantic field later. They should not be required for the first stable graph engine.

## Current repository status

This repo now has the first architecture seam:

```text
src/dimensions/DimensionState.ts
src/renderer/GraphRenderer.ts
src/renderer/RendererCapabilities.ts
src/renderer/FallbackRenderer.ts
src/views/graph/ForceGraph.ts
src/views/graph/Graph3dView.ts
src/graph/NodeMetrics.ts
```

The current fallback renderer keeps the old runtime behavior while preparing the codebase for stronger backends.

## Near-term roadmap

### Phase 1 — stabilize the Obsidian adapter

- Keep the fallback renderer working.
- Confirm plugin build and load behavior in Obsidian.
- Fix settings path inconsistencies.
- Add snapshot export from Obsidian vault graph to a versioned schema.
- Add test fixtures for graph conversion.

### Phase 2 — build the Rust graph core

Create a separate Rust workspace for the real engine:

```text
crates/
  capt-graph-core/
  capt-graph-cache/
  capt-render-wgpu/
  capt-mlx-bridge/
  capt-browser-shell/
  capt-obsidian-protocol/
```

Required first alpha target:

- load a graph snapshot from disk;
- compute deterministic D4/D5 metrics;
- render 100k nodes as GPU instances;
- pan/zoom/orbit/focus/select nodes;
- stream selection events back to the host;
- persist layout/cache state.

### Phase 3 — connect Obsidian to Rust

Bridge options, in order of practicality:

1. local sidecar process over localhost/WebSocket;
2. spawned native binary with stdio JSON-RPC;
3. WASM module for constrained graph compute;
4. native plugin packaging if Obsidian/Electron constraints allow it.

The first production-grade bridge should be a local sidecar process because it is debuggable, replaceable, and does not fight Obsidian's plugin sandbox.

### Phase 4 — MLX semantic layer

MLX should be treated as an Apple Silicon acceleration backend, not as the only intelligence path.

The MLX layer should provide:

- local embedding generation;
- semantic-neighbor search;
- clustering hints;
- note resurfacing scores;
- agent memory projections;
- optional graph-aware reranking.

The graph must still function without MLX.

### Phase 5 — standalone 5D browser

The standalone app becomes the real flagship:

- Rust-native shell;
- hardware-accelerated graph canvas;
- local vault/file browser;
- embedded web/document panes;
- agent workspace panels;
- semantic search;
- timeline scrubbing;
- memory overlays;
- Obsidian import/export bridge.

The Obsidian plugin then becomes one input/output adapter among many.

## Agent handoff

A detailed implementation prompt for build agents lives here:

```text
docs/AGENT_HANDOFF_RUST_BROWSER_CORE.md
```

Use that prompt to start the Rust-native browser/core work. Do not ask agents to keep expanding the TypeScript renderer as the final architecture. Ask them to preserve the TS plugin as an adapter while building the real engine in Rust.

## Development

Current plugin development still uses the original Obsidian plugin workflow.

```bash
npm install
npm run dev
npm run build
```

The Rust-native core should be created as a separate workspace unless this repository is intentionally converted into a monorepo.

## License and attribution

This repository began as a fork/evolution of an Obsidian 3D graph plugin. Preserve upstream attribution where required while evolving the architecture toward the 5D graph/browser system.
