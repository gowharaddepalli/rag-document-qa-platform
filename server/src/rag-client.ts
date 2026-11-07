// HTTP client for the Python FastAPI RAG service. All calls carry the shared internal key.
import { readFile } from "node:fs/promises";
import { config } from "./config.js";

export interface RagCitation {
  document_id: string;
  page: number;
  snippet: string;
  score: number;
}
export interface RagAnswer {
  answer: string;
  citations: RagCitation[];
  not_found: boolean;
  mode: string;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (config.internalKey) headers.set("X-Internal-Key", config.internalKey);
  const res = await fetch(`${config.ragUrl}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `RAG service error (${res.status})`);
  return body as T;
}

export const rag = {
  async ingest(userId: string, documentId: string, filePath: string, fileName: string) {
    const fd = new FormData();
    fd.append("user_id", userId);
    fd.append("document_id", documentId);
    fd.append("file", new Blob([await readFile(filePath)], { type: "application/pdf" }), fileName);
    return call<{ pages: number; chunks: number }>("/ingest", { method: "POST", body: fd });
  },
  query(
    userId: string,
    question: string,
    documentIds: string[],
    history: { role: string; content: string }[],
  ) {
    return call<RagAnswer>("/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, question, document_ids: documentIds, history }),
    });
  },
  remove(userId: string, documentId: string) {
    return call<{ removed: number }>(`/documents/${userId}/${documentId}`, { method: "DELETE" });
  },
};