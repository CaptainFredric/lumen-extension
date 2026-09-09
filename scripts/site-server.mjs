import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const siteRoot = path.join(repoRoot, "docs");
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".zip": "application/zip",
};

// Preview exactly the folder deployed by Pages, never the extension's runtime.
export function createSiteServer() {
  return http.createServer(async (request, response) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, {
        "Cache-Control": "no-cache",
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      send(405, "Method Not Allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
    } catch {
      send(400, "Bad Request");
      return;
    }
    const indexed = pathname.endsWith("/") ? pathname + "index.html" : pathname;
    const filePath = path.resolve(siteRoot, "." + indexed);
    const relative = path.relative(siteRoot, filePath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.includes("\0")
    ) {
      send(403, "Forbidden");
      return;
    }
    try {
      const file = await fs.readFile(filePath);
      send(
        200,
        file,
        types[path.extname(filePath)] || "application/octet-stream",
      );
    } catch (error) {
      if (["ENOENT", "EISDIR", "ENOTDIR"].includes(error.code)) {
        send(
          404,
          await fs.readFile(path.join(siteRoot, "404.html")),
          types[".html"],
        );
      } else {
        send(500, "Internal Server Error");
      }
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "4173", 10);
  const server = createSiteServer();
  server.on("error", (error) => {
    console.error(
      `Lumen preview could not start: ${error.message}. Set PORT to an available port.`,
    );
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `Lumen site available at http://${host}:${server.address().port}/`,
    ),
  );
}
