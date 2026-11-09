"""`imap` command line. Each pipeline stage is a subcommand that reads and
writes files, so stages can be re-run alone."""
from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

IMPLEMENTED = {"ingest", "graph", "layout", "terrain", "export"}

STAGES: dict[str, str] = {
    "ingest": "Load public data into tidy tables (subcommand: bls-matrix)",
    "graph": "Build similarity graph and edges",
    "layout": "Seeded layout of node positions (provisional Level 0 in Phase 1)",
    "terrain": "Height grids per layer and size measure",
    "export": "Write the public JSON bundle (--target public)",
    "personal": "Personal overlay from private inputs (Phase 4)",
    "score": "Where-next scoring (Phase 5)",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="imap", description="Industry map pipeline")
    sub = parser.add_subparsers(dest="stage", metavar="STAGE", required=True)
    for name, helptext in STAGES.items():
        p = sub.add_parser(name, help=helptext, description=helptext)
        if name == "ingest":
            p.add_argument("source", choices=["bls-matrix"], help="dataset to ingest")
        if name == "export":
            p.add_argument("--target", choices=["public", "private"], default="public")
    return parser


def run_stage(args: argparse.Namespace) -> int:
    name = args.stage
    if name not in IMPLEMENTED:
        print(f"imap {name}: not implemented yet ({STAGES[name]})", file=sys.stderr)
        return 0
    if name == "ingest":
        from . import bls
        return bls.run()
    if name == "graph":
        from . import graph
        return graph.run()
    if name == "layout":
        from . import layout
        return layout.run()
    if name == "terrain":
        from . import terrain
        return terrain.run()
    from . import export
    return export.run(args.target)


def main(argv: Sequence[str] | None = None) -> int:
    return run_stage(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
