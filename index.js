require("dotenv").config(); // Load environment variables
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json()); // Remove bodyParser as express.json() is enough
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection (Using Environment Variables)
const pool = new Pool({
    connectionString:
        process.env.DATABASE_URL ||
        "postgresql://neondb_owner:npg_2ACaFxZUqs7J@ep-icy-star-a5rqk9iz-pooler.us-east-2.aws.neon.tech/iot_data?sslmode=require",
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false, // Conditional SSL setup
});

// ✅ API for Signup (Updates user for specific device_id)
app.put("/api/signup", async (req, res) => {
    const { email, password, device_id } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: "Device ID is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const result = await pool.query(
            `UPDATE users 
             SET email = $1, password = $2 
             WHERE device_id = $3 
             RETURNING *`,
            [email, hashedPassword, device_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Device ID not found" });
        }

        const { password: _, ...userSafeData } = result.rows[0]; // Remove password from response
        res.status(200).json({ message: "User updated successfully", user: userSafeData });
    } catch (error) {
        console.error("Signup update error:", error);
        res.status(500).json({ error: "Error updating user" });
    }
});

// ✅ API for Login (Returns user & device_id)
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Missing email or password" });
        }

        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (!user.rows.length) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // Compare hashed password
        const isPasswordValid = await bcrypt.compare(password, user.rows[0].password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const { password: _, ...userSafeData } = user.rows[0]; // Remove password from response
        res.json({ message: "Login successful", device_id: userSafeData.device_id });
    } catch (error) {
        console.error("❌ Server Error:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ✅ API to store sensor data (Now includes device_id)
app.post("/api/data", async (req, res) => {
    const { device_id, temperature, humidity, air_quality, lpg_level } = req.body;

    if (!device_id || temperature === undefined || humidity === undefined || air_quality === undefined || lpg_level === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const query = `
            INSERT INTO sensor_data (device_id, temperature, humidity, air_quality, lpg_level, timestamp) 
            VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`;
        const values = [device_id, temperature, humidity, air_quality, lpg_level];

        const result = await pool.query(query, values);
        res.status(201).json({ message: "Data stored successfully", data: result.rows[0] });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to store data" });
    }
});

// ✅ API to fetch all sensor data for a specific device_id (latest first)
app.get("/api/data/:device_id", async (req, res) => {
    const { device_id } = req.params;

    try {
        const result = await pool.query(
            "SELECT * FROM sensor_data WHERE device_id = $1 ORDER BY timestamp DESC",
            [device_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

// ✅ API to fetch the latest sensor data for a specific device_id
app.get("/api/data/latest/:device_id", async (req, res) => {
    const { device_id } = req.params;

    try {
        const result = await pool.query(
            "SELECT * FROM sensor_data WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1",
            [device_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No data available" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to fetch latest data" });
    }
});

// ✅ API to fetch historical data filtered by date for a specific device_id
app.get("/api/data/history/:device_id", async (req, res) => {
    try {
        const { device_id } = req.params;
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: "Date parameter is required" });
        }

        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setUTCHours(23, 59, 59, 999);

        const query = `
            SELECT * FROM sensor_data 
            WHERE device_id = $1 AND timestamp >= $2 AND timestamp <= $3 
            ORDER BY timestamp ASC`;

        const result = await pool.query(query, [
            device_id,
            startDate.toISOString(),
            endDate.toISOString(),
        ]);

        if (result.rows.length === 0) {
            return res.json({ message: "No data available for the selected date." });
        }

        res.json(result.rows);
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to fetch historical data" });
    }
});

// ✅ API for Admin Signup
app.post("/api/signup/admin", async (req, res) => {
    const { email, password, device_id } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: "Device ID is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const result = await pool.query(
            `INSERT INTO users (device_id, email, password)
             VALUES ($1, $2, $3)
             ON CONFLICT (device_id) 
             DO UPDATE SET email = EXCLUDED.email, password = EXCLUDED.password
             RETURNING *`,
            [device_id, email, hashedPassword]
        );

        const { password: _, ...userSafeData } = result.rows[0]; // Remove password from response
        res.status(200).json({ message: "User created/updated successfully", user: userSafeData });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ error: "Error processing signup" });
    }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
