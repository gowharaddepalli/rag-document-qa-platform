import { Schema, model, type InferSchemaType, Types } from "mongoose";

const toJSON = {
  virtuals: true,
  versionKey: false,
  transform: (_d: unknown, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.passwordHash;
    delete ret.storagePath;
    return ret;
  },
};

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true, toJSON },
);

const documentSchema = new Schema(
  {
    owner: { type: Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    storagePath: { type: String, required: true, select: false },
    size: { type: Number, required: true },
    pages: { type: Number, default: 0 },
    chunks: { type: Number, default: 0 },
    status: { type: String, enum: ["processing", "ready", "failed"], default: "processing" },
    error: String,
  },
  { timestamps: true, toJSON },
);

const conversationSchema = new Schema(
  {
    owner: { type: Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
  },
  { timestamps: true, toJSON },
);

const citationSchema = new Schema(
  {
    index: Number,
    documentId: String,
    documentName: String,
    page: Number,
    snippet: String,
    score: Number,
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversation: { type: Types.ObjectId, ref: "Conversation", required: true, index: true },
    owner: { type: Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    citations: { type: [citationSchema], default: [] },
    notFound: Boolean,
    mode: String,
    latencyMs: Number,
  },
  { timestamps: true, toJSON },
);

export const User = model("User", userSchema);
export const DocumentModel = model("Document", documentSchema);
export const Conversation = model("Conversation", conversationSchema);
export const Message = model("Message", messageSchema);
export type UserDoc = InferSchemaType<typeof userSchema>;