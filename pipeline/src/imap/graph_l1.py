"""Level 1 industry similarity (SPEC 6.1 at detailed-industry resolution): cosine of occupation-share vectors
(Level 1 nodes, incl. remainder nodes). Also the industry texts the layout embeds."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import interim_dir, report_dir

def share_matrix(occ: pd.DataFrame) -> pd.DataFrame:
    """Rows = Level 1 industry codes, columns = occupations, row-normalised employment shares."""
    m = occ.astype({"emp_2025": float}).pivot_table(index="ind_code", columns="occ_code", values="emp_2025", aggfunc="sum", fill_value=0.0)
    return m.div(m.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)


def cosine(m: pd.DataFrame) -> pd.DataFrame:
    v = m.to_numpy(float)
    u = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    return pd.DataFrame(np.clip(u @ u.T, -1, 1), index=m.index, columns=m.index)


def industry_texts(nodes: pd.DataFrame, occ: pd.DataFrame, onet: pd.DataFrame, n_occ: int = 8) -> list[str]:
    desc = onet.set_index("soc")["description"]; titles = onet.set_index("soc")["title"]
    out = []
    for r in nodes.itertuples():
        sub = occ[occ.ind_code == r.ind_code].sort_values("emp_2025", ascending=False)
        socs = [s for s in sub["occ_code"] if s in desc.index][:n_occ]
        out.append(f"{r.title} industry. Main occupations: " + " ".join(f"{titles[s]}: {str(desc[s])[:200]}" for s in socs))
    return out


def run() -> int:
    lv = interim_dir() / "levels"
    nodes = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    out = interim_dir() / "graph_l1"; out.mkdir(parents=True, exist_ok=True)
    codes = list(nodes["ind_code"])
    isim = cosine(share_matrix(occ).reindex(codes).fillna(0.0)); isim.to_csv(out / "industry_similarity.csv")
    (report_dir() / "graph_l1.md").write_text(f"# graph Level 1 report\n- industries {len(codes)}\n")
    print(f"graph L1: {len(codes)} industries")
    return 0
