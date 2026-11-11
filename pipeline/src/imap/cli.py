"""`imap` command line. Each pipeline stage is a subcommand that reads and
writes files, so stages can be re-run alone."""
from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

IMPLEMENTED = {"ingest", "levels", "deep", "value", "personal", "graph", "layout", "terrain", "export"}

STAGES: dict[str, str] = {
    "ingest": "Load public data into tidy tables (subcommand: bls-matrix)",
    "levels": "Build Level 1 and Level 2 node tables",
    "deep": "Build Level 2 deep: industry nodes from the reviewed categories",
    "value": "Industry value added in dollars (BEA), allocated to the map nodes",
    "graph": "Industry similarity graphs and edges (Level 0, then Level 1 when node tables exist)",
    "layout": "Industry layout at every level (shared occupations and text)",
    "terrain": "Height grids per level and size setting",
    "export": "Write the public JSON bundle (--target public)",
    "personal": "Private footprint from personal inputs (parts: roles, connections, education, footprint)",
}


def build_parser() -> argparse.ArgumentParser:
    from .common import load_site
    site = load_site()
    parser = argparse.ArgumentParser(prog="imap", description=f"{site['display_name']} ({site['subtitle']}): data pipeline")
    sub = parser.add_subparsers(dest="stage", metavar="STAGE", required=True)
    for name, helptext in STAGES.items():
        p = sub.add_parser(name, help=helptext, description=helptext)
        if name == "ingest":
            p.add_argument("source", choices=["bls-matrix", "qcew", "bea", "cip-soc", "onet"], help="dataset to ingest")
        if name == "personal":
            p.add_argument("part", choices=["roles", "connections", "education", "footprint", "all"], help="which personal stage to run")
        if name == "export":
            p.add_argument("--target", choices=["public", "private"], default="public")
    return parser


def run_stage(args: argparse.Namespace) -> int:
    name = args.stage
    if name not in IMPLEMENTED:
        print(f"imap {name}: not implemented yet ({STAGES[name]})", file=sys.stderr)
        return 0
    if name == "ingest":
        if args.source == "bls-matrix":
            from . import bls
            return bls.run()
        if args.source == "bea":
            from . import bea
            return bea.fetch()
        if args.source == "qcew":
            from . import qcew
            return qcew.download_qcew()
        from . import ingest_files
        return ingest_files.run(args.source)
    if name == "personal":
        from .personal import run_part
        return run_part(args.part)
    if name == "value":
        from . import bea
        return bea.run()
    if name == "deep":
        from . import deep_industry
        return deep_industry.run()
    if name == "graph":
        from . import graph
        graph.run()
        from .common import interim_dir
        if (interim_dir() / "levels" / "industry_l1.csv").exists():
            from . import graph_l1
            return graph_l1.run()
        return 0
    if name == "levels":
        from . import levels
        return levels.run()
    if name == "layout":
        from . import layout_joint
        return layout_joint.run()
    if name == "terrain":
        from . import terrain
        return terrain.run()
    from . import export
    return export.run(args.target)


def main(argv: Sequence[str] | None = None) -> int:
    return run_stage(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
