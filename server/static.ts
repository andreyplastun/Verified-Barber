import { mastersLandingHtml } from "./masters-landing-html";
import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const index = fs.readFileSync(path.join(distPath, "index.html"), "utf8");
  app.get(/^\/specialists\/?$/, (req, res) => {
    res.set("Cache-Control", "private, no-store").type("html").send(mastersLandingHtml(index, req.originalUrl));
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
