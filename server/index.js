import express from "express";
import fs from "node:fs";
import { router } from "./routes.js";
import { scan } from "./indexer.js";
import { DIST_DIR } from "./paths.js";
import { HOST, PORT, isLoopback, ensureToken, runtime } from "./config.js";
import { requireToken } from "./auth.js";
import { lanAddress, bonjourHost } from "./net.js";

export function createApp({ token = null } = {}) {
  const app = express();
  app.use(express.json());

  if (token) app.use(requireToken(token));

  app.use("/api", router);

  if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile("index.html", { root: DIST_DIR });
    });
  } else {
    app.get("/", (req, res) =>
      res
        .status(503)
        .type("text")
        .send("The UI has not been built yet. Run `npm run build` in the install directory.")
    );
  }

  app.use((err, req, res, next) => {
    console.error("[api]", err);
    res.status(500).json({ error: err.message || "Server error" });
  });

  return app;
}

/**
 * A loopback bind is only reachable from this Mac, so it stays token-free.
 * Any other bind is on the network and gets the token gate.
 */
export async function startServer({ host = HOST, port = PORT } = {}) {
  const exposed = !isLoopback(host);
  const token = exposed ? ensureToken() : null;
  runtime.exposed = exposed;
  const app = createApp({ token });

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });

  scan().catch((err) => console.error("[scan]", err));

  const ip = exposed ? lanAddress() : null;
  return {
    server,
    host,
    port,
    token,
    exposed,
    localUrl: `http://localhost:${port}`,
    lanUrl: ip ? `http://${ip}:${port}` : null,
    bonjourUrl: exposed && bonjourHost() ? `http://${bonjourHost()}:${port}` : null,
  };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const info = await startServer();
  console.log(`claude-sessions → ${info.localUrl}`);
  if (info.lanUrl) console.log(`             LAN → ${info.lanUrl}/?token=${info.token}`);
}
