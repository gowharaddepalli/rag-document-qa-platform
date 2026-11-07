import { Router } from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { DocumentModel } from "../models.js";
import { ah, HttpError, requireAuth } from "../middleware.js";
import { rag } from "../rag-client.js";

mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`), // never trust the client filename on disk
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" && file.originalname.toLowerCase().endsWith(".pdf");
    if (!ok) return cb(new HttpError(400, "Only PDF files are supported"));
    cb(null, true);
  },
});

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.get(
  "/",
  ah(async (req, res) => {
    const docs = await DocumentModel.find({ owner: req.userId }).sort({ createdAt: -1 });
    res.json({ documents: docs.map((d) => d.toJSON()) });
  }),
);

documentsRouter.post(
  "/",
  upload.single("file"),
  ah(async (req, res) => {
    if (!req.userId) throw new HttpError(401, "Authentication required");
    if (!req.file) throw new HttpError(400, "Attach a PDF in the 'file' field");
    const doc = await DocumentModel.create({
      owner: req.userId,
      name: path.basename(req.file.originalname).slice(0, 200),
      storagePath: req.file.path,
      size: req.file.size,
      status: "processing",
    });
    try {
      const r = await rag.ingest(req.userId, doc.id, req.file.path, doc.name);
      doc.set({
        pages: r.pages,
        chunks: r.chunks,
        status: r.chunks > 0 ? "ready" : "failed",
        error: r.chunks > 0 ? undefined : "No extractable text (scanned PDFs need OCR).",
      });
    } catch (e) {
      doc.set({ status: "failed", error: (e as Error).message });
    }
    await doc.save();
    res.status(201).json({ document: doc.toJSON() });
  }),
);

documentsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    if (!req.userId) throw new HttpError(401, "Authentication required");
    const doc = await DocumentModel.findOne({ _id: req.params.id, owner: req.userId }).select(
      "+storagePath",
    );
    if (!doc) throw new HttpError(404, "Document not found");
    await rag.remove(req.userId, doc.id);
    await unlink(doc.storagePath).catch(() => undefined);
    await doc.deleteOne();
    res.status(204).end();
  }),
);