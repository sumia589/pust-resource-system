const express = require("express");
const { User, Resource, Report, Request, Activity } = require("../models");
const { authRequired, requireRole } = require("../middleware/auth");

const { buildReport } = require("../services/report");

const router = express.Router();
router.use(authRequired, requireRole("admin"));

const DAY = 24 * 60 * 60 * 1000;

// Counters for sidebar badges
router.get("/summary", async (_req, res) => {
  const [pendingRequests, openReports] = await Promise.all([
    Request.countDocuments({ status: "pending" }),
    Report.countDocuments({ status: { $ne: "resolved" } }),
  ]);
  res.json({ pendingRequests, openReports });
});

// Records: full activity history
router.get("/activity", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const activity = await Activity.find().populate("user", "name role").sort({ createdAt: -1 }).limit(limit);
  res.json({ activity });
});

router.get("/users", async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json({ users });
});

/* Recommendations — rule-based for now.
   This is the place where a real AI / ML service can be plugged in later. */
router.get("/suggestions", async (_req, res) => {
  const out = [];
  const resources = await Resource.find();

  const lowIds = new Set();
  for (const r of resources) {
    if (r.totalQty > 0 && r.status !== "damaged" && r.availableQty / r.totalQty <= 0.25) {
      lowIds.add(String(r._id));
      const pct = Math.round((r.availableQty / r.totalQty) * 100);
      out.push({ tone: "warn", title: `${r.name} is running low`, body: `Only ${r.availableQty} of ${r.totalQty} units are available (${pct}%). Consider procuring more to meet demand.` });
    }
  }
  for (const r of resources) {
    if (r.status === "damaged") {
      out.push({ tone: "danger", title: `${r.name} is damaged`, body: `Located in ${r.location}. This resource is marked damaged. Schedule repair or replacement urgently.` });
    } else if (r.status === "needed" && !lowIds.has(String(r._id))) {
      out.push({ tone: "warn", title: `${r.name} is marked as needed`, body: `More units of this resource are required (${r.availableQty} of ${r.totalQty} currently available).` });
    }
  }

  const highOpen = await Report.find({ priority: "high", status: { $ne: "resolved" } }).populate("resource", "name");
  if (highOpen.length) {
    const names = [...new Set(highOpen.map((h) => (h.resource ? h.resource.name : "Unknown resource")))];
    out.push({ tone: "danger", title: `${highOpen.length} high-priority report${highOpen.length > 1 ? "s" : ""} still open`, body: `These need immediate attention: ${names.join(", ")}.` });
  }

  const since = new Date(Date.now() - 30 * DAY);
  const recentReports = await Report.find({ createdAt: { $gte: since } }).populate("resource", "name");
  const perResource = {};
  for (const p of recentReports) {
    if (!p.resource) continue;
    perResource[p.resource.name] = (perResource[p.resource.name] || 0) + 1;
  }
  Object.entries(perResource)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n]) =>
      out.push({ tone: "warn", title: `${name} reported ${n} times this month`, body: "Repeated complaints suggest a deeper fault. Consider a full inspection or replacement." })
    );

  const pending = await Request.countDocuments({ status: "pending" });
  if (pending) {
    out.push({ tone: "neutral", title: `${pending} resource request${pending > 1 ? "s" : ""} awaiting review`, body: "Review pending teacher requests in the Admin Panel to keep classes running smoothly." });
  }

  const recentRequests = await Request.find({ createdAt: { $gte: since } });
  const demand = {};
  for (const q of recentRequests) {
    const d = (demand[q.itemName] ||= { users: new Set(), qty: 0 });
    d.users.add(String(q.user));
    d.qty += q.quantity;
  }
  Object.entries(demand)
    .filter(([, d]) => d.users.size >= 2)
    .forEach(([name, d]) =>
      out.push({ tone: "neutral", title: `High demand: ${name}`, body: `${d.users.size} different teachers requested it recently (${d.qty} units in total). Consider increasing stock.` })
    );

  if (!out.length) out.push({ tone: "ok", title: "Everything looks healthy", body: "No low stock, damaged resources or urgent reports right now." });
  res.json({ suggestions: out });
});

// Full analysis report (health score, purchase priorities, hotspots, ...)
router.get("/report", async (_req, res) => {
  res.json(await buildReport());
});

module.exports = router;
