const express = require("express");
const mysql = require("mysql2");
const path = require("path");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.json());
// Allow requests from your live website (CORS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // for now, allow any site to call this API
  res.header("Access-Control-Allow-Methods", "GET, POST");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// MySQL Connection (Aiven requires a secure/SSL connection)
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false  }
});

// Connect to MySQL
connection.connect((error) => {
  if (error) {
    console.error("Database connection failed:", error);
    return;
  }
  console.log("Connected to MySQL Database (Aiven)");

  // Create the enquiries table automatically if it doesn't exist yet
  const createTable = `
    CREATE TABLE IF NOT EXISTS enquiries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      message TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  connection.query(createTable, (err) => {
    if (err) console.error("Failed to create table:", err);
    else console.log("Enquiries table ready");
  });
});

// Health check — useful to confirm the server is alive
app.get("/", (req, res) => {
  res.send("Rekha's Kitchen backend is running.");
});

// =====================================
// GET - View all enquiries (simple admin view)
// =====================================
app.get("/enquiries", (req, res) => {
  const query = "SELECT * FROM enquiries ORDER BY submitted_at DESC";
  connection.query(query, (error, results) => {
    if (error) {
      return res.status(500).json({ error: "Something went wrong" });
    }
    res.json(results);
  });
});

// =====================================
// POST - Submit a new enquiry (from the Contact form)
// =====================================
app.post("/enquiries", (req, res) => {
  const { name, phone, message } = req.body;

  // Basic honeypot spam check: if the hidden field is filled, silently ignore it
  if (req.body.website) {
    return res.json({ message: "Received" }); // pretend success, don't save spam
  }

  // Basic validation
  if (!name || !phone) {
    return res.status(400).json({ error: "Name and phone are required" });
  }

  const query = `
    INSERT INTO enquiries (name, phone, message)
    VALUES (?, ?, ?)
  `;
  connection.query(query, [name, phone, message || ""], (error, results) => {
    if (error) {
      return res.status(500).json({ error: "Something went wrong" });
    }
    res.json({
      message: "Enquiry received successfully",
      id: results.insertId
    });
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
