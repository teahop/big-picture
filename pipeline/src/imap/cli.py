"""`imap` command line. Each pipeline stage is a subcommand that reads and
writes files, so stages can be re-run alone. Stages are stubs until their phase."""
from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

STAGES: dict[str, str] = {
    "ingest": "Download and normalise public data (Phase 1+)",
    "graph": "Build similarity graphs and bridge edges (Phase 1+)",
    "layout": "Anchored hierarchical layout (Phase 1+)",
    "terrain": "Height grids per layer and size measure (Phase 1+)",
    "export": "Write public/private JSON bundles (Phase 1+)",
    "personal": "Personal overlay from private inputs (Phase 4)",
    "score": "Where-next scoring (Phase 5)",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="imap", description="Industry map pipeline")
    sub = parser.add_subparsers(dest="stage", metavar="STAGE", required=True)
    for name, helptext in STAGES.items():
        sub.add_parser(name, help=helptext, description=helptext)
    return parser


def run_stage(name: str) -> int:
    print(f"imap {name}: not implemented yet ({STAGES[name]})", file=sys.stderr)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return run_stage(args.stage)


if __name__ == "__main__":
    raise SystemExit(main())
