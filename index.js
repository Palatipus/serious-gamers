import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import playerRoutes from "./routes/players.js";
import tournamentRoutes from "./routes/tournaments.js";
import groupRoutes from "./routes/groups.js";
import matchRoutes from "./routes/matches.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "frontend")));
app.use("/api", playerRoutes);
app.use("/api", tournamentRoutes);
app.use("/api", groupRoutes);
app.use("/api", matchRoutes);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
