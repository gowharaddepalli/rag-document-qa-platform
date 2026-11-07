import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.answer import NOT_FOUND, extractive
from app.chunking import chunk_pages
from app.config import settings
from app.embeddings import HashingEmbeddings
from app.store import UserIndex
from app.chunking import Chunk

PAGES = [
    {"page": 1, "text": "Refunds are issued within 14 days of purchase."},
    {"page": 2, "text": "Shipping takes five business days to Europe."},
]


def test_chunks_never_cross_pages():
    c = chunk_pages("d", [{"page": 3, "text": "word " * 500}], 200, 50)
    assert len(c) > 1 and all(x.page == 3 and len(x.text) <= 200 for x in c)


def test_rejects_bad_overlap():
    with pytest.raises(ValueError):
        chunk_pages("d", PAGES, 100, 100)


def _index(tmp_path):
    idx, emb = UserIndex(str(tmp_path), "u1"), HashingEmbeddings()
    chunks = chunk_pages("doc1", PAGES)
    idx.add(chunks, emb.embed_documents([c.text for c in chunks]))
    return idx, emb


def test_faiss_retrieval_returns_correct_page(tmp_path):
    idx, emb = _index(tmp_path)
    hits = idx.search(emb.embed_query("how many days for refunds"), 2, None)
    assert hits[0]["page"] == 1
    a = extractive("how many days for refunds", hits)
    assert not a["not_found"] and a["citations"][0]["page"] == 1 and "[1]" in a["answer"]


def test_not_found_has_no_citations(tmp_path):
    idx, emb = _index(tmp_path)
    q = "what is the CEO salary"
    assert extractive(q, idx.search(emb.embed_query(q), 3, None)) == {
        "answer": NOT_FOUND, "citations": [], "not_found": True, "mode": "demo-extractive"}


def test_document_filter_and_delete(tmp_path):
    idx, emb = _index(tmp_path)
    assert idx.search(emb.embed_query("refunds"), 3, ["other"]) == []
    assert idx.remove_document("doc1", emb.embed_documents) == 2
    assert idx.search(emb.embed_query("refunds"), 3, None) == []


def test_rejects_path_traversal_user_id(tmp_path):
    with pytest.raises(ValueError):
        UserIndex(str(tmp_path), "../etc")


def test_api_requires_internal_key_and_ingests(tmp_path, monkeypatch):
    from app.main import app
    monkeypatch.setattr(settings, "internal_api_key", "k")
    monkeypatch.setattr(settings, "index_dir", str(tmp_path))
    c = TestClient(app)
    buf = io.BytesIO(); w = PdfWriter(); w.add_blank_page(100, 100); w.write(buf)
    files = {"file": ("a.pdf", buf.getvalue(), "application/pdf")}
    assert c.post("/ingest", data={"user_id": "u", "document_id": "d"}, files=files).status_code == 401
    r = c.post("/ingest", data={"user_id": "u", "document_id": "d"}, files=files, headers={"X-Internal-Key": "k"})
    assert r.json() == {"pages": 1, "chunks": 0}  # blank page: no text, no invented chunks
    q = c.post("/query", json={"user_id": "u", "question": "anything"}, headers={"X-Internal-Key": "k"})
    assert q.json()["not_found"] is True


def test_stale_index_instances_preserve_both_uploads(tmp_path):
    first = UserIndex(str(tmp_path), "u")
    second = UserIndex(str(tmp_path), "u")
    first.add([Chunk("a", 1, 0, "refunds")], [[1.0, 0.0]])
    second.add([Chunk("b", 2, 0, "shipping")], [[0.0, 1.0]])
    saved = UserIndex(str(tmp_path), "u")
    assert {m["document_id"] for m in saved.meta} == {"a", "b"}


def test_filtered_search_reaches_documents_beyond_overfetch(tmp_path):
    index = UserIndex(str(tmp_path), "u")
    chunks = [Chunk("other", 1, i, "refunds") for i in range(60)]
    chunks.append(Chunk("allowed", 2, 60, "shipping"))
    index.add(chunks, [[1.0, 0.0]] * 60 + [[0.0, 1.0]])
    hits = index.search([1.0, 0.0], 1, ["allowed"])
    assert len(hits) == 1 and hits[0]["document_id"] == "allowed"


def test_missing_internal_key_fails_closed(monkeypatch):
    from app.main import app
    monkeypatch.setattr(settings, "internal_api_key", "")
    client = TestClient(app)
    response = client.post("/query", json={"user_id": "u", "question": "refunds"})
    assert response.status_code == 503