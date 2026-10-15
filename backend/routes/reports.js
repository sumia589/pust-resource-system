const express = require("express");
const { Report, Resource } = require("../models");
const { authRequired, requireRole } = require("../middleware/auth");
const { logActivity, clean, isId } = require("../utils");

const router = express.Router();
router.use(authRequired);

// Any signed-in user can report a problem
router.post("/", async (req, res) => {
  const priority = clean(req.body.priority) || "medium";
  const description = clean(req.body.description);
  if (!["low", "medium", "high"].includes(priority)) return res.status(400).json({ error: "Invalid priority." });
  if (!description || description.length < 5) return res.status(400).json({ error: "Please describe the problem." });
  if (!isId(req.body.resourceId)) return res.status(400).json({ error: "Please choose a valid resource." });
  const resource = await Resource.findById(req.body.resourceId);
  if (!resource) return res.status(400).json({ error: "Please choose a valid resource." });

  const r = await Report.create({ user: req.user.id, resource: resource._id, priority, description });
  await logActivity(req.user.id, "NEW_REPORT", "report", r._id, `${req.user.name} reported a ${priority}-priority problem on ${resource.name}`);
  res.status(201).json({ report: r });
});

router.get("/mine", async (req, res) => {
  const reports = await Report.find({ user: req.user.id }).populate("resource", "name").sort({ createdAt: -1 });
  res.json({ reports });
});

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

router.get("/", requireRole("admin"), async (_req, res) => {
  const list = await Report.find()
    .populate("resource", "name location")
    .populate("user", "name role")
    .populate("resolvedBy", "name")
    .sort({ createdAt: -1 });
  list.sort((a, b) =>
    (a.status === "resolved") - (b.status === "resolved") || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );
  res.json({ reports: list });
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const status = clean(req.body.status);
  if (!["open", "in_progress", "resolved"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  if (!isId(req.params.id)) return res.status(404).json({ error: "Report not found." });
  const resolved = status === "resolved";
  const r = await Report.findByIdAndUpdate(
    req.params.id,
    {
      status,
      adminNote: clean(req.body.adminNote) || undefined,
      resolvedBy: resolved ? req.user.id : null,
      resolvedAt: resolved ? new Date() : null,
    },
    { new: true }
  ).populate("resource", "name");
  if (!r) return res.status(404).json({ error: "Report not found." });
  await logActivity(req.user.id, "UPDATE_REPORT", "report", r._id, `Report on ${r.resource ? r.resource.name : "resource"} marked ${status.replace("_", " ")}`);
  res.json({ report: r });
});

module.exports = router;
