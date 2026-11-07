import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { errorHandler } from "./middleware.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { chatRouter } from "./routes/chat.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use(
    "/api/auth",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === "test" ? 1000 : 50 }),
    authRouter,
  );
  app.use("/api/documents", documentsRouter);
  app.use("/api/chat", chatRouter);
  app.use((_req, res) => res.status(404).json({ error: { message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}