import { Router } from "express";
import { z } from "zod";
import { Conversation, DocumentModel, Message } from "../models.js";
import { ah, HttpError, requireAuth } from "../middleware.js";
import { rag } from "../rag-client.js";

const askSchema = z.object({
  conversationId: z.string().nullable().optional(),
  question: z
    .string()
    .trim()
    .min(1, "Question must be 1–2000 characters")
    .max(2000, "Question must be 1–2000 characters"),
  documentIds: z.array(z.string()).max(50).default([]),
});

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get(
  "/conversations",
  ah(async (req, res) => {
    const list = await Conversation.find({ owner: req.userId }).sort({ updatedAt: -1 }).limit(100);
    res.json({ conversations: list.map((c) => c.toJSON()) });
  }),
);

chatRouter.get(
  "/conversations/:id/messages",
  ah(async (req, res) => {
    const conv = await Conversation.findOne({ _id: req.params.id, owner: req.userId });
    if (!conv) throw new HttpError(404, "Conversation not found");
    const msgs = await Message.find({ conversation: conv._id }).sort({ createdAt: 1 });
    res.json({ messages: msgs.map((m) => m.toJSON()) });
  }),
);

chatRouter.delete(
  "/conversations/:id",
  ah(async (req, res) => {
    const conv = await Conversation.findOneAndDelete({ _id: req.params.id, owner: req.userId });
    if (!conv) throw new HttpError(404, "Conversation not found");
    await Message.deleteMany({ conversation: conv._id });
    res.status(204).end();
  }),
);

chatRouter.post(
  "/ask",
  ah(async (req, res) => {
    if (!req.userId) throw new HttpError(401, "Authentication required");
    const { conversationId, question, documentIds } = askSchema.parse(req.body);
    const t0 = Date.now();

    // Only the caller's own ready documents may be searched.
    const filter: Record<string, unknown> = { owner: req.userId, status: "ready" };
    if (documentIds.length) filter._id = { $in: documentIds };
    const docs = await DocumentModel.find(filter);
    const names = new Map(docs.map((d) => [d.id as string, d.name]));

    let conv = conversationId
      ? await Conversation.findOne({ _id: conversationId, owner: req.userId })
      : null;
    if (conversationId && !conv) throw new HttpError(404, "Conversation not found");
    if (!conv)
      conv = await Conversation.create({ owner: req.userId, title: question.slice(0, 60) });
    const history = (
      await Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).limit(6)
    )
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

    const r = docs.length
      ? await rag.query(req.userId, question, [...names.keys()], history)
      : {
          answer: "Not found in uploaded documents. Upload a PDF (or select a ready one) first.",
          citations: [],
          not_found: true,
          mode: "none",
        };

    await Message.create({
      conversation: conv._id,
      owner: req.userId,
      role: "user",
      content: question,
    });
    const msg = await Message.create({
      conversation: conv._id,
      owner: req.userId,
      role: "assistant",
      content: r.answer,
      notFound: r.not_found,
      mode: r.mode,
      latencyMs: Date.now() - t0,
      citations: r.citations
        .filter((c) => names.has(c.document_id)) // drop anything not owned by this user
        .map((c, i) => ({
          index: i + 1,
          documentId: c.document_id,
          documentName: names.get(c.document_id),
          page: c.page,
          snippet: c.snippet,
          score: c.score,
        })),
    });
    conv.set({ updatedAt: new Date() });
    await conv.save();
    res.json({ conversationId: conv.id, message: msg.toJSON() });
  }),
);