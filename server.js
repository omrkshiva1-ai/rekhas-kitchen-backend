const express = require("express");
const mysql = require("mysql2");
require("dotenv").config();

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed to read the real visitor IP
app.use(express.json({ limit: "10kb" })); // reject oversized requests

// ---------------------------------------------------------
// CORS: only your real website may call this API
// ---------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://rekhaskitchen-1d4c52.netlify.app", // live website
  "http://127.0.0.1:5500",                    // Live Server (local testing)
  "http://localhost:5500"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------
// Database: a POOL reconnects automatically if the database
// was off or the connection dropped (a single connection doesn't).
// ---------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 20000
});

let tableReady = false;

// Creates the table if it doesn't exist. Runs at start-up AND before saving,
// so if the database was down at start-up it fixes itself later.
function ensureTable(callback) {
  if (tableReady) return callback(null);
  const createTable = `
    CREATE TABLE IF NOT EXISTS enquiries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      message TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  pool.query(createTable, (err) => {
    if (err) {
      console.error("Table check failed:", err.message);
      return callback(err);
    }
    tableReady = true;
    console.log("Enquiries table ready");
    callback(null);
  });
}

ensureTable(() => {});

// ---------------------------------------------------------
// Simple rate limit: max 5 enquiries per visitor per 10 minutes
// ---------------------------------------------------------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= 5) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

// ---------------------------------------------------------
// Routes
// ---------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Rekha's Kitchen backend is running.");
});

// Health check that also touches the database (keeps it awake; use this in UptimeRobot)
app.get("/health", (req, res) => {
  pool.query("SELECT 1", (err) => {
    if (err) return res.status(500).send("database not reachable");
    res.send("ok");
  });
});

// PRIVATE: view enquiries. Needs the secret ADMIN_KEY, e.g.
// https://rekhas-kitchen-backend.onrender.com/enquiries?key=YOUR_SECRET
app.get("/enquiries", (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || req.query.key !== adminKey) {
    return res.status(401).json({ error: "Not allowed" });
  }
  pool.query("SELECT * FROM enquiries ORDER BY submitted_at DESC", (error, results) => {
    if (error) {
      console.error("Read failed:", error.message);
      return res.status(500).json({ error: "Something went wrong" });
    }
    res.json(results);
  });
});

// PUBLIC: the Contact form sends its data here
app.post("/enquiries", (req, res) => {
  const { name, phone, message, website } = req.body || {};

  // Honeypot: real visitors never fill this hidden field, bots do
  if (website) return res.json({ message: "Received" });

  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many messages, please try again later" });
  }

  const cleanName = String(name || "").trim();
  const cleanPhone = String(phone || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanName || !cleanPhone) {
    return res.status(400).json({ error: "Name and phone are required" });
  }
  if (cleanName.length > 100 || cleanPhone.length > 20 || cleanMessage.length > 1000) {
    return res.status(400).json({ error: "Input too long" });
  }

  ensureTable((tableErr) => {
    if (tableErr) return res.status(500).json({ error: "Something went wrong" });

    pool.query(
      "INSERT INTO enquiries (name, phone, message) VALUES (?, ?, ?)",
      [cleanName, cleanPhone, cleanMessage],
      (error, results) => {
        if (error) {
          console.error("Save failed:", error.message);
          return res.status(500).json({ error: "Something went wrong" });
        }
        res.json({ message: "Enquiry received successfully", id: results.insertId });
      }
    );
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
