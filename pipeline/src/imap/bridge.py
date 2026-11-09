"""Field graph and the research-to-industry bridge (SPEC 6.1 and 6.3).

Signals are stored separately and combined:
  occupational: field -> CIP 4-digit (reviewed mapping) -> SOC -> sector (share of the occupation's jobs)
  semantic:     embedding similarity of field text and sector text (sector title + its largest occupations)
The occupational signal needs data/mappings/field_to_cip.csv, the owner-reviewed copy of
data/mappings/field_to_cip_proposed.csv. Without it only the semantic signal is built.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, repo_root, report_dir
from .embed import embed
from .sectors import SECTOR_CODES, SHORT_LABEL

MAPPINGS = repo_root() / "data" / "mappings"
PROPOSED = MAPPINGS / "field_to_cip_proposed.csv"
REVIEWED = MAPPINGS / "field_to_cip.csv"
CIP_TOP_N = 8


# ------------------------------------------------------------ field-field
def field_similarity(co: pd.DataFrame) -> pd.DataFrame:
    """Symmetric co-assignment similarity: geometric mean of the share of F's works that also
    carry a topic in G and the share of G's works that also carry one in F (diagonal = 1)."""
    m = co.to_numpy(dtype=float)
    share = m / m.sum(axis=1, keepdims=True)
    sim = np.sqrt(share * share.T)
    np.fill_diagonal(sim, 1.0)
    return pd.DataFrame(sim, index=co.index, columns=co.columns)


# ------------------------------------------------------------ text
def field_texts(fields: pd.DataFrame, subfields: pd.DataFrame, n_sub: int = 12) -> list[str]:
    texts = []
    for f in fields.itertuples():
        subs = subfields[subfields.field_id == f.id].sort_values("works_us", ascending=False).head(n_sub)["name"]
        alt = f.alternatives if isinstance(f.alternatives, str) else ""
        texts.append(f"{f.name}. {f.description}. Related: {alt}. Subfields: {', '.join(subs)}.")
    return texts


def sector_texts(inds: pd.DataFrame, cells: pd.DataFrame, onet: pd.DataFrame, n_occ: int = 10) -> list[str]:
    desc = onet.set_index("soc")["description"]
    titles = onet.set_index("soc")["title"]
    out = []
    for code in SECTOR_CODES:
        title = inds.loc[inds.ind_code == code, "ind_title"].iloc[0]
        sub = cells[(cells.ind_code == code) & (cells.occ_type == "Line item")].sort_values("pct_ind_2025", ascending=False)
        socs = [s for s in sub["occ_code"] if s in desc.index][:n_occ]
        parts = [f"{titles[s]}: {str(desc[s])[:240]}" for s in socs]
        out.append(f"{title} industry. Main occupations: " + " ".join(parts))
    return out


# ------------------------------------------------------------ CIP proposal
def cip4_docs(cs: pd.DataFrame) -> pd.DataFrame:
    cs = cs.drop_duplicates("cip").copy()
    cs["cip4"] = cs["cip"].str[:5]
    g = cs.groupby("cip4")["cip_title"].apply(lambda s: "; ".join(s.head(25))).reset_index()
    g["title_sample"] = g["cip_title"].str.slice(0, 90)
    return g


def propose_cip() -> pd.DataFrame:
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv")
    subs = pd.read_csv(interim_dir() / "openalex" / "subfields.csv")
    cs = pd.read_csv(interim_dir() / "cip" / "cip_soc.csv", dtype=str)
    docs = cip4_docs(cs)
    fv = embed(field_texts(fields, subs))
    dv = embed(list(docs["cip_title"]))
    sim = fv @ dv.T
    rows = []
    for i, f in enumerate(fields.itertuples()):
        for rank, j in enumerate(np.argsort(-sim[i], kind="stable")[:CIP_TOP_N], 1):
            rows.append({"field_id": f.id, "field": f.name, "rank": rank, "cip4": docs.cip4[j],
                         "cip4_examples": docs.title_sample[j], "similarity": round(float(sim[i, j]), 4),
                         "accept": "", "note": ""})
    out = pd.DataFrame(rows)
    MAPPINGS.mkdir(parents=True, exist_ok=True)
    out.to_csv(PROPOSED, index=False)
    return out


# ------------------------------------------------------------ signals
def semantic_signal() -> pd.DataFrame:
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv")
    subs = pd.read_csv(interim_dir() / "openalex" / "subfields.csv")
    bls = interim_dir() / "bls"
    inds = pd.read_csv(bls / "industries.csv", dtype={"ind_code": str})
    cells = pd.read_csv(bls / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str})
    fv, sv = embed(field_texts(fields, subs)), embed(sector_texts(inds, cells, onet))
    return pd.DataFrame(fv @ sv.T, index=fields["id"].astype(str), columns=SECTOR_CODES)


def occupational_signal(mapping: pd.DataFrame, exclude_postsecondary: bool = False) -> pd.DataFrame:
    """Share of each field's occupations' jobs found in each sector. `mapping` has field_id, cip4,
    weight (accepted rows only)."""
    cs = pd.read_csv(interim_dir() / "cip" / "cip_soc.csv", dtype=str).drop_duplicates(["cip", "soc"])
    cells = pd.read_csv(interim_dir() / "bls" / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    cells = cells[(cells.occ_type == "Line item") & cells.ind_code.isin(SECTOR_CODES)]
    pct = cells.pivot_table(index="occ_code", columns="ind_code", values="emp_2025", aggfunc="sum", fill_value=0.0)
    pct = pct.div(pct.sum(axis=1).replace(0, np.nan), axis=0).reindex(columns=SECTOR_CODES).fillna(0.0)
    if exclude_postsecondary:  # SOC 25-1xxx postsecondary teachers: the field's own academic home
        cs = cs[~cs["soc"].str.startswith("25-1")]
    cs["cip4"] = cs["cip"].str[:5]
    cs["w"] = 1.0 / cs.groupby("cip")["soc"].transform("count")  # each CIP6 splits its weight over its SOCs
    rows = {}
    for fid, grp in mapping.groupby("field_id"):
        vec = pd.Series(dtype=float)
        for r in grp.itertuples():
            part = cs[cs.cip4 == r.cip4].groupby("soc")["w"].sum()
            part = part / part.sum() * r.weight
            vec = vec.add(part, fill_value=0.0)
        vec = vec[vec.index.isin(pct.index)]
        vec = vec / vec.sum()
        rows[str(fid)] = (pct.loc[vec.index].mul(vec, axis=0)).sum()
    return pd.DataFrame(rows).T.reindex(columns=SECTOR_CODES)


def load_reviewed() -> pd.DataFrame | None:
    if not REVIEWED.exists():
        return None
    m = pd.read_csv(REVIEWED, dtype={"field_id": str, "cip4": str})
    m = m[m["accept"].astype(str).str.lower().isin(["yes", "y", "1", "true"])].copy()
    sim = m["similarity"].astype(float)
    m["weight"] = m["weight"].astype(float) if "weight" in m else sim
    return m


def minmax_rows(df: pd.DataFrame) -> pd.DataFrame:
    lo, hi = df.min(axis=1), df.max(axis=1)
    return df.sub(lo, axis=0).div((hi - lo).replace(0, 1), axis=0)


def combine(occ: pd.DataFrame | None, sem: pd.DataFrame, w_occ: float, w_sem: float) -> pd.DataFrame:
    s = minmax_rows(sem)
    if occ is None:
        return s
    return (w_occ * minmax_rows(occ) + w_sem * s) / (w_occ + w_sem)


SANITY = [  # (field name, acceptable sector codes) - sector must be in the field's top 3
    ("Medicine", ["620000"]),
    ("Computer Science", ["510000", "540000"]),
    ("Agricultural and Biological Sciences", ["110000"]),
    ("Economics, Econometrics and Finance", ["520000"]),
    ("Engineering", ["31-330", "540000"]),
]


def run() -> int:
    odir = interim_dir() / "graph"; odir.mkdir(parents=True, exist_ok=True)
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv")
    names = dict(zip(fields["id"].astype(str), fields["name"]))
    co = pd.read_csv(interim_dir() / "openalex" / "field_coassignment.csv", index_col=0)
    co.index, co.columns = co.index.astype(str), co.columns.astype(str)
    fsim = field_similarity(co)
    fsim.to_csv(odir / "field_similarity.csv")
    sem = semantic_signal(); sem.to_csv(odir / "bridge_semantic.csv")
    lines = ["# graph (fields and bridge) report", "- field-field method: topic co-assignment via OpenAlex group_by (preferred method; works and is cheap)",
             "- semantic signal: BAAI/bge-small-en-v1.5 embeddings of field text vs sector text"]
    reviewed = load_reviewed()
    if reviewed is None:
        lines.append(f"- occupational signal: NOT BUILT. Needs the reviewed mapping at {REVIEWED.relative_to(repo_root())}")
        (report_dir() / "graph_bridge.md").write_text("\n".join(lines) + "\n")
        print("graph(fields): field similarity and semantic signal built; occupational signal waiting for reviewed CIP mapping")
        return 0
    cfg = load_config()["bridge"]
    occ = occupational_signal(reviewed, cfg["exclude_postsecondary_teaching"]); occ.to_csv(odir / "bridge_occupational.csv")
    comb = combine(occ, sem, cfg["weight_occupational"], cfg["weight_semantic"])
    comb.to_csv(odir / "bridge_combined.csv")
    lines += [f"- postsecondary teaching occupations (SOC 25-1xxx) excluded from the occupational signal: {cfg['exclude_postsecondary_teaching']}", f"- weights: occupational {cfg['weight_occupational']}, semantic {cfg['weight_semantic']}", "",
              "## Top 5 sectors per field (combined)", "",
              "| Field | Top 5 sectors (combined) |", "|---|---|"]
    for fid in comb.index:
        top = comb.loc[fid].sort_values(ascending=False).head(5).index
        lines.append(f"| {names[fid]} | " + "; ".join(SHORT_LABEL[c] for c in top) + " |")
    lines += ["", "## Sanity pairs (sector must be in the field's top 3 combined)", "", "| Field | Accepted sectors | Top 3 | OK |", "|---|---|---|---|"]
    inv = {v: k for k, v in names.items()}
    for fname, ok_codes in SANITY:
        top3 = list(comb.loc[inv[fname]].sort_values(ascending=False).head(3).index)
        lines.append(f"| {fname} | {' or '.join(SHORT_LABEL[c] for c in ok_codes)} | {'; '.join(SHORT_LABEL[c] for c in top3)} | {'yes' if set(top3) & set(ok_codes) else 'NO'} |")
    (report_dir() / "graph_bridge.md").write_text("\n".join(lines) + "\n")
    print("graph(fields): bridge built")
    return 0
