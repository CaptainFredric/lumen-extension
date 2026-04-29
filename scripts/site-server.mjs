import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const resolveFilePath = (requestUrl) => {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const withIndex = normalizedPath.endsWith("/") ? `${normalizedPath}index.html` : normalizedPath;
  const absolutePath = path.resolve(repoRoot, `.${withIndex}`);

  if (!absolutePath.startsWith(repoRoot)) {
    return null;
  }

  return absolutePath;
};

const send = (response, statusCode, body, contentType) => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-cache",
    "Content-Type": contentType,
  });
  response.end(body);
};

const server = http.createServer(async (request, response) => {
  try {
    const filePath = resolveFilePath(request.url ?? "/");
    if (!filePath) {
      send(response, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }

    const fileBuffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    send(response, 200, fileBuffer, contentType);
  } catch (error) {
    const fallbackPath = path.join(repoRoot, "404.html");

    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      try {
        const fallback = await fs.readFile(fallbackPath);
        send(response, 404, fallback, "text/html; charset=utf-8");
      } catch {
        send(response, 404, "Not Found", "text/plain; charset=utf-8");
      }
      return;
    }

    send(response, 500, "Internal Server Error", "text/plain; charset=utf-8");
  }
});

server.listen(port, host, () => {
  console.log(`Lumen site available at http://${host}:${port}/`);
});
