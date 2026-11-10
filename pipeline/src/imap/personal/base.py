"""Shared helpers for the personal overlay. Inputs come from `Personal Data/`, outputs go to `private/`
(both git-ignored). Nothing in this package may write to a tracked path."""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from ..common import public_dir, repo_root


def personal_root() -> Path:
    return Path(os.environ.get("IMAP_PERSONAL_DIR") or repo_root() / "Personal Data")


def private_dir() -> Path:
    p = Path(os.environ.get("IMAP_PRIVATE_DIR") or repo_root() / "private")
    p.mkdir(parents=True, exist_ok=True)
    return p


def load_profile() -> dict:
    local = private_dir() / "profile.local.yaml"
    path = local if local.exists() else repo_root() / "config" / "profile.example.yaml"
    return yaml.safe_load(path.read_text())


def softmax(x: np.ndarray, temperature: float) -> np.ndarray:
    z = (np.asarray(x, float) - np.max(x)) / temperature
    e = np.exp(z)
    return e / e.sum()


def top_shares(sim: np.ndarray, k: int = 3, temperature: float = 0.04) -> list[tuple[int, float]]:
    """Indices and shares (summing to 1) of the k most similar candidates."""
    idx = np.argsort(-sim, kind="stable")[:k]
    w = softmax(sim[idx], temperature)
    return [(int(i), float(s)) for i, s in zip(idx, w)]


class NodeTable:
    """All published nodes with hierarchy and text, as the overlay sees them."""

    def __init__(self) -> None:
        d = public_dir()
        rows = []
        for f in ("nodes.json", "nodes_l1.json", "nodes_l2.json"):
            rows += json.loads((d / f).read_text())
        self.df = pd.DataFrame(rows).set_index("id", drop=False)
        self.df["replaces"] = self.df["replaces"].apply(lambda v: v if isinstance(v, list) else [])
        self.xy = {r.id: tuple(r.xy) for r in self.df.itertuples()}

    def finest(self, type_: str) -> pd.DataFrame:
        """Nodes drawn at the deepest level of detail (children replace their parent)."""
        df = self.df
        gone = set(df["parent"].dropna()) | {p for lst in df["replaces"] for p in lst}
        return df[(df["type"] == type_) & ~df["id"].isin(gone)]

    def text(self, row) -> str:
        if row.type == "ind":
            extra = f". {row.zone}. Examples: {', '.join(row.members)}" if isinstance(getattr(row, "members", None), list) and row.members else ""
            return f"{row.label}{extra}" if row.id.startswith("deep:") else f"{row.title}"
        desc = row.description if isinstance(getattr(row, "description", None), str) else ""
        return f"{row.label}. {desc}"[:400]

    def parent_shares(self, node_id: str, contrib: pd.DataFrame | None = None) -> dict[str, float]:
        """How a node's presence rolls up one level: to its parent, or across the industries a deep: node replaces."""
        r = self.df.loc[node_id]
        if node_id.startswith("deep:") and contrib is not None:
            part = contrib[contrib["node_id"] == node_id]
            tot = part["emp_2025"].sum()
            return {f"ind:{p}": float(e / tot) for p, e in zip(part["parent_code"], part["emp_2025"])}
        return {r["parent"]: 1.0} if isinstance(r["parent"], str) else {}
