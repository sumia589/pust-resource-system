const express = require("express");
const { Resource, Report, Request, CATEGORIES, STATUSES } = require("../models");
const { authRequired, requireRole } = require("../middleware/auth");
const { logActivity, clean, isId, toInt } = require("../utils");

const router = express.Router();
router.use(authRequired);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// List / search / filter (all roles)
router.get("/", async (req, res) => {
  const filter = {};
  if (req.query.category && req.query.category !== "All") filter.category = String(req.query.category);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), "i");
    filter.$or = [{ name: rx }, { location: rx }, { category: rx }];
  }
  const resources = await Resource.find(filter).sort({ category: 1, name: 1 });
  res.json({ resources, categories: CATEGORIES, statuses: STATUSES });
});

router.get("/stats", async (_req, res) => {
  const all = await Resource.find({}, "totalQty availableQty");
  const total = all.reduce((s, r) => s + r.totalQty, 0);
  const available = all.reduce((s, r) => s + r.availableQty, 0);
  res.json({ total, available, inUseOrDamaged: total - available, types: all.length });
});

function validate(body) {
  const name = clean(body.name);
  const category = clean(body.category);
  const location = clean(body.location);
  const status = clean(body.status) || "working";
  const totalQty = toInt(body.totalQty);
  const availableQty = toInt(body.availableQty, totalQty);
  if (!name) return { error: "Resource name is required." };
  if (!CATEGORIES.includes(category)) return { error: "Invalid category." };
  if (!location) return { error: "Location is required." };
  if (!STATUSES.includes(status)) return { error: "Invalid status." };
  if (!(totalQty >= 0)) return { error: "Total quantity must be 0 or more." };
  if (!(availableQty >= 0) || availableQty > totalQty) return { error: "Available quantity must be between 0 and total." };
  return { value: { name, category, location, status, totalQty, availableQty, description: clean(body.description) || undefined } };
}

router.post("/", requireRole("admin"), async (req, res) => {
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  const r = await Resource.create(value);
  await logActivity(req.user.id, "ADD_RESOURCE", "resource", r._id, `Added "${r.name}" (${r.totalQty} units)`);
  res.status(201).json({ resource: r });
});

router.put("/:id", requireRole("admin"), async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Resource not found." });
  const { error, value } = validate(req.body);
  if (error) return res.status(400).json({ error });
  const r = await Resource.findByIdAndUpdate(req.params.id, value, { new: true, runValidators: true });
  if (!r) return res.status(404).json({ error: "Resource not found." });
  await logActivity(req.user.id, "UPDATE_RESOURCE", "resource", r._id, `Updated "${r.name}" → ${r.availableQty}/${r.totalQty} available, status ${r.status}`);
  res.json({ resource: r });
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: "Resource not found." });
  const r = await Resource.findByIdAndDelete(req.params.id);
  if (!r) return res.status(404).json({ error: "Resource not found." });
  await Report.deleteMany({ resource: r._id });
  await Request.updateMany({ resource: r._id }, { resource: null });
  await logActivity(req.user.id, "DELETE_RESOURCE", "resource", r._id, `Deleted "${r.name}"`);
  res.json({ ok: true });
});

module.exports = router;
