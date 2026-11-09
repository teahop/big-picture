"""Local sentence embeddings (fastembed, BAAI/bge-small-en-v1.5, ONNX; no API key).
Results are cached by text hash so reruns are identical and fast."""
from __future__ import annotations

import hashlib

import numpy as np

from .common import interim_dir

MODEL = "BAAI/bge-small-en-v1.5"
_model = None


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(MODEL)
    return _model


def embed(texts: list[str]) -> np.ndarray:
    """Unit-length embeddings, one row per text."""
    cache = interim_dir() / "embeddings"
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256((MODEL + "\x00" + "\x00".join(texts)).encode()).hexdigest()[:24]
    path = cache / f"{key}.npy"
    if path.exists():
        return np.load(path)
    vecs = np.array(list(_get_model().embed(texts)), dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    np.save(path, vecs)
    return vecs
