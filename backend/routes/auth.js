const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { User } = require("../models");
const { authRequired } = require("../middleware/auth");
const { logActivity, clean } = require("../utils");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELF_SIGNUP_ROLES = ["student", "teacher", "staff"]; // admin cannot self-register

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role });

function signToken(user) {
  return jwt.sign(publicUser(user), process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
}

router.post("/register", authLimiter, async (req, res) => {
  const name = clean(req.body.name);
  const email = String(clean(req.body.email) || "").toLowerCase();
  const password = String(req.body.password || "");
  const role = clean(req.body.role);

  if (!name || name.length < 2) return res.status(400).json({ error: "Please enter your full name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (!SELF_SIGNUP_ROLES.includes(role)) return res.status(400).json({ error: "Please choose Student, Teacher or Staff." });

  if (await User.findOne({ email })) return res.status(409).json({ error: "An account with this email already exists." });

  const user = await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 10) });
  await logActivity(user._id, "REGISTER", "user", user._id, `${name} registered as ${role}`);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/login", authLimiter, async (req, res) => {
  const email = String(clean(req.body.email) || "").toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const user = await User.findOne({ email });
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

  await logActivity(user._id, "LOGIN", "user", user._id, `${user.name} signed in`);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", authRequired, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: "Account no longer exists." });
  res.json({ user: publicUser(user) });
});

module.exports = router;
