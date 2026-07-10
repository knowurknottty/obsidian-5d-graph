#!/usr/bin/env python3
"""
CAPT 5D Graph Bridge — Python → TypeScript snapshot exporter.

Exports a unified JSON snapshot of CAPT knowledge systems (CIG, ECHO,
Knowledge Bubbles, CodeGraph) for the Obsidian 5D graph plugin.

Works in two modes:
  1. LIVE — imports CAPTCore from the bioCAPT ecosystem (full data)
  2. STANDALONE — reads .openclaw data files directly (no CAPTCore needed)

Usage:
    # From obsidian-5d-graph repo:
    python3 src/capt/capt_5d_bridge.py

    # From anywhere (auto-discovers CAPT ecosystem):
    python3 capt_5d_bridge.py --output /tmp/capt_5d_snapshot.json

    # Explicit paths:
    python3 capt_5d_bridge.py --data-dir ~/.openclaw/capt_symbiote \
                               --vault ~/ObsidianVault

Produces: /tmp/capt_5d_snapshot.json (CaptSnapshot format)
"""

import json
import os
import sys
import time
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

# ── Path setup ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent  # obsidian-5d-graph root

# Try bioCAPT ecosystem paths (for LIVE mode)
BIOCAPT_PATHS = [
    Path.home() / "Biocapt-ecosystem-fullcaptlang" / "primary" / "biocapt-desktop",
    Path.home() / "Biocapt-ecosystem-fullcaptlang",
    Path.home() / "biocapt-ecosystem",
    REPO_ROOT,
]

for p in BIOCAPT_PATHS:
    if (p / "modules").is_dir() and str(p / "modules") not in sys.path:
        sys.path.insert(0, str(p / "modules"))
    if (p / "backend" / "biocapt" / "modules").is_dir():
        bp = str(p / "backend" / "biocapt" / "modules")
        if bp not in sys.path:
            sys.path.insert(0, bp)

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")


# ── LIVE mode: CAPTCore ─────────────────────────────────────────────

def export_cig_data(capt) -> Tuple[List[Dict], List[Dict]]:
    """Extract CIG causal nodes and edges."""
    nodes, edges = [], []
    try:
        cig = capt.cig
        if hasattr(cig, "_causal_graph"):
            for name, node in cig._causal_graph.items():
                nodes.append({
                    "name": name,
                    "evidence": getattr(node, "evidence", 0.5),
                    "parents": list(getattr(node, "parents", [])),
                    "children": list(getattr(node, "children", [])),
                    "wing": getattr(node, "wing", ""),
                    "salience": getattr(node, "salience", 0.5),
                })
        if hasattr(cig, "_edges"):
            for edge in cig._edges:
                edges.append({
                    "source": getattr(edge, "source", ""),
                    "target": getattr(edge, "target", ""),
                    "strength": getattr(edge, "strength", 0.5),
                    "mechanism": getattr(edge, "mechanism", "unknown"),
                })
        if not edges:
            for n in nodes:
                for child in n["children"]:
                    edges.append({
                        "source": n["name"], "target": child,
                        "strength": 0.5, "mechanism": "causes",
                    })
    except Exception as e:
        print(f"  CIG export warning: {e}")
    return nodes, edges


def export_echo_data(capt) -> List[Dict]:
    """Extract ECHO traces from all wings."""
    traces = []
    try:
        echo = capt.echo
        if hasattr(echo, "_wings"):
            for wing_name, wing_data in echo._wings.items():
                if hasattr(wing_data, "traces"):
                    for trace in wing_data.traces[:50]:
                        traces.append({
                            "trace_id": getattr(trace, "trace_id", ""),
                            "text": getattr(trace, "text", "")[:200],
                            "wing": wing_name,
                            "salience": getattr(trace, "salience", 0.5),
                            "timestamp": getattr(trace, "timestamp", time.time()),
                            "source": getattr(trace, "source", "echo"),
                        })
    except Exception as e:
        print(f"  ECHO export warning: {e}")
    return traces


def export_bubble_data(capt) -> List[Dict]:
    """Extract knowledge bubble manifests."""
    bubbles = []
    try:
        bm = capt.bubbles
        if hasattr(bm, "_registry"):
            for domain, manifest in bm._registry.items():
                md = manifest.__dict__ if hasattr(manifest, "__dict__") else (manifest if isinstance(manifest, dict) else {})
                bubbles.append({
                    "domain": domain,
                    "version": md.get("version", "1.0.0"),
                    "trace_count": md.get("trace_count", 0),
                    "token_weight": md.get("token_weight", 0.0),
                    "avg_salience": md.get("avg_salience", 0.5),
                    "created_at": md.get("created_at", time.time()),
                })
    except Exception as e:
        print(f"  Bubble export warning: {e}")
    return bubbles


# ── STANDALONE mode: read from disk ─────────────────────────────────

def standalone_read_bubbles(data_dir: Path) -> List[Dict]:
    """Read bubble manifests from gzip-compressed .bubble files."""
    bubbles = []
    bubbles_dir = data_dir / "bubbles"
    if not bubbles_dir.exists():
        print(f"  Bubbles dir not found: {bubbles_dir}")
        return bubbles

    import gzip

    bubble_files = sorted(bubbles_dir.glob("*.bubble"))[:200]  # cap at 200
    for bf in bubble_files:
        try:
            with gzip.open(str(bf), "rt", encoding="utf-8") as f:
                data = json.load(f)
            manifest = data.get("manifest", {})
            domain = manifest.get("domain", bf.stem.split("_v")[0])
            if not domain:
                continue
            bubbles.append({
                "domain": domain,
                "version": manifest.get("version", "1.0.0"),
                "trace_count": manifest.get("trace_count", 0),
                "token_weight": manifest.get("token_weight", 0.0),
                "avg_salience": manifest.get("avg_salience", 0.5),
                "created_at": manifest.get("created_at", time.time()),
            })
        except Exception:
            pass  # skip corrupt files

    print(f"  Read {len(bubbles)} bubbles from {len(bubble_files)} .bubble files")
    return bubbles


def standalone_read_echo(data_dir: Path) -> List[Dict]:
    """Read ECHO traces from echo_graph.db."""
    traces = []
    echo_db = data_dir / "echo_graph.db"
    if not echo_db.exists():
        print(f"  ECHO DB not found: {echo_db}")
        return traces

    try:
        conn = sqlite3.connect(str(echo_db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT trace_id, text, wing, source, salience, created_at "
            "FROM traces ORDER BY salience DESC LIMIT 300"
        ).fetchall()
        for r in rows:
            traces.append({
                "trace_id": r["trace_id"] or "",
                "text": (r["text"] or "")[:200],
                "wing": r["wing"] or "unknown",
                "salience": r["salience"] if r["salience"] else 0.5,
                "timestamp": r["created_at"] if r["created_at"] else time.time(),
                "source": r["source"] or "echo",
            })
        conn.close()
        print(f"  Read {len(traces)} ECHO traces from echo_graph.db")
    except Exception as e:
        print(f"  ECHO DB read warning: {e}")

    return traces


def standalone_read_cig(data_dir: Path) -> Tuple[List[Dict], List[Dict]]:
    """Read CIG data from JSON export if available, else empty."""
    nodes, edges = [], []
    cig_file = data_dir / "cig" / "causal_graph.json"
    if not cig_file.exists():
        return nodes, edges

    try:
        raw = json.loads(cig_file.read_text(encoding="utf-8"))
        for n in raw.get("nodes", []):
            nodes.append({
                "name": n.get("name", ""),
                "evidence": n.get("evidence", 0.5),
                "parents": n.get("parents", []),
                "children": n.get("children", []),
                "wing": n.get("wing", ""),
                "salience": n.get("salience", 0.5),
            })
        for e in raw.get("edges", []):
            edges.append({
                "source": e.get("source", ""),
                "target": e.get("target", ""),
                "strength": e.get("strength", 0.5),
                "mechanism": e.get("mechanism", "unknown"),
            })
        print(f"  Read {len(nodes)} CIG nodes, {len(edges)} edges")
    except Exception as e:
        print(f"  CIG read warning: {e}")

    return nodes, edges


def standalone_read_codegraph(repo_root: Optional[Path] = None) -> List[Dict]:
    """Read CodeGraph topology from SQLite or index.json."""
    nodes = []

    # Try SQLite first
    codegraph_db = None
    if repo_root:
        codegraph_db = repo_root.parent / ".codegraph" / "codegraph.db"
        if not codegraph_db.exists():
            codegraph_db = repo_root / ".codegraph" / "codegraph.db"

    if codegraph_db and codegraph_db.exists():
        try:
            conn = sqlite3.connect(str(codegraph_db))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT path, language, "
                "(SELECT COUNT(*) FROM edges WHERE source=n.id) as import_count, "
                "(SELECT COUNT(*) FROM edges WHERE target=n.id) as export_count "
                "FROM nodes n WHERE kind='file' LIMIT 100"
            ).fetchall()
            for r in rows:
                nodes.append({
                    "path": r["path"] or "",
                    "language": r["language"] or "",
                    "imports": [],
                    "exports": [],
                    "lineCount": 0,
                })
            conn.close()
            print(f"  Read {len(nodes)} CodeGraph files from codegraph.db")
        except Exception as e:
            print(f"  CodeGraph DB warning: {e}")
        return nodes

    # Fallback: index.json
    cg_index = None
    if repo_root:
        for candidate in [repo_root.parent / ".codegraph" / "index.json",
                          repo_root / ".codegraph" / "index.json"]:
            if candidate.exists():
                cg_index = candidate
                break

    if cg_index and cg_index.exists():
        try:
            data = json.loads(cg_index.read_text())
            for fi in data.get("files", []):
                nodes.append({
                    "path": fi.get("path", ""),
                    "language": fi.get("language", ""),
                    "imports": fi.get("imports", []),
                    "exports": fi.get("exports", []),
                    "lineCount": fi.get("lineCount", 0),
                })
            print(f"  Read {len(nodes)} CodeGraph files from index.json")
        except Exception as e:
            print(f"  CodeGraph index warning: {e}")

    return nodes


# ── Main ─────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="CAPT 5D Graph Bridge")
    parser.add_argument("--output", default="/tmp/capt_5d_snapshot.json",
                        help="Output snapshot path")
    parser.add_argument("--data-dir",
                        default=os.path.expanduser("~/.openclaw/capt_symbiote"),
                        help="CAPT data directory")
    parser.add_argument("--vault", default=os.path.expanduser("~/ObsidianVault"),
                        help="Obsidian vault root (for CodeGraph discovery)")
    parser.add_argument("--mode", choices=["auto", "live", "standalone"],
                        default="auto",
                        help="Force live (CAPTCore) or standalone mode")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    vault = Path(args.vault)
    mode = args.mode

    print("CAPT 5D Bridge — exporting knowledge graph snapshot")
    print(f"  data-dir: {data_dir}")
    print(f"  mode: {mode}")

    # ── Try LIVE mode first ──
    capt = None
    if mode in ("auto", "live"):
        try:
            from capt_core import CAPTCore
            capt = CAPTCore(data_dir=str(data_dir))
            print(f"  CAPTCore initialized (LIVE mode)")
        except Exception as e:
            if mode == "live":
                print(f"  CAPTCore init FAILED: {e}")
                sys.exit(1)
            print(f"  CAPTCore unavailable ({e})")
            print("  Falling back to STANDALONE mode")

    # ── Build snapshot ──
    snapshot = {
        "cig_nodes": [],
        "cig_edges": [],
        "echo_traces": [],
        "bubbles": [],
        "code_nodes": [],
        "timestamp": time.time(),
    }

    if capt:
        # LIVE mode
        print("  Exporting CIG causal graph...")
        snapshot["cig_nodes"], snapshot["cig_edges"] = export_cig_data(capt)
        print(f"    {len(snapshot['cig_nodes'])} nodes, {len(snapshot['cig_edges'])} edges")

        print("  Exporting ECHO traces...")
        snapshot["echo_traces"] = export_echo_data(capt)
        print(f"    {len(snapshot['echo_traces'])} traces")

        print("  Exporting Knowledge Bubbles...")
        snapshot["bubbles"] = export_bubble_data(capt)
        print(f"    {len(snapshot['bubbles'])} bubbles")
    else:
        # STANDALONE mode
        print("  Reading Knowledge Bubbles...")
        snapshot["bubbles"] = standalone_read_bubbles(data_dir)
        print(f"    {len(snapshot['bubbles'])} bubbles")

        print("  Reading ECHO traces...")
        snapshot["echo_traces"] = standalone_read_echo(data_dir)
        print(f"    {len(snapshot['echo_traces'])} traces")

        print("  Reading CIG causal graph...")
        snapshot["cig_nodes"], snapshot["cig_edges"] = standalone_read_cig(data_dir)
        print(f"    {len(snapshot['cig_nodes'])} nodes, {len(snapshot['cig_edges'])} edges")

    # CodeGraph (works in both modes)
    print("  Reading CodeGraph topology...")
    repo_root = vault if vault.exists() else REPO_ROOT
    snapshot["code_nodes"] = standalone_read_codegraph(repo_root)
    print(f"    {len(snapshot['code_nodes'])} files")

    # ── Write output ──
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"\n  Snapshot written to {output_path}")

    total = (len(snapshot["cig_nodes"]) + len(snapshot["echo_traces"])
             + len(snapshot["bubbles"]) + len(snapshot["code_nodes"]))
    print(f"  Total: {total} knowledge nodes")
    print(f"  Mode: {'LIVE (CAPTCore)' if capt else 'STANDALONE'}")

    stats = {
        "cig_nodes": len(snapshot["cig_nodes"]),
        "cig_edges": len(snapshot["cig_edges"]),
        "echo_traces": len(snapshot["echo_traces"]),
        "bubbles": len(snapshot["bubbles"]),
        "code_nodes": len(snapshot["code_nodes"]),
        "total_nodes": total,
        "timestamp": snapshot["timestamp"],
        "mode": "live" if capt else "standalone",
    }
    print(f"\n{json.dumps(stats, indent=2)}")


if __name__ == "__main__":
    main()
