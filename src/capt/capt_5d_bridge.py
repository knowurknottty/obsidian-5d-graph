#!/usr/bin/env python3
"""
Python to TypeScript bridge script.

Runs inside the CAPT Python environment to export a unified snapshot
of all knowledge systems for the 5D graph plugin.

Usage:
    cd ~/Biocapt-ecosystem-fullcaptlang/primary/biocapt-desktop
    python3 src/capt/capt_5d_bridge.py --output /tmp/capt_5d_snapshot.json

Produces a CaptSnapshot JSON file that the Obsidian plugin loads.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Path setup
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "modules"))
sys.path.insert(0, str(ROOT / "backend" / "biocapt" / "modules"))
sys.path.insert(0, str(ROOT / "backend" / "biocapt"))

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")


def export_cig_data(capt) -> Tuple[List[Dict], List[Dict]]:
    """Extract CIG causal nodes and edges."""
    nodes = []
    edges = []

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
                        "source": n["name"],
                        "target": child,
                        "strength": 0.5,
                        "mechanism": "causes",
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
                if hasattr(manifest, "__dict__"):
                    md = manifest.__dict__
                elif isinstance(manifest, dict):
                    md = manifest
                else:
                    continue

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


def export_codegraph_data() -> List[Dict]:
    """Extract CodeGraph topology if available."""
    nodes = []

    cg_index = ROOT / ".codegraph" / "index.json"
    if cg_index.exists():
        try:
            data = json.loads(cg_index.read_text())
            for file_info in data.get("files", []):
                nodes.append({
                    "path": file_info.get("path", ""),
                    "language": file_info.get("language", ""),
                    "imports": file_info.get("imports", []),
                    "exports": file_info.get("exports", []),
                    "lineCount": file_info.get("lineCount", 0),
                })
        except Exception as e:
            print(f"  CodeGraph export warning: {e}")

    return nodes


def main():
    import argparse

    parser = argparse.ArgumentParser(description="CAPT 5D Graph Bridge")
    parser.add_argument("--output", default="/tmp/capt_5d_snapshot.json",
                        help="Output snapshot path")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/.openclaw/capt_symbiote"),
                        help="CAPT data directory")
    args = parser.parse_args()

    print("CAPT 5D Bridge - exporting knowledge graph snapshot")

    try:
        from capt_core import CAPTCore
        capt = CAPTCore(data_dir=args.data_dir)
        print(f"  CAPTCore initialized (data_dir={args.data_dir})")
    except Exception as e:
        print(f"  CAPTCore init failed: {e}")
        print("  Falling back to static export mode")
        capt = None

    snapshot = {
        "cig_nodes": [],
        "cig_edges": [],
        "echo_traces": [],
        "bubbles": [],
        "code_nodes": [],
        "timestamp": time.time(),
    }

    if capt:
        print("  Exporting CIG causal graph...")
        snapshot["cig_nodes"], snapshot["cig_edges"] = export_cig_data(capt)
        print(f"    {len(snapshot['cig_nodes'])} nodes, {len(snapshot['cig_edges'])} edges")

        print("  Exporting ECHO traces...")
        snapshot["echo_traces"] = export_echo_data(capt)
        print(f"    {len(snapshot['echo_traces'])} traces")

        print("  Exporting Knowledge Bubbles...")
        snapshot["bubbles"] = export_bubble_data(capt)
        print(f"    {len(snapshot['bubbles'])} bubbles")

    print("  Exporting CodeGraph topology...")
    snapshot["code_nodes"] = export_codegraph_data()
    print(f"    {len(snapshot['code_nodes'])} files")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"\n  Snapshot written to {output_path}")
    print(f"  Total: {len(snapshot['cig_nodes']) + len(snapshot['echo_traces']) + len(snapshot['bubbles']) + len(snapshot['code_nodes'])} nodes")

    stats = {
        "cig_nodes": len(snapshot["cig_nodes"]),
        "cig_edges": len(snapshot["cig_edges"]),
        "echo_traces": len(snapshot["echo_traces"]),
        "bubbles": len(snapshot["bubbles"]),
        "code_nodes": len(snapshot["code_nodes"]),
        "total_nodes": len(snapshot["cig_nodes"]) + len(snapshot["echo_traces"]) + len(snapshot["bubbles"]) + len(snapshot["code_nodes"]),
        "timestamp": snapshot["timestamp"],
    }
    print(f"\n{json.dumps(stats, indent=2)}")


if __name__ == "__main__":
    main()
