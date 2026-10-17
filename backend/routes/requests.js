const express = require("express");
const { Request, Resource } = require("../models");
const { authRequired, requireRole } = require("../middleware/auth");
const { logActivity, clean, isId, toInt } = require("../utils");

const router = express.Router();
router.use(authRequired);

// Teacher submits a request
router.post("/", requireRole("teacher"), async (req, res) => {
  let resource = null;
  let itemName = clean(req.body.itemName);
  const quantity = toInt(req.body.quantity, 1);
  const reason = clean(req.body.reason);
  const neededBy = clean(req.body.neededBy) || null;

  if (req.body.resourceId) {
    if (!isId(req.body.resourceId)) return res.status(400).json({ error: "Selected resource does not exist." });
    resource = await Resource.findById(req.body.resourceId);
    if (!resource) return res.status(400).json({ error: "Selected resource does not exist." });
    itemName = resource.name;
  }
  if (!itemName) return res.status(400).json({ error: "Please choose a resource or type the item name." });
  if (!(quantity >= 1)) return res.status(400).json({ error: "Quantity must be at least 1." });
  if (!reason || reason.length < 5) return res.status(400).json({ error: "Please give a short reason for the request." });

  const r = await Request.create({
    user: req.user.id, resource: resource ? resource._id : null,
    itemName, quantity, reason, neededBy: neededBy ? new Date(neededBy) : null,
  });
  await logActivity(req.user.id, "NEW_REQUEST", "request", r._id, `${req.user.name} requested ${quantity} × ${itemName}`);
  res.status(201).json({ request: r });
});

// My own requests
router.get("/mine", async (req, res) => {
  const requests = await Request.find({ user: req.user.id }).sort({ createdAt: -1 });
  res.json({ requests });
});

// Admin: all requests (pending first)
router.get("/", requireRole("admin"), async (_req, res) => {
  const list = await Request.find()
    .populate("user", "name email")
    .populate("reviewedBy", "name")
    .sort({ createdAt: -1 });
  list.sort((a, b) => (b.status === "pending") - (a.status === "pending"));
  res.json({ requests: list });
});

// Admin: approve / reject
// Approving a request for a listed resource takes the units out of the available stock.
router.patch("/:id", requireRole("admin"), async (req, res) => {
  const status = clean(req.body.status);
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Status must be approved or rejected." });
  if (!isId(req.params.id)) return res.status(404).json({ error: "Request not found." });

  const existing = await Request.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Request not found." });
  if (existing.status !== "pending") {
    return res.status(409).json({ error: `This request was already ${existing.status}.` });
  }

  // Take the units out of stock (only if enough are available)
  let stockNote = "";
  let deducted = false;
  if (status === "approved" && existing.resource) {
    const updated = await Resource.findOneAndUpdate(
      { _id: existing.resource, availableQty: { $gte: existing.quantity } },
      { $inc: { availableQty: -existing.quantity } },
      { new: true }
    );
    if (updated) {
      deducted = true;
      stockNote = ` (stock ${updated.availableQty + existing.quantity} → ${updated.availableQty})`;
    } else {
      const current = await Resource.findById(existing.resource);
      if (current) {
        return res.status(400).json({
          error: `Not enough stock: only ${current.availableQty} of "${current.name}" available, but ${existing.quantity} requested.`,
        });
      }
    }
  }

  const r = await Request.findOneAndUpdate(
    { _id: existing._id, status: "pending" },
    { status, adminNote: clean(req.body.adminNote) || undefined, reviewedBy: req.user.id, reviewedAt: new Date() },
    { new: true }
  );
  if (!r) {
    // someone else reviewed it at the same moment: give the stock back
    if (deducted) await Resource.updateOne({ _id: existing.resource }, { $inc: { availableQty: existing.quantity } });
    return res.status(409).json({ error: "This request was just reviewed by someone else." });
  }

  await logActivity(
    req.user.id,
    status === "approved" ? "APPROVE_REQUEST" : "REJECT_REQUEST",
    "request",
    r._id,
    `${status} request for ${r.itemName}${stockNote}`
  );
  res.json({ request: r });
});

module.exports = router;