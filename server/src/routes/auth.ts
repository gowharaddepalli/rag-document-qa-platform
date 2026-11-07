import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models.js";
import { ah, HttpError, requireAuth, signToken } from "../middleware.js";

const registerSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export const authRouter = Router();

authRouter.post(
  "/register",
  ah(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);
    if (await User.exists({ email }))
      throw new HttpError(409, "An account with this email already exists");
    const user = await User.create({
      email,
      name: name || email.split("@")[0],
      passwordHash: await bcrypt.hash(password, 12),
    });
    res.status(201).json({ token: signToken(user.id), user: user.toJSON() });
  }),
);

authRouter.post(
  "/login",
  ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email });
    // Same message for unknown email and wrong password to avoid account enumeration.
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new HttpError(401, "Invalid email or password");
    res.json({ token: signToken(user.id), user: user.toJSON() });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw new HttpError(401, "Account no longer exists");
    res.json({ user: user.toJSON() });
  }),
);