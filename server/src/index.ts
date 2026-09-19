import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { apiRouter } from "./routes/api.js";
import { attachWebSocketServer } from "./lib/eventBus.js";
import "./db/client.js"; // ensures schema is created on boot

// In a split deployment, restrict CORS to the deployed client's origin
// rather than leaving it wide open to any site. CLIENT_ORIGIN can be a
// single origin or a comma-separated list (e.g. a Vercel prod URL plus its
// preview-deployment URL). Left unset, CORS stays permissive — the right
// default for local dev, where the Vite proxy makes this moot anyway.
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin: allowedOrigins,
        }
      : undefined,
  ),
);
app.use(express.json());
app.use("/api", apiRouter);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
attachWebSocketServer(wss);

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`Darwin migration agent server listening on http://localhost:${port}`);
});
