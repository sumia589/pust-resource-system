const mongoose = require("mongoose");
const { Schema } = mongoose;

// Clean JSON output: _id -> id, hide internals
const toJSON = {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
};

const CATEGORIES = ["Computer", "Projector", "Digital Board", "Printer", "Lab Equipment", "Networking", "Appliance", "Furniture"];
const STATUSES = ["available", "working", "damaged", "needed"];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["student", "teacher", "staff", "admin"], default: "student" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON }
);

const resourceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    totalQty: { type: Number, required: true, min: 0, default: 1 },
    availableQty: { type: Number, required: true, min: 0, default: 1 },
    location: { type: String, required: true, trim: true, maxlength: 150 },
    status: { type: String, enum: STATUSES, default: "working", index: true },
    description: { type: String, trim: true, maxlength: 255 },
  },
  { timestamps: true, toJSON }
);

const requestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    resource: { type: Schema.Types.ObjectId, ref: "Resource", default: null },
    itemName: { type: String, required: true, trim: true, maxlength: 150 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    neededBy: { type: Date, default: null },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    adminNote: { type: String, trim: true, maxlength: 255 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON }
);

const reportSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    resource: { type: Schema.Types.ObjectId, ref: "Resource", required: true },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open", index: true },
    adminNote: { type: String, trim: true, maxlength: 255 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON }
);

// Records / history of everything that happens
const activitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: null },
    details: { type: String, maxlength: 250 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON }
);

module.exports = {
  User: mongoose.model("User", userSchema),
  Resource: mongoose.model("Resource", resourceSchema),
  Request: mongoose.model("Request", requestSchema),
  Report: mongoose.model("Report", reportSchema),
  Activity: mongoose.model("Activity", activitySchema),
  CATEGORIES,
  STATUSES,
};
