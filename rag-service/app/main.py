import hmac

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .answer import generate
from .chunking import chunk_pages
from .config import settings
from .embeddings import get_embeddings
from .pdf import extract_pages
from .store import UserIndex

app = FastAPI(title="Document Insight Hub RAG service")


def check_key(x_internal_key: str = Header(default="")):
    if not settings.internal_api_key:
        raise HTTPException(503, "Internal authentication is not configured")
    if not hmac.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(401, "Invalid internal key")


def index_for(user_id: str) -> UserIndex:
    try:
        return UserIndex(settings.index_dir, user_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/health")
def health():
    emb = get_embeddings()
    return {"ok": True, "mode": "demo" if settings.demo else "llm", "embeddings": getattr(emb, "name", "unknown")}


@app.post("/ingest", dependencies=[Depends(check_key)])
async def ingest(user_id: str = Form(...), document_id: str = Form(...), file: UploadFile = File(...)):
    data = await file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "File is not a PDF")
    try:
        pages = extract_pages(data)
    except Exception as e:  # malformed PDFs
        raise HTTPException(422, f"Could not read PDF: {e}")
    chunks = chunk_pages(document_id, pages, settings.chunk_size, settings.chunk_overlap)
    if chunks:
        emb = get_embeddings()
        index_for(user_id).add(chunks, emb.embed_documents([c.text for c in chunks]))
    return {"pages": len(pages), "chunks": len(chunks)}


class QueryIn(BaseModel):
    user_id: str
    question: str = Field(min_length=1, max_length=2000)
    document_ids: list[str] = []
    history: list[dict] = []


@app.post("/query", dependencies=[Depends(check_key)])
def query(body: QueryIn):
    emb = get_embeddings()
    hits = index_for(body.user_id).search(emb.embed_query(body.question), settings.top_k, body.document_ids)
    r = generate(body.question, hits, body.history)
    r["citations"] = [
        {"document_id": h["document_id"], "page": h["page"], "snippet": h["text"][:280], "score": round(h["score"], 3)}
        for h in r["citations"]
    ]
    return r


@app.delete("/documents/{user_id}/{document_id}", dependencies=[Depends(check_key)])
def delete_document(user_id: str, document_id: str):
    return {"removed": index_for(user_id).remove_document(document_id, get_embeddings().embed_documents)}