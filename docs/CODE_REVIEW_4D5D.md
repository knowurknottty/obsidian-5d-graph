# 4D/5D Code Review — Findings and Fixes

Full review of the D4 (temporal) / D5 (semantic depth) pipeline, the CAPT
integration, and the rendering hot paths. Every finding below is fixed on this
branch unless marked *(future work)*.

## Why D4/D5 did not work at all

The pipeline was built at both ends but never connected in the middle:

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | Source did not compile: three TS errors in `DimensionControlsView.ts` (`Element` vs `HTMLElement`) meant `npm run build` failed at HEAD. | Blocker | Cast `containerEl.children[1]` to `HTMLElement`. |
| 2 | `DimensionControlsView` emitted `dimension-state-changed`, but **nothing subscribed to it**. Every D4/D5 toggle and slider was a no-op. `ForceGraph.setDimensionState` had no callers. | Blocker | `ForceGraph` now subscribes and routes into `setDimensionState`. |
| 3 | `FallbackRenderer.setDimensions()` was an empty stub, and the `__d4_z_offset` / `__d5_depth` attributes written by `applyDimensionTransforms` were **never read by any renderer**. Transforms were computed and dropped. | Blocker | Renderer now implements D4 as a custom d3 z-positioning force + scrubber visibility, and D5 as node radius scaling (`depthMaxNodeScale`) + depth color. |
| 4 | `refreshGraphData()` applied dimension transforms **before** re-cloning the graph, so the fresh clone immediately discarded them — and discarded all merged CAPT nodes too (`mergeCaptIntoGraph` mutated the old clone). | Blocker | Refresh order is now clone → merge CAPT → transform → hand to renderer. |
| 5 | `CaptDataAdapter.mergedLinks` was declared but **never populated** (`addNeighbor`'s returned `Link` was ignored), so `getLinks()` always returned `[]` — CAPT edges could never render. | Blocker | All three link-producing phases (CIG edges, bubble hubs, CodeGraph imports) collect the created links. |
| 6 | Node-id / meta-key mismatch: CIG nodes were created with id `capt://<name>` but metadata was keyed by `<name>`, so `captMeta.get(node.id)` **never matched** for CIG/ECHO nodes — no colors, no depth, no time data. ECHO augmentation keyed by `wing` also never matched CIG ids. | Blocker | One consistent id scheme (`capt://<concept>`, `bubble://<domain>`, file path); all maps keyed by `Node.id`. |
| 7 | `mergeCaptIntoGraph` pushed nodes/links past the `Graph` indexes (`@ts-ignore` on readonly arrays), so `getNodeById` returned `null` for CAPT nodes → duplicate merges, broken hover/click/local-graph for CAPT nodes. | Major | `Graph.addNode` / `Graph.addLink` maintain the id indexes. |
| 8 | `graph-changed` was subscribed to but **never triggered** — the view never refreshed when the vault changed. | Major | `main.ts` fires it whenever the resolved-link cache rebuilds the global graph. |
| 9 | Snapshot loading used `fetch("file:///tmp/…")`, which Electron blocks; loading a snapshot was impossible from the UI. | Major | Native file picker + vault-root (`capt_5d_snapshot.json`) loader, with structural validation (`CaptDataAdapter.normalizeSnapshot`). |
| 10 | D4/D5 were gated on `captMode`, and vault nodes carried no timestamps, so the "5D graph" required an external CAPT snapshot to do anything. | Major | `Node` now carries `ctimeMs`/`mtimeMs` from `TFile.stat`; D5 for plain vault nodes derives from link/tag topology + recency. D4/D5 work on any vault out of the box. |
| 11 | `timeScrubber`, `timeAxisStrength`, and `depthMaxNodeScale` existed in `DimensionState` but were referenced nowhere. | Major | Scrubber drives node **and link** visibility; strength drives the temporal force; max-scale drives D5 radius. |
| 12 | The force simulation replaces link `source`/`target` strings with node object references, corrupting any later re-merge or index keyed on string ids. | Major | `CaptDataAdapter.getLinks()` returns fresh string-id copies; renderer resolves endpoints defensively. |
| 13 | ECHO augmentation set `sourceType = "echo"` unless already `"hybrid"`, but nothing ever set `"hybrid"` — multi-source nodes were mislabeled. | Minor | CIG+ECHO nodes now become `hybrid`. |
| 14 | `applySettingsChange` matched `display.linkWidth`, but the actual settings path is `display.linkThickness` — the slider did nothing. `particleCount`, group and filter changes weren't handled either. | Minor | Paths fixed; groups/filters invalidate caches and refresh the right channels. |
| 15 | `computeCausalDepth` shared one `visited` set across sibling recursion (undercounting diamond-shaped DAGs) and had no memoization (exponential blowup risk). | Minor | Memoized with a proper cycle-guard stack. |
| 16 | Node labels injected `node.name` into HTML unescaped. | Minor | Escaped. |

## Visual-performance work

| Area | Before | After |
|------|--------|-------|
| Dimension slider changes | Would have required a full `structuredClone` of the graph + `graphData()` reset, restarting the force simulation and camera on every slider tick. | Cheap path: per-node attributes recomputed in place, renderer re-triggers only the affected channels (`nodeVal`/`nodeColor`/visibility); simulation positions and camera preserved. |
| D4 normalization | Min/max over **all** node timestamps recomputed **inside** the per-node loop — O(n²). | Ranges hoisted into a single pre-pass — O(n). |
| Group colors | `NodeGroup.matches` (regex + string ops) ran for every group × every node on **every accessor evaluation** (per hover, per refresh). | Per-node result cached in `groupColorCache`, invalidated on graph swap or group-settings change. |
| Hover highlighting | `getLinksWithNode` scanned the entire link array on every hover. | O(1) adjacency map built once per `setGraph`. |
| Slider event flood | Each `input` event triggered a full pipeline run. | Emits coalesced to one per animation frame (`requestAnimationFrame`). |
| Causal depth | Un-memoized recursion per CIG node. | Memoized across the snapshot. |

## Architecture notes / future work

- **Renderer tiers**: `detectCapabilities()` probes WebGPU/SharedArrayBuffer but
  only the fallback tier exists. The `GraphRenderer` contract is now actually
  exercised end-to-end (`setGraph` → `setDimensions`), which is the seam a
  WorkerGL/WebGPU tier plugs into. *(future work)*
- **`Graph.clone()` uses `structuredClone`** on class instances — prototypes are
  stripped, so cloned nodes are plain objects (only data fields survive). It
  works because post-clone code only touches data fields, but it's fragile and
  the full-vault clone on every refresh is the remaining big allocation. A
  typed-array node store is the right long-term fix. *(future work)*
- **`NodeMetrics.ts`** defines a richer metrics contract (word count,
  frontmatter weight) that the async content-index pass should eventually
  populate; the current vault depth score uses the deterministic subset
  (links, tags, recency). *(future work)*
- **`DimensionControlsView` is opened via `leaf.open(new View(...))`** instead
  of `registerView` + `setViewState`, so Obsidian can't restore it across
  reloads. Same pre-existing pattern as `Graph3dView`. *(future work)*
