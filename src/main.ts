import { Notice, Plugin } from "obsidian";
import { Graph3dView } from "./views/graph/Graph3dView";
import { DimensionControlsView } from "./views/settings/categories/DimensionControlsView";
import GraphSettings from "./settings/GraphSettings";
import State from "./util/State";
import Graph from "./graph/Graph";
import ObsidianTheme from "./util/ObsidianTheme";
import EventBus from "./util/EventBus";
import { ResolvedLinkCache } from "./graph/Link";
import shallowCompare from "./util/ShallowCompare";

export default class Graph3dPlugin extends Plugin {
	_resolvedCache: ResolvedLinkCache;

	// States
	public settingsState: State<GraphSettings>;
	public openFileState: State<string | undefined> = new State(undefined);
	private cacheIsReady: State<boolean> = new State(
		this.app.metadataCache.resolvedLinks !== undefined
	);

	// Other properties
	public globalGraph: Graph;
	public theme: ObsidianTheme;
	// Graphs that are waiting for cache to be ready
	private queuedGraphs: Graph3dView[] = [];
	private callbackUnregisterHandles: (() => void)[] = [];

	async onload() {
		await this.init();
		this.addRibbonIcon("glasses", "5D Graph", this.openGlobalGraph);
		this.addRibbonIcon("brain", "CAPT Dimensions", this.openDimensionControls);
		this.addCommand({
			id: "open-3d-graph-global",
			name: "Open Global 5D Graph",
			callback: this.openGlobalGraph,
		});

		this.addCommand({
			id: "open-3d-graph-local",
			name: "Open Local 5D Graph",
			callback: this.openLocalGraph,
		});

		this.addCommand({
			id: "open-capt-dimensions",
			name: "Open CAPT 5D Dimension Controls",
			callback: this.openDimensionControls,
		});
	}

	private async init() {
		await this.initStates();
		this.initListeners();
	}

	private async initStates() {
		const settings = await this.loadSettings();
		this.settingsState = new State<GraphSettings>(settings);
		this.theme = new ObsidianTheme(this.app.workspace.containerEl);
		this.cacheIsReady.value =
			this.app.metadataCache.resolvedLinks !== undefined;
		this.onGraphCacheChanged();
	}

	private initListeners() {
		this.callbackUnregisterHandles.push(
			this.settingsState.onChange(() => this.saveSettings())
		);

		EventBus.on("do-reset-settings", this.onDoResetSettings);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!file) return;
				menu.addItem((item) => {
					item.setTitle("Open in local 5D Graph")
						.setIcon("glasses")
						.onClick(() => this.openLocalGraph());
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file) this.openFileState.value = file.path;
			})
		);

		this.callbackUnregisterHandles.push(
			this.cacheIsReady.onChange((isReady) => {
				if (isReady) {
					this.openQueuedGraphs();
				}
			})
		);

		this.app.metadataCache.on(
			"resolved",
			this.onGraphCacheReady.bind(this)
		);
		this.app.metadataCache.on(
			"resolve",
			this.onGraphCacheChanged.bind(this)
		);
	}

	private openQueuedGraphs() {
		this.queuedGraphs.forEach((view) => view.showGraph());
		this.queuedGraphs = [];
	}

	private onGraphCacheReady = () => {
		console.log("Graph cache is ready");
		this.cacheIsReady.value = true;
		this.onGraphCacheChanged();
	};

	private onGraphCacheChanged = () => {
		if (
			this.cacheIsReady.value &&
			!shallowCompare(
				this._resolvedCache,
				this.app.metadataCache.resolvedLinks
			)
		) {
			this._resolvedCache = structuredClone(
				this.app.metadataCache.resolvedLinks
			);
			this.globalGraph = Graph.createFromApp(this.app);
		}
	};

	private onDoResetSettings = () => {
		this.settingsState.value.reset();
		EventBus.trigger("did-reset-settings");
	};

	private openDimensionControls = () => {
		const leaf = this.app.workspace.getLeaf("split");
		const view = new DimensionControlsView(this, leaf);
		leaf.open(view);
	};

	private openLocalGraph = () => {
		const newFilePath = this.app.workspace.getActiveFile()?.path;

		if (newFilePath) {
			this.openFileState.value = newFilePath;
			this.openGraph(true);
		} else {
			new Notice("No file is currently open");
		}
	};

	private openGlobalGraph = () => {
		this.openGraph(false);
	};

	private openGraph = (isLocalGraph: boolean) => {
		const leaf = this.app.workspace.getLeaf(isLocalGraph ? "split" : false);
		const graphView = new Graph3dView(this, leaf, isLocalGraph);
		leaf.open(graphView);
		if (this.cacheIsReady.value) {
			graphView.showGraph();
		} else {
			this.queuedGraphs.push(graphView);
		}
	};

	private async loadSettings(): Promise<GraphSettings> {
		const loadedData = await this.loadData(),
			settings = GraphSettings.fromStore(loadedData);
		return settings;
	}

	async saveSettings() {
		await this.saveData(this.settingsState.getRawValue().toObject());
	}

	onunload() {
		super.onunload();
		this.callbackUnregisterHandles.forEach((handle) => handle());
		EventBus.off("do-reset-settings", this.onDoResetSettings);
	}

	public getSettings(): GraphSettings {
		return this.settingsState.value;
	}
}
