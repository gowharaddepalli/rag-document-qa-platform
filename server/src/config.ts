import "dotenv/config";

function required(name: string, fallbackForTest?: string): string {
  const v = process.env[name] ?? (process.env.NODE_ENV === "test" ? fallbackForTest : undefined);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/document_insight_hub",
  jwtSecret: required("JWT_SECRET", "test-secret"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:8080").split(","),
  ragUrl: (process.env.RAG_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, ""),
  internalKey: process.env.INTERNAL_API_KEY ?? "",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
};