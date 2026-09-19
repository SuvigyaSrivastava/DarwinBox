import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { apiRouter } from "./routes/api.js";
import { attachWebSocketServer } from "./lib/eventBus.js";
import "./db/client.js"; // ensures schema is created on boot

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", apiRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
attachWebSocketServer(wss);

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Darwin migration agent server listening on http://localhost:${port}`);
});
