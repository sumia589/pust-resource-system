const mongoose = require("mongoose");
const { Activity } = require("./models");

async function logActivity(userId, action, entity, entityId, details) {
  try {
    await Activity.create({
      user: userId || null,
      action,
      entity,
      entityId: entityId ? String(entityId) : null,
      details: details ? String(details).slice(0, 250) : undefined,
    });
  } catch (e) {
    console.error("Activity log failed:", e.message);
  }
}

const clean = (v) => (typeof v === "string" ? v.trim() : v);
const isId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;
const toInt = (v, fallback = NaN) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = { logActivity, clean, isId, toInt };
