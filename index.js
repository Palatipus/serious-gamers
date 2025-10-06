import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import registerRoutes from "./routes/register.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Get current directory (needed for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend files from the "frontend" folder
app.use(express.static(path.join(__dirname, "frontend")));

// API routes
app.use("/api", registerRoutes);

// Catch-all route to serve index.html for unknown routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
