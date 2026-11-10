"""Skills and education -> research nodes (SPEC 7.2).

Skills: each skill spreads one unit of weight over its three most similar research nodes (embedding similarity,
softmax shares) and over its three most similar occupations (recorded for Phase 5; occupations are not drawn).
`skill_match(n)` is the mean of those shares, so it sums to 1 over the research nodes.
Education: each degree maps to research nodes by embedding similarity of the degree text and, where the reviewed
field-to-CIP mapping has the degree's CIP code, to that field's nodes. Degrees are listed (with proposed CIP codes) in the
private profile because the LinkedIn export has no field of study; they are proposals for the owner to confirm.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..common import interim_dir, repo_root
from ..embed import embed
from .base import NodeTable, load_profile, personal_root, private_dir, top_shares


def research_candidates(nodes: NodeTable) -> tuple[pd.DataFrame, np.ndarray]:
    fld = nodes.finest("fld")
    return fld, embed([nodes.text(r) for r in fld.itertuples()])


def skill_shares(names: list[str], nodes: NodeTable) -> pd.DataFrame:
    fld, fv = research_candidates(nodes)
    occ = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str})
    ov = embed([f"{r.title}. {r.description}"[:300] for r in occ.itertuples()])
    sv = embed([f"Skill: {n}" for n in names])
    rows = []
    for i, n in enumerate(names):
        for j, s in top_shares(fv @ sv[i]):
            rows.append({"skill": n, "kind": "fld", "node_id": fld.index[j], "label": fld.iloc[j]["label"], "share": s})
        for j, s in top_shares(ov @ sv[i]):
            rows.append({"skill": n, "kind": "occ", "node_id": f"occ:{occ['soc'][j]}", "label": occ["title"][j], "share": s})
    return pd.DataFrame(rows)


def skill_match(shares: pd.DataFrame) -> pd.Series:
    f = shares[shares["kind"] == "fld"]
    n = f["skill"].nunique()
    return f.groupby("node_id")["share"].sum() / max(n, 1)


def degree_shares(degrees: list[dict], nodes: NodeTable) -> pd.DataFrame:
    fld, fv = research_candidates(nodes)
    cmap = pd.read_csv(repo_root() / "data" / "mappings" / "field_to_cip.csv", dtype=str)
    cmap = cmap[cmap["accept"] == "yes"]
    top = nodes.df[(nodes.df["level"] == 0) & (nodes.df["type"] == "fld")]
    rows = []
    for d in degrees:
        dv = embed([f"Degree: {d['text']}"])[0]
        shares: dict[str, float] = {}
        for j, s in top_shares(fv @ dv):
            shares[fld.index[j]] = shares.get(fld.index[j], 0.0) + s
        cip_fields = cmap[cmap["cip4"].isin(d.get("cip4", []))]
        if len(cip_fields):
            # spread each matched field over its finest nodes by US works, half of the degree's weight
            w = cip_fields["similarity"].astype(float).to_numpy(); w = w / w.sum()
            shares = {k: v * 0.5 for k, v in shares.items()}
            for fid, wf in zip(cip_fields["field_id"], w):
                node0 = f"fld:{fid}"
                members = [i for i in fld.index if i == node0 or _descends(nodes, i, node0)]
                if not members:
                    continue
                size = np.array([max(float(fld.loc[i, "size"].get("works", 0)), 1.0) for i in members]); size = size / size.sum()
                for i, si in zip(members, size):
                    shares[i] = shares.get(i, 0.0) + 0.5 * wf * si
        tot = sum(shares.values())
        for k, v in shares.items():
            rows.append({"degree": d["text"], "node_id": k, "label": fld.loc[k, "label"], "share": v / tot, "cip4": ";".join(d.get("cip4", []))})
    return pd.DataFrame(rows)


def course_degree_shares(degrees: list[dict], courses: pd.DataFrame, nodes: NodeTable) -> pd.DataFrame:
    """Degree -> research nodes from the transcript's course titles: each course spreads one unit over its three most
    similar research nodes, and a degree is the mean over its courses. Course lists live only in private/."""
    fld, fv = research_candidates(nodes)
    keys = {"BS": "(BS", "BA": "(BA", "MBA": "MBA"}
    rows = []
    for d in degrees:
        key = next(k for k, marker in keys.items() if marker in d["text"])
        mine = courses[courses["degree"] == key]["course"].tolist()
        cv = embed([f"Course: {c}" for c in mine])
        shares: dict[str, float] = {}
        for i in range(len(mine)):
            for j, s in top_shares(fv @ cv[i]):
                shares[fld.index[j]] = shares.get(fld.index[j], 0.0) + s / len(mine)
        for k, v in shares.items():
            rows.append({"degree": d["text"], "node_id": k, "label": fld.loc[k, "label"], "share": v, "cip4": f"{len(mine)} courses"})
    return pd.DataFrame(rows)


def apply_education_corrections(out: pd.DataFrame, corr: pd.DataFrame, nodes: NodeTable) -> pd.DataFrame:
    """Owner corrections in words: replace a degree's mapping with the listed fields (matched on research node name)."""
    labels = nodes.finest("fld").assign(key=lambda d: d["label"].str.lower())
    rows = []
    for deg in out["degree"].unique():
        mine = corr[corr["degree"].str.lower().apply(lambda k: k in deg.lower())]
        if mine.empty:
            rows.append(out[out["degree"] == deg]); continue
        got = []
        for r in mine.itertuples():
            hit = labels[labels["key"] == r.field.strip().lower()]
            if hit.empty:
                raise ValueError(f"education correction: no research field named '{r.field}' (see education_review.md for names)")
            got.append({"degree": deg, "node_id": hit.index[0], "label": hit.iloc[0]["label"], "share": float(r.share), "cip4": ""})
        d = pd.DataFrame(got); d["share"] = d["share"] / d["share"].sum()
        rows.append(d)
    return pd.concat(rows, ignore_index=True)


def _descends(nodes: NodeTable, node_id: str, ancestor: str) -> bool:
    cur = node_id
    while True:
        p = nodes.df.loc[cur, "parent"] if cur in nodes.df.index else None
        if not isinstance(p, str):
            return False
        if p == ancestor:
            return True
        cur = p


def run() -> int:
    nodes = NodeTable()
    names = [str(n) for n in pd.read_csv(personal_root() / "LinkedIn_Network" / "raw" / "Skills.csv")["Name"].dropna()]
    sh = skill_shares(names, nodes)
    sh.to_csv(private_dir() / "skills_mapping.csv", index=False)
    sm = skill_match(sh)
    print(f"skills: {len(names)} skills mapped to {len(sm)} research nodes (mass {sm.sum():.2f})")
    return 0


def run_education() -> int:
    profile = load_profile()
    degrees = profile.get("education", [])
    if not degrees:
        print("education: no degrees listed in the private profile (education: [{text, cip4}])")
        return 0
    nodes = NodeTable()
    course_file = private_dir() / "education_courses.csv"        # transcript course titles (private), when present they replace the degree-text guess
    out = course_degree_shares(degrees, pd.read_csv(course_file, dtype=str), nodes) if course_file.exists() else degree_shares(degrees, nodes)
    corr = private_dir() / "education_corrections.csv"          # words, not codes: degree (any unique part of its text), field (research node name), share
    if corr.exists():
        out = apply_education_corrections(out, pd.read_csv(corr, dtype=str), nodes)
    out.to_csv(private_dir() / "education_mapping.csv", index=False)
    top = out.sort_values("share", ascending=False).groupby("degree").head(8)
    lines = ["# education mapping (private): the research fields each degree is counted in", "",
             "To change one, add rows to education_corrections.csv with columns `degree` (a few words from its title), `field` (the field name as written below) and `share` (0 to 1, per degree they are rescaled to add to 1). A degree with correction rows uses only those rows.", ""]
    for deg, g in top.groupby("degree", sort=False):
        lines += [f"## {deg}", ""] + [f"- {r.label}: {r.share:.0%}" for r in g.itertuples()] + [""]
    (private_dir() / "education_review.md").write_text("\n".join(lines))
    print(f"education: {len(degrees)} degrees mapped to {out['node_id'].nunique()} research nodes")
    return 0
