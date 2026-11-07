import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import { config } from "./config.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "Authentication required"));
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    req.userId = String(payload.sub);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

/** Wraps async handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as AuthedRequest, res, next).catch(next);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { message: err.issues[0]?.message ?? "Invalid input" } });
  }
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: { message: err.message } });
  const e = err as { code?: string; name?: string; message?: string };
  if (e?.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: { message: "PDF is too large" } });
  if (e?.name === "CastError") return res.status(404).json({ error: { message: "Not found" } });
  console.error(err);
  res.status(500).json({ error: { message: "Internal server error" } });
}