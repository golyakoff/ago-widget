/**
 * `15-11`: a static file server for the gate, and nothing else.
 *
 * Ten lines of `node:http` rather than a dependency. The two consoles get their server for free -
 * they are Vite apps and `vite preview` already exists - but this repository builds with `esbuild`
 * through `build.mjs` and has no server of its own, and adding one (`serve`, `http-server`) would be
 * a production dependency's worth of supply chain for the sake of `GET` on eight files.
 *
 * Serves the repository root, so `demo/index.html`'s own `../dist/ago-chat.js` resolves exactly as it
 * does when a developer opens that page by hand. That matters: this gate measures the widget as the
 * demo page loads it, not as some gate-only harness loads it.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.UX_GATE_PORT ?? 4180);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  // `normalize` plus the prefix check keeps `../` out of the path. This server only ever runs on a
  // developer's or a runner's own machine against this repository, but a traversal here would read
  // arbitrary files from it, and refusing costs one line.
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const target = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`ux-gate static server on http://127.0.0.1:${PORT}`);
});
