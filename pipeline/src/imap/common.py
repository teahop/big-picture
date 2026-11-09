"""Paths and config shared by every stage."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

import yaml


@lru_cache(maxsize=1)
def repo_root() -> Path:
    for parent in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (parent / "config" / "site.yaml").exists():
            return parent
    raise RuntimeError("Could not find repo root (config/site.yaml)")


def raw_dir() -> Path:
    return repo_root() / "data" / "raw"


def interim_dir() -> Path:
    return repo_root() / "data" / "interim"


def public_dir() -> Path:
    return repo_root() / "data" / "public"


def report_dir() -> Path:
    path = interim_dir() / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_config() -> dict:
    return yaml.safe_load((repo_root() / "config" / "pipeline.yaml").read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
