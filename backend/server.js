require("dotenv").config();
require("express-async-errors");
const path = require("path");
const express = require("express");
const connectDB = require("./config/db");

if (!process.env.JWT_SECRET) {
  console.error("✖ JWT_SECRET is missing. Copy .env.example to .env and set it.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/resources", require("./routes/resources"));
app.use("/api/requests", require("./routes/requests"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Serve the frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error. Please try again." });
});

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`✔ MongoDB connected\n✔ Server running → http://localhost:${PORT}`)))
  .catch((e) => {
    console.error("✖ Cannot connect to MongoDB:", e.message);
    console.error("  Make sure MongoDB is running and MONGODB_URI in .env is correct.");
    process.exit(1);
  });
