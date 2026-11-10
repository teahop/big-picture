"""Level 1 similarities and bridge (SPEC 6.1 and 6.3 at subfield / detailed-industry resolution).

- industry-industry: cosine of occupation-share vectors (Level 1 nodes, incl. remainder nodes)
- subfield-subfield: topic co-assignment via OpenAlex group_by (geometric mean of mutual shares)
- bridge, occupational: the subfield's CIP programs are the owner-reviewed programs of its PARENT
  field, re-weighted by embedding similarity (softmax), then CIP -> SOC -> share of each SOC's jobs in
  each Level 1 industry. No new mapping to review.
- bridge, semantic: embedding similarity of subfield text and industry text.
The two signals are min-max scaled per subfield and combined with the same weights as Level 0.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .bridge import field_similarity, load_reviewed, minmax_rows
from .common import interim_dir, load_config, report_dir
from .embed import embed

SOFTMAX_T = 0.03     # temperature for re-weighting a field's programs per subfield
TOP_K = 5


def share_matrix(occ: pd.DataFrame) -> pd.DataFrame:
    """Rows = Level 1 industry codes, columns = occupations, row-normalised employment shares."""
    m = occ.astype({"emp_2025": float}).pivot_table(index="ind_code", columns="occ_code", values="emp_2025", aggfunc="sum", fill_value=0.0)
    return m.div(m.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)


def cosine(m: pd.DataFrame) -> pd.DataFrame:
    v = m.to_numpy(float)
    u = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    return pd.DataFrame(np.clip(u @ u.T, -1, 1), index=m.index, columns=m.index)


def softmax(x: np.ndarray, t: float) -> np.ndarray:
    z = (x - x.max()) / t
    e = np.exp(z)
    return e / e.sum()


def industry_texts(nodes: pd.DataFrame, occ: pd.DataFrame, onet: pd.DataFrame, n_occ: int = 8) -> list[str]:
    desc = onet.set_index("soc")["description"]; titles = onet.set_index("soc")["title"]
    out = []
    for r in nodes.itertuples():
        sub = occ[occ.ind_code == r.ind_code].sort_values("emp_2025", ascending=False)
        socs = [s for s in sub["occ_code"] if s in desc.index][:n_occ]
        out.append(f"{r.title} industry. Main occupations: " + " ".join(f"{titles[s]}: {str(desc[s])[:200]}" for s in socs))
    return out


def subfield_texts(subs: pd.DataFrame, topics: pd.DataFrame, n_topics: int = 8) -> list[str]:
    out = []
    for r in subs.itertuples():
        top = topics[topics.subfield_id == r.id].sort_values("works_us", ascending=False).head(n_topics)["name"]
        alt = r.alternatives if isinstance(r.alternatives, str) else ""
        desc = r.description if isinstance(r.description, str) else ""
        out.append(f"{r.name} ({r.field_name}). {desc} Related: {alt}. Topics: {', '.join(top)}.")
    return out


def occupational_l1(subs: pd.DataFrame, cip_accepted: pd.DataFrame, sub_vecs: np.ndarray, cip_docs: pd.DataFrame,
                    cip_vecs: np.ndarray, cip_soc: pd.DataFrame, occ_share_of_job: pd.DataFrame) -> pd.DataFrame:
    """Subfield x industry: share of the jobs of the subfield's occupations that sit in each Level 1 industry."""
    cs = cip_soc.drop_duplicates(["cip", "soc"]).copy()
    cs = cs[~cs["soc"].str.startswith("25-1")]  # postsecondary teaching excluded, as at Level 0
    cs["cip4"] = cs["cip"].str[:5]
    cs["w"] = 1.0 / cs.groupby("cip")["soc"].transform("count")
    doc_idx = {c: i for i, c in enumerate(cip_docs["cip4"])}
    prog_soc = {c4: g.groupby("soc")["w"].sum() for c4, g in cs.groupby("cip4")}
    rows = {}
    for i, r in enumerate(subs.itertuples()):
        progs = cip_accepted[cip_accepted.field_id == r.field_id]["cip4"].tolist()
        progs = [p for p in progs if p in doc_idx and p in prog_soc]
        if not progs:
            continue
        sims = np.array([sub_vecs[i] @ cip_vecs[doc_idx[p]] for p in progs])
        w = softmax(sims, SOFTMAX_T)
        vec = pd.Series(dtype=float)
        for p, wi in zip(progs, w):
            part = prog_soc[p] / prog_soc[p].sum() * wi
            vec = vec.add(part, fill_value=0.0)
        vec = vec[vec.index.isin(occ_share_of_job.index)]
        if vec.sum() <= 0:
            continue
        vec = vec / vec.sum()
        rows[r.id] = occ_share_of_job.loc[vec.index].mul(vec, axis=0).sum()
    return pd.DataFrame(rows).T.reindex(columns=occ_share_of_job.columns)


def run() -> int:
    lv = interim_dir() / "levels"; oa = interim_dir() / "openalex"
    nodes = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
    topics_all = pd.read_csv(oa / "topics.csv", dtype={"id": str, "subfield_id": str})
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str})
    cip_soc = pd.read_csv(interim_dir() / "cip" / "cip_soc.csv", dtype=str)
    out = interim_dir() / "graph_l1"; out.mkdir(parents=True, exist_ok=True)
    codes = list(nodes["ind_code"])

    shares = share_matrix(occ).reindex(codes).fillna(0.0)
    isim = cosine(shares); isim.to_csv(out / "industry_similarity.csv")

    co = pd.read_csv(oa / "subfield_coassignment.csv", index_col=0)
    co.index, co.columns = co.index.astype(str), co.columns.astype(str)
    co = co.loc[co.sum(axis=1) > 0, co.sum(axis=0) > 0]
    ssim = field_similarity(co.reindex(index=co.index, columns=co.index).fillna(0.0)); ssim.to_csv(out / "subfield_similarity.csv")

    sv = embed(subfield_texts(subs, topics_all)); iv = embed(industry_texts(nodes, occ, onet))
    sem = pd.DataFrame(sv @ iv.T, index=subs["id"], columns=codes); sem.to_csv(out / "bridge_semantic.csv")

    reviewed = load_reviewed()
    cs4 = cip_soc.drop_duplicates("cip").copy(); cs4["cip4"] = cs4["cip"].str[:5]
    docs = cs4.groupby("cip4")["cip_title"].apply(lambda s: "; ".join(s.head(25))).reset_index()
    cv = embed(list(docs["cip_title"]))
    job_share = occ.astype({"emp_2025": float}).pivot_table(index="occ_code", columns="ind_code", values="emp_2025", aggfunc="sum", fill_value=0.0)
    job_share = job_share.div(job_share.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0).reindex(columns=codes).fillna(0.0)
    occsig = occupational_l1(subs, reviewed, sv, docs, cv, cip_soc, job_share).reindex(index=subs["id"]).fillna(0.0)
    occsig.to_csv(out / "bridge_occupational.csv")
    cfg = load_config()["bridge"]
    comb = (cfg["weight_occupational"] * minmax_rows(occsig) + cfg["weight_semantic"] * minmax_rows(sem)) \
        / (cfg["weight_occupational"] + cfg["weight_semantic"])
    comb.to_csv(out / "bridge_combined.csv")

    names = dict(zip(codes, nodes["label"]))
    lines = ["# graph Level 1 report",
             f"- industries {len(codes)}; subfields {len(subs)}; subfield co-assignment matrix {co.shape}",
             f"- occupational signal built for {int((occsig.sum(axis=1) > 0).sum())} of {len(subs)} subfields (weights {cfg['weight_occupational']} / {cfg['weight_semantic']})",
             "", "## Spot check: top 3 industries per subfield", "", "| Subfield | Top 3 Level 1 industries |", "|---|---|"]
    for sid in ["2746", "1702", "1709", "2002", "1106", "2739", "1406", "2204"]:
        if sid in comb.index:
            top = comb.loc[sid].sort_values(ascending=False).head(3).index
            lines.append(f"| {subs.set_index('id').loc[sid, 'name']} | " + "; ".join(names[c][:55] for c in top) + " |")
    (report_dir() / "graph_l1.md").write_text("\n".join(lines) + "\n")
    print(f"graph L1: {len(codes)} industries, {len(subs)} subfields")
    return 0
