import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import Graph3dPlugin from "src/main";
import { DEFAULT_DIMENSION_STATE, DimensionState } from "../../../dimensions/DimensionState";
import EventBus from "../../../util/EventBus";

/**
 * 5D Dimension Controls Panel.
 *
 * Provides sliders and toggles for all 5 dimensions:
 *   D1/D2/D3 — Spatial (handled by 3d-force-graph, not controlled here)
 *   D4 — Temporal axis (time scrubber, z-range, strength)
 *   D5 — Semantic Depth (alpha/beta/gamma weights, max node scale)
 *
 * Also displays CAPT knowledge graph stats and snapshot loader.
 */
export class DimensionControlsView extends ItemView {
  private plugin: Graph3dPlugin;
  private dimState: DimensionState = { ...DEFAULT_DIMENSION_STATE };
  private statsEl: HTMLElement | null = null;

  constructor(plugin: Graph3dPlugin, leaf: WorkspaceLeaf) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return "5d-dimension-controls";
  }

  getDisplayText(): string {
    return "5D Dimensions";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("capt-5d-controls");

    // Header
    const header = container.createEl("div", { cls: "capt-5d-header" });
    header.createEl("h3", { text: "CAPT 5D Graph", cls: "capt-5d-title" });
    header.createEl("p", {
      text: "Causal x Episodic x Temporal x Semantic x Spatial",
      cls: "capt-5d-subtitle",
    });

    // CAPT Status
    this.statsEl = container.createEl("div", { cls: "capt-5d-stats" });
    this.updateStats();

    // Snapshot loader
    const loaderSection = container.createEl("div", { cls: "capt-5d-section" });
    loaderSection.createEl("h4", { text: "Knowledge Snapshot" });

    const loadBtn = loaderSection.createEl("button", {
      text: "Load CAPT Snapshot",
      cls: "capt-5d-btn",
    });
    loadBtn.addEventListener("click", () => this.loadSnapshot());

    // D4 — Temporal Controls
    this.createD4Section(container);

    // D5 — Semantic Depth Controls
    this.createD5Section(container);

    // Legend
    this.createLegend(container);
  }

  private createD4Section(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "capt-5d-section" });
    section.createEl("h4", { text: "D4: Temporal Axis" });

    // Enable toggle
    const toggleRow = section.createEl("div", { cls: "capt-5d-row" });
    toggleRow.createEl("label", { text: "Enable Time Axis" });
    const toggle = toggleRow.createEl("input", { type: "checkbox" });
    toggle.checked = this.dimState.enableTimeAxis;
    toggle.addEventListener("change", () => {
      this.dimState.enableTimeAxis = toggle.checked;
      this.emitDimensionChange();
    });

    // Time scrubber
    this.createSlider(section, "Time Scrubber", 0, 1, this.dimState.timeScrubber, (v) => {
      this.dimState.timeScrubber = v;
      this.emitDimensionChange();
    });

    // Z-range
    this.createSlider(section, "Time Z-Range", 0, 1000, this.dimState.timeAxisZRange, (v) => {
      this.dimState.timeAxisZRange = v;
      this.emitDimensionChange();
    }, 10);

    // Strength
    this.createSlider(section, "Time Strength", 0, 0.5, this.dimState.timeAxisStrength, (v) => {
      this.dimState.timeAxisStrength = v;
      this.emitDimensionChange();
    }, 0.01);
  }

  private createD5Section(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "capt-5d-section" });
    section.createEl("h4", { text: "D5: Semantic Depth" });

    // Enable toggle
    const toggleRow = section.createEl("div", { cls: "capt-5d-row" });
    toggleRow.createEl("label", { text: "Enable Depth Axis" });
    const toggle = toggleRow.createEl("input", { type: "checkbox" });
    toggle.checked = this.dimState.enableDepthAxis;
    toggle.addEventListener("change", () => {
      this.dimState.enableDepthAxis = toggle.checked;
      this.emitDimensionChange();
    });

    // Alpha (causal depth weight)
    this.createSlider(section, "Alpha (Causal)", 0, 1, this.dimState.depthAlpha, (v) => {
      this.dimState.depthAlpha = v;
      this.emitDimensionChange();
    }, 0.05);

    // Beta (knowledge layers weight)
    this.createSlider(section, "Beta (Layers)", 0, 1, this.dimState.depthBeta, (v) => {
      this.dimState.depthBeta = v;
      this.emitDimensionChange();
    }, 0.05);

    // Gamma (resonance/token weight)
    this.createSlider(section, "Gamma (Resonance)", 0, 1, this.dimState.depthGamma, (v) => {
      this.dimState.depthGamma = v;
      this.emitDimensionChange();
    }, 0.05);

    // Max node scale
    this.createSlider(section, "Max Node Scale", 1, 10, this.dimState.depthMaxNodeScale, (v) => {
      this.dimState.depthMaxNodeScale = v;
      this.emitDimensionChange();
    }, 0.5);
  }

  private createSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    value: number,
    onChange: (v: number) => void,
    step?: number
  ): void {
    const row = parent.createEl("div", { cls: "capt-5d-row" });
    const labelEl = row.createEl("label", { text: label });
    const valueEl = row.createEl("span", {
      text: value.toFixed(2),
      cls: "capt-5d-value",
    });

    const slider = row.createEl("input", {
      type: "range",
      attr: {
        min: String(min),
        max: String(max),
        value: String(value),
        step: step ? String(step) : "0.01",
      },
    });

    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      valueEl.textContent = v.toFixed(2);
      onChange(v);
    });
  }

  private createLegend(parent: HTMLElement): void {
    const section = parent.createEl("div", { cls: "capt-5d-section" });
    section.createEl("h4", { text: "Node Source Legend" });

    const sources = [
      { color: "#ff6b6b", label: "CIG (Causal Inference)" },
      { color: "#4ecdc4", label: "ECHO (Episodic Memory)" },
      { color: "#45b7d1", label: "Knowledge Bubbles" },
      { color: "#96ceb4", label: "CodeGraph (Code Topology)" },
      { color: "#dda0dd", label: "Hybrid (Multi-source)" },
      { color: "#888888", label: "Obsidian (Vanilla)" },
    ];

    for (const s of sources) {
      const row = section.createEl("div", { cls: "capt-5d-legend-row" });
      const dot = row.createEl("span", { cls: "capt-5d-legend-dot" });
      dot.style.backgroundColor = s.color;
      row.createEl("span", { text: s.label });
    }
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const snapshotPath = "/tmp/capt_5d_snapshot.json";
      new Notice("Loading CAPT knowledge snapshot...");

      // Use Node.js fs to read the local file (Obsidian runs in Electron)
      const fs = require("fs");
      if (fs.existsSync(snapshotPath)) {
        const raw = fs.readFileSync(snapshotPath, "utf-8");
        const snapshot = JSON.parse(raw);
        EventBus.trigger("capt-snapshot-loaded", snapshot);
        new Notice("CAPT snapshot loaded successfully!");
        this.updateStats();
      } else {
        new Notice("No CAPT snapshot found. Run the bridge script first.");
      }
    } catch (e) {
      new Notice(`Failed to load snapshot: ${e}`);
    }
  }

  private updateStats(): void {
    if (!this.statsEl) return;

    this.statsEl.empty();

    const row1 = this.statsEl.createEl("div", { cls: "capt-5d-stat" });
    row1.createEl("span", { text: "D4 Time:" });
    row1.createEl("span", { text: this.dimState.enableTimeAxis ? "ON" : "OFF" });

    const row2 = this.statsEl.createEl("div", { cls: "capt-5d-stat" });
    row2.createEl("span", { text: "D5 Depth:" });
    row2.createEl("span", { text: this.dimState.enableDepthAxis ? "ON" : "OFF" });
  }

  private emitDimensionChange(): void {
    EventBus.trigger("dimension-state-changed", this.dimState);
    this.updateStats();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
