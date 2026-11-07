"""Per-user FAISS index (cosine similarity via inner product on L2-normalised vectors) with JSON metadata."""
import json
import os
import re
import threading

import faiss
import numpy as np

from .chunking import Chunk

_lock = threading.Lock()
_SAFE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _norm(vectors: list[list[float]]) -> np.ndarray:
    a = np.asarray(vectors, dtype="float32")
    faiss.normalize_L2(a)
    return a


class UserIndex:
    def __init__(self, root: str, user_id: str):
        if not _SAFE.match(user_id):
            raise ValueError("invalid user id")
        self.dir = os.path.join(root, user_id)
        os.makedirs(self.dir, exist_ok=True)
        self.meta_path = os.path.join(self.dir, "meta.json")
        self.index_path = os.path.join(self.dir, "index.faiss")
        with _lock:
            self._load()

    def _load(self):
        self.meta: list[dict] = []
        if os.path.exists(self.meta_path):
            with open(self.meta_path) as handle:
                self.meta = json.load(handle)
        self.index = faiss.read_index(self.index_path) if os.path.exists(self.index_path) else None

    def _save(self):
        with open(self.meta_path, "w") as handle:
            json.dump(self.meta, handle)
        if self.index is not None:
            faiss.write_index(self.index, self.index_path)

    def add(self, chunks: list[Chunk], vectors: list[list[float]]):
        if not chunks:
            return
        with _lock:
            self._load()
            a = _norm(vectors)
            if self.index is not None and self.index.d != a.shape[1]:
                raise ValueError("Embedding dimensions changed; rebuild this user's index")
            if self.index is None:
                self.index, self.meta = faiss.IndexFlatIP(a.shape[1]), []
            self.index.add(a)
            self.meta += [{"document_id": c.document_id, "page": c.page, "text": c.text} for c in chunks]
            self._save()

    def remove_document(self, document_id: str, embed_fn) -> int:
        """Flat indexes can't delete by id cheaply, so rebuild from the kept chunks."""
        with _lock:
            self._load()
            keep = [m for m in self.meta if m["document_id"] != document_id]
            removed = len(self.meta) - len(keep)
            if removed:
                self.meta, self.index = keep, None
                if keep:
                    a = _norm(embed_fn([m["text"] for m in keep]))
                    self.index = faiss.IndexFlatIP(a.shape[1])
                    self.index.add(a)
                elif os.path.exists(self.index_path):
                    os.remove(self.index_path)
                self._save()
            return removed

    def search(self, query_vec: list[float], k: int, document_ids: list[str] | None) -> list[dict]:
        with _lock:
            self._load()
            return self._search(query_vec, k, document_ids)

    def _search(self, query_vec: list[float], k: int, document_ids: list[str] | None) -> list[dict]:
        if self.index is None or not self.meta:
            return []
        allowed = set(document_ids or [])
        n = len(self.meta) if allowed else min(len(self.meta), k)
        scores, ids = self.index.search(_norm([query_vec]), n)
        out = []
        for s, i in zip(scores[0], ids[0]):
            if i < 0:
                continue
            m = self.meta[i]
            if allowed and m["document_id"] not in allowed:
                continue
            out.append({**m, "score": float(s)})
            if len(out) >= k:
                break
        return out