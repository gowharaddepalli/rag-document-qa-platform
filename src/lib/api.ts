// Client API adapter.
// - If VITE_API_URL is set, talks to the Express server (server/) which calls the FastAPI RAG service.
// - Otherwise runs an honest in-browser DEMO backend: local accounts, PDF parsing, BM25 retrieval,
//   extractive answers. No LLM is called and the UI labels every answer as demo mode.
import { chunkPages, type Chunk } from "./rag/chunking";
import { bm25Search, extractiveAnswer, type Citation } from "./rag/retrieval";

export type Mode = "demo" | "remote";
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface DocumentItem {
  id: string;
  name: string;
  size: number;
  pages: number;
  chunks: number;
  status: "processing" | "ready" | "failed";
  error?: string | undefined;
  createdAt: string;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  notFound?: boolean;
  mode?: string;
  latencyMs?: number;
  createdAt: string;
}
export type { Citation };

const API_URL = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
export const mode: Mode = API_URL ? "remote" : "demo";
const TOKEN_KEY = "dih_token";
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------------- remote ----------------
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

// ---------------- demo ----------------
interface DemoUser extends User {
  salt: string;
  hash: string;
}
interface DemoData {
  documents: DocumentItem[];
  chunks: Chunk[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
}
const USERS = "dih_demo_users";
const readUsers = (): Record<string, DemoUser> => JSON.parse(localStorage.getItem(USERS) ?? "{}");
async function sha(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function currentDemoUser(): DemoUser | null {
  const t = localStorage.getItem(TOKEN_KEY);
  if (!t?.startsWith("demo:")) return null;
  return Object.values(readUsers()).find((u) => u.id === t.slice(5)) ?? null;
}
const dataKey = (id: string) => `dih_demo_data_${id}`;
function loadData(): DemoData {
  const u = currentDemoUser();
  if (!u) throw new Error("Not signed in");
  return JSON.parse(
    localStorage.getItem(dataKey(u.id)) ??
      '{"documents":[],"chunks":[],"conversations":[],"messages":{}}',
  );
}
function saveData(d: DemoData) {
  const u = currentDemoUser();
  if (!u) throw new Error("Not signed in");
  try {
    localStorage.setItem(dataKey(u.id), JSON.stringify(d));
  } catch {
    throw new Error(
      "Browser storage is full. Delete a document or run the full stack for larger files.",
    );
  }
}
function validateCreds(email: string, password: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
}

// ---------------- public API ----------------
export const api = {
  async register(name: string, email: string, password: string): Promise<User> {
    validateCreds(email, password);
    if (mode === "remote") {
      const r = await req<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      return r.user;
    }
    const users = readUsers();
    const key = email.toLowerCase();
    if (users[key]) throw new Error("An account with this email already exists");
    const salt = uid();
    const u: DemoUser = {
      id: uid(),
      email: key,
      name: name || key.split("@")[0] || "User",
      salt,
      hash: await sha(salt + password),
    };
    users[key] = u;
    localStorage.setItem(USERS, JSON.stringify(users));
    localStorage.setItem(TOKEN_KEY, `demo:${u.id}`);
    return { id: u.id, email: u.email, name: u.name };
  },
  async login(email: string, password: string): Promise<User> {
    if (mode === "remote") {
      const r = await req<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(TOKEN_KEY, r.token);
      return r.user;
    }
    const u = readUsers()[email.toLowerCase()];
    if (!u || (await sha(u.salt + password)) !== u.hash)
      throw new Error("Invalid email or password");
    localStorage.setItem(TOKEN_KEY, `demo:${u.id}`);
    return { id: u.id, email: u.email, name: u.name };
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },
  async me(): Promise<User | null> {
    if (!localStorage.getItem(TOKEN_KEY)) return null;
    if (mode === "remote")
      return req<{ user: User }>("/auth/me")
        .then((r) => r.user)
        .catch(() => null);
    const u = currentDemoUser();
    return u ? { id: u.id, email: u.email, name: u.name } : null;
  },

  async listDocuments(): Promise<DocumentItem[]> {
    if (mode === "remote")
      return (await req<{ documents: DocumentItem[] }>("/documents")).documents;
    return loadData().documents;
  },
  async uploadDocument(file: File): Promise<DocumentItem> {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
      throw new Error("Only PDF files are supported");
    if (file.size > 20 * 1024 * 1024) throw new Error("PDF must be 20 MB or smaller");
    if (mode === "remote") {
      const fd = new FormData();
      fd.append("file", file);
      return (await req<{ document: DocumentItem }>("/documents", { method: "POST", body: fd }))
        .document;
    }
    const { extractPdfPages } = await import("./rag/pdf");
    const id = uid();
    const pages = await extractPdfPages(file);
    const chunks = chunkPages(id, pages);
    const doc: DocumentItem = {
      id,
      name: file.name,
      size: file.size,
      pages: pages.length,
      chunks: chunks.length,
      createdAt: now(),
      status: chunks.length ? "ready" : "failed",
      error: chunks.length
        ? undefined
        : "No extractable text (scanned PDFs need OCR, which is not included).",
    };
    const d = loadData();
    d.documents.unshift(doc);
    d.chunks.push(...chunks);
    saveData(d);
    return doc;
  },
  async deleteDocument(id: string) {
    if (mode === "remote") {
      await req(`/documents/${id}`, { method: "DELETE" });
      return;
    }
    const d = loadData();
    d.documents = d.documents.filter((x) => x.id !== id);
    d.chunks = d.chunks.filter((c) => c.documentId !== id);
    saveData(d);
  },

  async listConversations(): Promise<Conversation[]> {
    if (mode === "remote")
      return (await req<{ conversations: Conversation[] }>("/chat/conversations")).conversations;
    return loadData().conversations;
  },
  async getMessages(conversationId: string): Promise<Message[]> {
    if (mode === "remote")
      return (await req<{ messages: Message[] }>(`/chat/conversations/${conversationId}/messages`))
        .messages;
    return loadData().messages[conversationId] ?? [];
  },
  async deleteConversation(id: string) {
    if (mode === "remote") {
      await req(`/chat/conversations/${id}`, { method: "DELETE" });
      return;
    }
    const d = loadData();
    d.conversations = d.conversations.filter((c) => c.id !== id);
    delete d.messages[id];
    saveData(d);
  },
  async ask(
    conversationId: string | null,
    question: string,
    documentIds: string[],
  ): Promise<{ conversationId: string; message: Message }> {
    const q = question.trim();
    if (!q || q.length > 2000) throw new Error("Question must be 1–2000 characters");
    if (mode === "remote")
      return req("/chat/ask", {
        method: "POST",
        body: JSON.stringify({ conversationId, question: q, documentIds }),
      });
    const t0 = performance.now();
    const d = loadData();
    const ready = new Set(
      d.documents
        .filter((x) => x.status === "ready" && (!documentIds.length || documentIds.includes(x.id)))
        .map((x) => x.id),
    );
    const hits = bm25Search(
      q,
      d.chunks.filter((c) => ready.has(c.documentId)),
      5,
    );
    const names = new Map(d.documents.map((x) => [x.id, x.name]));
    const a = extractiveAnswer(q, hits, (id) => names.get(id) ?? "Unknown");
    let cid = conversationId;
    if (!cid || !d.messages[cid]) {
      cid = uid();
      d.conversations.unshift({ id: cid, title: q.slice(0, 60), updatedAt: now() });
      d.messages[cid] = [];
    }
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: q,
      citations: [],
      createdAt: now(),
    };
    const msg: Message = {
      id: uid(),
      role: "assistant",
      content: a.content,
      citations: a.citations,
      notFound: a.notFound,
      mode: "demo-extractive",
      latencyMs: Math.round(performance.now() - t0),
      createdAt: now(),
    };
    const messages = d.messages[cid];
    const conv = d.conversations.find((c) => c.id === cid);
    if (!messages || !conv) throw new Error("Conversation not found");
    messages.push(userMsg, msg);
    conv.updatedAt = now();
    saveData(d);
    return { conversationId: cid, message: msg };
  },
};