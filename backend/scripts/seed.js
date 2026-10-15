/* Creates the default admin, demo users and sample resources.
   Run with:  npm run seed   (safe to re-run) */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const { User, Resource } = require("../models");

const RESOURCES = [
  ["Desktop PC (Dell OptiPlex)", "Computer", 40, 36, "Programming Lab 1", "working"],
  ["Desktop PC (Lenovo ThinkCentre)", "Computer", 30, 24, "Computer Lab 3", "working"],
  ["Laptop (HP ProBook)", "Computer", 15, 11, "Faculty Room", "working"],
  ["Projector (Epson EB-X05)", "Projector", 12, 9, "Lecture Hall A", "working"],
  ["Projector (BenQ MX550)", "Projector", 8, 2, "Seminar Room A", "needed"],
  ['Smart Board (Samsung 75")', "Digital Board", 4, 0, "Seminar Room B", "damaged"],
  ["Interactive Whiteboard (BenQ)", "Digital Board", 3, 3, "Lecture Hall B", "available"],
  ["Laser Printer (HP LaserJet)", "Printer", 6, 5, "Admin Office", "working"],
  ["All-in-One Printer (Canon)", "Printer", 4, 1, "CSE Office", "needed"],
  ["Arduino Uno R3 Kit", "Lab Equipment", 20, 4, "Electronics Lab", "needed"],
  ["Raspberry Pi 4 Kit", "Lab Equipment", 15, 10, "IoT Lab", "available"],
  ["Oscilloscope", "Lab Equipment", 6, 6, "Electronics Lab", "available"],
  ["Network Switch (24-port)", "Networking", 10, 8, "Server Room", "working"],
  ["Wireless Router (TP-Link)", "Networking", 12, 10, "Various Labs", "working"],
  ["Split AC (Midea 1.5 Ton)", "Appliance", 18, 15, "Various Rooms", "damaged"],
  ["Ceiling Fan", "Appliance", 45, 43, "Various Rooms", "working"],
  ["UPS (600VA)", "Appliance", 30, 26, "Various Labs", "working"],
  ["Student Chair", "Furniture", 120, 108, "Various Rooms", "available"],
  ["Lab Bench", "Furniture", 20, 18, "Various Labs", "available"],
  ["Whiteboard (Standard)", "Furniture", 9, 9, "Various Rooms", "available"],
].map(([name, category, totalQty, availableQty, location, status]) => ({ name, category, totalQty, availableQty, location, status }));

async function ensureUser(name, email, password, role) {
  email = email.toLowerCase();
  if (await User.findOne({ email })) return false;
  await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 10) });
  return true;
}

(async () => {
  try {
    await connectDB();
    console.log("✔ Connected to MongoDB");

    const adminEmail = process.env.ADMIN_EMAIL || "admin@pust.ac.bd";
    const created = await ensureUser(process.env.ADMIN_NAME || "CSE Admin", adminEmail, process.env.ADMIN_PASSWORD || "Admin@12345", "admin");
    console.log(created ? `✔ Admin created: ${adminEmail}` : "• Admin already exists");

    await ensureUser("Demo Teacher", "teacher@pust.ac.bd", "Teacher@123", "teacher");
    await ensureUser("Demo Student", "student@pust.ac.bd", "Student@123", "student");
    await ensureUser("Demo Staff", "staff@pust.ac.bd", "Staff@123", "staff");
    console.log("✔ Demo users ready");

    if ((await Resource.countDocuments()) === 0) {
      await Resource.insertMany(RESOURCES);
      console.log(`✔ ${RESOURCES.length} sample resources added`);
    } else {
      console.log("• Resources already exist, skipping sample data");
    }
    console.log("\nSeed complete. Start the server with:  npm start");
  } catch (e) {
    console.error("✖ Seed failed:", e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
