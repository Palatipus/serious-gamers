import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import registerRoutes from "./routes/register.js";

dotenv.config();

const app = express();

// ✅ Middleware
app.use(cors()); // allow all origins (you can restrict in production)
app.use(express.json());

// Get current directory (needed for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve frontend files
app.use(express.static(path.join(__dirname, "frontend")));

// ✅ API routes
app.use("/api", registerRoutes);

// ✅ Catch-all route for frontend routing (React/SPA support)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
