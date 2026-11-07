"""Page-preserving chunker. Mirrors src/lib/rag/chunking.ts: chunks never span pages."""
import re
from dataclasses import dataclass


@dataclass
class Chunk:
    document_id: str
    page: int
    index: int
    text: str


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def chunk_pages(document_id: str, pages: list[dict], chunk_size: int = 800, overlap: int = 150) -> list[Chunk]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be >= 0 and < chunk_size")
    out: list[Chunk] = []
    index = 0
    for p in pages:
        text = normalize(p["text"])
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            if end < len(text):
                space = text.rfind(" ", 0, end)
                if space > start + chunk_size / 2:
                    end = space
            piece = text[start:end].strip()
            if piece:
                out.append(Chunk(document_id, int(p["page"]), index, piece))
                index += 1
            if end >= len(text):
                break
            start = max(end - overlap, start + 1)
    return out