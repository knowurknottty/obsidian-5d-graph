# CAPT 5D Graph

The first-ever 5-dimensional knowledge graph — unifying Obsidian's spatial graph with CAPT's cognitive architecture.

## Dimensions

| Dim | Name | Source | What It Shows |
|-----|------|--------|---------------|
| D1 | Spatial X | force-directed | Node clustering by link topology |
| D2 | Spatial Y | force-directed | Node clustering by link topology |
| D3 | Spatial Z | force-directed | Depth layering |
| D4 | Temporal | CIG events + file timestamps | Node age, modification frequency, causal event timing |
| D5 | Semantic Depth | CIG + ECHO + Bubbles + CodeGraph | Knowledge layer count, causal strength, resonance magnitude |

## Knowledge Sources

The graph merges 4 CAPT knowledge systems into a single unified visualization:

### CIG (Causal Inference Graph)
- Nodes: causal concepts with evidence scores
- Edges: directed causal relationships with strength and mechanism
- D5 contribution: causal depth (hops from root causes)

### ECHO (Episodic Memory)
- Nodes: memory traces organized by wing (domain)
- D5 contribution: salience scores, temporal freshness
- D4 contribution: trace timestamps

### Knowledge Bubbles
- Hub nodes: one per domain (511 domains)
- Size proportional to trace count
- D5 contribution: token weight (0-1)

### CodeGraph
- Nodes: source files with language, imports, exports
- Edges: import/export relationships
- D5 contribution: code topology depth

## Architecture

```
src/
  capt/
    CaptDataAdapter.ts     -- Merges CIG/ECHO/Bubbles/CodeGraph into unified graph
    capt_5d_bridge.py      -- Python bridge: exports CAPT snapshot to JSON
  dimensions/
    DimensionState.ts      -- D4/D5 state contract
  graph/
    Graph.ts               -- Core graph data structure
    Node.ts                -- Node with neighbors, links, tags
    NodeMetrics.ts         -- D4/D5 deterministic metrics
  renderer/
    FallbackRenderer.ts    -- 3d-force-graph backend (D4/D5 transforms applied)
    GraphRenderer.ts       -- Renderer interface
    RendererCapabilities.ts -- Runtime capability detection
  views/
    graph/
      ForceGraph.ts        -- 5D orchestrator (CAPT integration + dimension transforms)
      Graph3dView.ts       -- Obsidian ItemView wrapper
    settings/
      categories/
        DimensionControlsView.ts  -- D4/D5 control panel UI
```

## Node Color Coding

| Color | Source |
|-------|--------|
| Red `#ff6b6b` | CIG (Causal Inference) |
| Teal `#4ecdc4` | ECHO (Episodic Memory) |
| Blue `#45b7d1` | Knowledge Bubbles |
| Green `#96ceb4` | CodeGraph (Code Topology) |
| Plum `#dda0dd` | Hybrid (multi-source) |
| Gray `#888888` | Obsidian vanilla |

When D5 depth is enabled, colors shift: deep nodes -> purple, shallow nodes -> yellow.

## Usage

### In Obsidian
1. Install the plugin (copy `main.js`, `manifest.json`, `styles.css` to vault)
2. Click the glasses icon or run "Open Global 5D Graph"
3. Click the brain icon or run "Open CAPT 5D Dimension Controls"
4. Load a CAPT snapshot via the controls panel

### CAPT Bridge Script
```bash
cd ~/Biocapt-ecosystem-fullcaptlang/primary/biocapt-desktop
python3 src/capt/capt_5d_bridge.py --output /tmp/capt_5d_snapshot.json
```

This exports:
- CIG causal nodes and edges
- ECHO traces (capped at 50 per wing)
- Knowledge bubble manifests (511 domains)
- CodeGraph file topology

### Dimension Controls
- **D4 Time Axis**: Toggle on, then scrub through time to see nodes appear/disappear by age
- **D5 Semantic Depth**: Toggle on, adjust alpha/beta/gamma weights to emphasize causal depth, knowledge layers, or resonance

## Build

```bash
cd obsidian-5d-graph
npm install
npm run build
```

Output: `main.js` (1.2MB bundled)

## Files

- `main.js` — Bundled plugin (copy to vault)
- `manifest.json` — Obsidian plugin manifest
- `styles.css` — Plugin styles including 5D controls

## What Makes This the First 5D Graph

No existing graph visualization combines:
1. **Spatial layout** (force-directed 3D)
2. **Temporal dimension** (node age + causal event timing)
3. **Semantic depth** (multi-source knowledge layer scoring)
4. **Causal inference** (directed edges with strength/mechanism)
5. **Knowledge fusion** (4 distinct knowledge systems in one view)

The 5 dimensions are not just visual axes — they represent fundamentally different types of knowledge relationships:
- D1-D3: "What is connected to what?"
- D4: "When did this matter?"
- D5: "How deep/well-supported is this knowledge?"
