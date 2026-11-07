import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.UPLOAD_DIR = "./tmp-test-uploads";

vi.mock("../src/rag-client.js", () => ({
  rag: {
    ingest: vi.fn(async () => ({ pages: 2, chunks: 3 })),
    remove: vi.fn(async () => ({ removed: 3 })),
    query: vi.fn(async (_u: string, _q: string, ids: string[]) => ({
      answer: "Refunds take 14 days [1]",
      not_found: false,
      mode: "demo-extractive",
      citations: [
        { document_id: ids[0], page: 2, snippet: "Refunds take 14 days", score: 0.9 },
        { document_id: "someone-elses-doc", page: 1, snippet: "x", score: 0.5 },
      ],
    })),
  },
}));

const { createApp } = await import("../src/app.js");
const app = createApp();
let mongo: MongoMemoryServer | undefined;
const pdf = Buffer.from("%PDF-1.4\n%fake\n");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Test database is not connected");
  await db.dropDatabase();
});

async function register(email = "a@example.com") {
  const r = await request(app)
    .post("/api/auth/register")
    .send({ name: "A", email, password: "password123" });
  return r.body.token as string;
}

describe("auth", () => {
  it("registers, logs in and never returns the password hash", async () => {
    const r = await request(app)
      .post("/api/auth/register")
      .send({ email: "A@Example.com", password: "password123" });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: "a@example.com", name: "a" });
    expect(r.body.user.passwordHash).toBeUndefined();
    const l = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "password123" });
    expect(l.status).toBe(200);
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${l.body.token}`);
    expect(me.body.user.email).toBe("a@example.com");
  });
  it("rejects short passwords, duplicates and wrong passwords", async () => {
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "b@example.com", password: "short" })
      ).status,
    ).toBe(400);
    await register("c@example.com");
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "c@example.com", password: "password123" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "c@example.com", password: "wrongpass1" })
      ).status,
    ).toBe(401);
  });
  it("blocks protected routes without a valid token", async () => {
    expect((await request(app).get("/api/documents")).status).toBe(401);
    expect(
      (await request(app).get("/api/documents").set("Authorization", "Bearer nope")).status,
    ).toBe(401);
  });
});

describe("documents and chat", () => {
  it("rejects non-PDF uploads", async () => {
    const t = await register();
    const r = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${t}`)
      .attach("file", Buffer.from("hi"), { filename: "x.txt", contentType: "text/plain" });
    expect(r.status).toBe(400);
  });
  it("uploads, asks with citations restricted to owned docs, and isolates users", async () => {
    const t = await register();
    const up = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${t}`)
      .attach("file", pdf, { filename: "policy.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(201);
    expect(up.body.document).toMatchObject({
      name: "policy.pdf",
      status: "ready",
      pages: 2,
      chunks: 3,
    });
    expect(up.body.document.storagePath).toBeUndefined();

    const ask = await request(app)
      .post("/api/chat/ask")
      .set("Authorization", `Bearer ${t}`)
      .send({ question: "refund time?" });
    expect(ask.status).toBe(200);
    expect(ask.body.message.citations).toEqual([
      expect.objectContaining({ index: 1, documentName: "policy.pdf", page: 2 }),
    ]);
    const msgs = await request(app)
      .get(`/api/chat/conversations/${ask.body.conversationId}/messages`)
      .set("Authorization", `Bearer ${t}`);
    expect(msgs.body.messages).toHaveLength(2);

    const other = await register("other@example.com");
    expect(
      (await request(app).get("/api/documents").set("Authorization", `Bearer ${other}`)).body
        .documents,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get(`/api/chat/conversations/${ask.body.conversationId}/messages`)
          .set("Authorization", `Bearer ${other}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/documents/${up.body.document.id}`)
          .set("Authorization", `Bearer ${other}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/documents/${up.body.document.id}`)
          .set("Authorization", `Bearer ${t}`)
      ).status,
    ).toBe(204);
  });
  it("answers not-found without calling RAG when no documents are ready", async () => {
    const t = await register();
    const r = await request(app)
      .post("/api/chat/ask")
      .set("Authorization", `Bearer ${t}`)
      .send({ question: "anything" });
    expect(r.body.message).toMatchObject({ notFound: true, citations: [] });
  });
  it("rejects a supplied conversation that does not exist", async () => {
    const token = await register();
    const response = await request(app)
      .post("/api/chat/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "refunds", conversationId: "000000000000000000000001" });
    expect(response.status).toBe(404);
  });
});