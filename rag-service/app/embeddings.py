"""Embedding providers.

- OpenAI (via LangChain) when OPENAI_API_KEY is set.
- DEMO: deterministic feature-hashing vectors. This is lexical, not semantic; it exists so the
  pipeline (chunk -> embed -> FAISS -> cite) runs end to end without credentials.
"""
import hashlib
import re

import numpy as np

from .config import settings

DEMO_DIM = 512
_TOKEN = re.compile(r"[a-z0-9]+")


class HashingEmbeddings:
    name = "demo-hashing"
    dim = DEMO_DIM

    def _one(self, text: str) -> list[float]:
        v = np.zeros(DEMO_DIM, dtype="float32")
        toks = [t for t in _TOKEN.findall(text.lower()) if len(t) > 1]
        for t in toks + [a + "_" + b for a, b in zip(toks, toks[1:])]:
            h = int(hashlib.md5(t.encode()).hexdigest(), 16)
            v[h % DEMO_DIM] += 1.0 if (h >> 9) & 1 else -1.0
        return v.tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._one(text)


def get_embeddings():
    if settings.demo:
        return HashingEmbeddings()
    from langchain_openai import OpenAIEmbeddings

    emb = OpenAIEmbeddings(model=settings.openai_embed_model, api_key=settings.openai_api_key)
    emb.name = f"openai:{settings.openai_embed_model}"  # type: ignore[attr-defined]
    return emb