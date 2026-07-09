#!/usr/bin/env python3
"""
CAPT 5D Bridge - Export knowledge graph snapshot for the Obsidian 5D graph plugin.

Exports:
  - CIG causal nodes and edges
  - ECHO traces (sampled from wings)
  - Knowledge Bubble manifests (all 511 domains)
  - CodeGraph topology (if index exists)

Usage:
    cd ~/Biocapt-ecosystem-fullcaptlang/primary/biocapt-desktop
    python3 /Users/knowurknot/obsidian-5d-graph/src/capt/bridge_export.py --output /tmp/capt_5d_snapshot.json
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="CAPT 5D Graph Bridge")
    parser.add_argument("--output", default="/tmp/capt_5d_snapshot.json",
                        help="Output snapshot path")
    parser.add_argument("--data-dir", default=os.path.expanduser("~/.openclaw/capt_symbiote"),
                        help="CAPT data directory")
    args = parser.parse_args()
    
    print("CAPT 5D Bridge - exporting knowledge graph snapshot")
    print(f"  Data dir: {args.data_dir}")
    
    # Path setup for CAPT modules
    ROOT = Path(__file__).resolve().parent.parent.parent.parent / "Biocapt-ecosystem-fullcaptlang" / "primary" / "biocapt-desktop"
    sys.path.insert(0, str(ROOT / "modules"))
    sys.path.insert(0, str(ROOT / "backend" / "biocapt" / "modules"))
    sys.path.insert(0, str(ROOT / "backend" / "biocapt"))
    
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    
    # Initialize CAPT
    try:
        from capt_core import CAPTCore
        capt = CAPTCore(data_dir=args.data_dir)
        print(f"  CAPTCore initialized")
    except Exception as e:
        print(f"  CAPTCore init failed: {e}")
        sys.exit(1)
    
    snapshot = {
        'cig_nodes': [],
        'cig_edges': [],
        'echo_traces': [],
        'bubbles': [],
        'code_nodes': [],
        'timestamp': time.time(),
    }
    
    # Export CIG
    print("\nExporting CIG causal graph...")
    try:
        cig = capt.cig
        if hasattr(cig, '_causal_graph'):
            for name, node_data in cig._causal_graph.items():
                snapshot['cig_nodes'].append({
                    'id': name,
                    'name': name,
                    'evidence': getattr(node_data, 'evidence', 0.5),
                })
        
        if hasattr(cig, '_edges'):
            for edge in cig._edges:
                snapshot['cig_edges'].append({
                    'source': getattr(edge, 'source', ''),
                    'target': getattr(edge, 'target', ''),
                    'strength': getattr(edge, 'strength', 0.5),
                    'mechanism': getattr(edge, 'mechanism', 'unknown'),
                })
        
        print(f"  CIG: {len(snapshot['cig_nodes'])} nodes, {len(snapshot['cig_edges'])} edges")
    except Exception as e:
        print(f"  CIG export error: {e}")
    
    # Export ECHO
    print("\nExporting ECHO traces...")
    try:
        echo = capt.echo
        if hasattr(echo, '_wings'):
            for wing_name, wing in echo._wings.items():
                wing_traces = getattr(wing, 'traces', [])
                sampled = wing_traces[:5]
                for trace in sampled:
                    snapshot['echo_traces'].append({
                        'trace_id': getattr(trace, 'trace_id', ''),
                        'text': getattr(trace, 'text', '')[:200],
                        'wing': wing_name,
                        'salience': getattr(trace, 'salience', 0.5),
                        'timestamp': getattr(trace, 'timestamp', time.time()),
                        'source': getattr(trace, 'source', 'echo'),
                    })
        
        print(f"  ECHO: {len(snapshot['echo_traces'])} traces sampled")
    except Exception as e:
        print(f"  ECHO export error: {e}")
    
    # Export Bubbles
    print("\nExporting Knowledge Bubbles...")
    try:
        bm = capt.bubbles
        if hasattr(bm, '_registry'):
            for domain, manifest in bm._registry.items():
                if hasattr(manifest, '__dict__'):
                    md = manifest.__dict__
                elif isinstance(manifest, dict):
                    md = manifest
                else:
                    continue
                
                snapshot['bubbles'].append({
                    'domain': domain,
                    'version': md.get('version', '1.0.0'),
                    'trace_count': md.get('trace_count', 0),
                    'token_weight': md.get('token_weight', 0.0),
                    'avg_salience': md.get('avg_salience', 0.5),
                    'created_at': md.get('created_at', time.time()),
                })
        
        print(f"  Bubbles: {len(snapshot['bubbles'])} domains")
    except Exception as e:
        print(f"  Bubble export error: {e}")
    
    # Export CodeGraph
    print("\nExporting CodeGraph topology...")
    cg_locations = [
        Path(os.path.expanduser("~/Biocapt-ecosystem-fullcaptlang/.codegraph")),
        ROOT / ".codegraph",
        Path(os.path.expanduser("~/.codegraph")),
    ]
    
    for cg_dir in cg_locations:
        if cg_dir.exists():
            index_file = cg_dir / "index.json"
            if index_file.exists():
                try:
                    data = json.loads(index_file.read_text())
                    for file_info in data.get('files', []):
                        snapshot['code_nodes'].append({
                            'path': file_info.get('path', ''),
                            'language': file_info.get('language', ''),
                            'imports': file_info.get('imports', []),
                            'exports': file_info.get('exports', []),
                            'lineCount': file_info.get('lineCount', 0),
                        })
                    print(f"  CodeGraph: {len(snapshot['code_nodes'])} files from {cg_dir}")
                except Exception as e:
                    print(f"  CodeGraph warning: {e}")
            break
    
    if not snapshot['code_nodes']:
        print("  CodeGraph: no index found, skipping")
    
    # Write snapshot
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, indent=2, default=str))
    
    total_nodes = (
        len(snapshot['cig_nodes']) + 
        len(snapshot['echo_traces']) + 
        len(snapshot['bubbles']) + 
        len(snapshot['code_nodes'])
    )
    
    print(f"\nSnapshot written to {output_path}")
    print(f"Total: {total_nodes} nodes")
    
    # Summary stats
    stats = {
        'cig_nodes': len(snapshot['cig_nodes']),
        'cig_edges': len(snapshot['cig_edges']),
        'echo_traces': len(snapshot['echo_traces']),
        'bubbles': len(snapshot['bubbles']),
        'code_nodes': len(snapshot['code_nodes']),
        'total_nodes': total_nodes,
        'timestamp': snapshot['timestamp'],
    }
    print(f"\n{json.dumps(stats, indent=2)}")


if __name__ == "__main__":
    main()
