import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const siteRoot = path.join(repoRoot, "docs");
let server;

try {
  const fixture = await startStaticServer();
  server = fixture.server;

  const root = await fetchText(`${fixture.origin}/`);
  assert(root.status === 200, "Expected root route to load.", root);
  assert(root.body.includes("Clean, responsive"), "Expected root route to serve the Lumen landing page.", {
    sample: root.body.slice(0, 240)
  });

  const legacyDocs = await fetchText(`${fixture.origin}/docs/`);
  assert(legacyDocs.status === 200, "Expected legacy docs route to load.", legacyDocs);
  assert(legacyDocs.body.includes("Lumen moved to the root URL"), "Expected legacy docs route to explain the move.", {
    sample: legacyDocs.body.slice(0, 240)
  });
  assert(legacyDocs.body.includes("url=../"), "Expected legacy docs route to redirect one level up.", {
    sample: legacyDocs.body.slice(0, 240)
  });

  const notFound = await fetchText(`${fixture.origin}/missing-route`);
  assert(notFound.status === 404, "Expected missing routes to use the deployed 404 page.", notFound);
  assert(notFound.body.includes("/lumen-extension/"), "Expected 404 page to redirect to the public root URL.", {
    sample: notFound.body.slice(0, 240)
  });

  const socialCard = await fetchBytes(`${fixture.origin}/assets/proof-social-card.png`);
  assert(socialCard.status === 200, "Expected social image asset to load.", socialCard);
  assert(socialCard.bytes > 1024, "Expected social image asset to contain data.", socialCard);

  console.log(JSON.stringify({
    ok: true,
    origin: fixture.origin,
    checks: [
      "/",
      "/docs/",
      "/missing-route",
      "/assets/proof-social-card.png"
    ]
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startStaticServer() {
  const serverInstance = createServer(async (request, response) => {
    try {
      const filePath = resolveFilePath(request.url || "/");

      if (!filePath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const file = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": getContentType(filePath)
      });
      response.end(file);
    } catch (error) {
      if (error?.code === "ENOENT") {
        const fallback = await readFile(path.join(siteRoot, "404.html"));
        response.writeHead(404, {
          "Content-Type": "text/html; charset=utf-8"
        });
        response.end(fallback);
        return;
      }

      response.writeHead(500);
      response.end("Internal Server Error");
    }
  });

  await new Promise((resolve) => serverInstance.listen(0, "127.0.0.1", resolve));
  const address = serverInstance.address();

  return {
    server: serverInstance,
    origin: `http://127.0.0.1:${address.port}`
  };
}

function resolveFilePath(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const withIndex = normalized.endsWith("/") ? `${normalized}index.html` : normalized;
  const filePath = path.resolve(siteRoot, `.${withIndex}`);

  return filePath.startsWith(siteRoot) ? filePath : null;
}

async function fetchText(url) {
  const response = await fetch(url);

  return {
    status: response.status,
    body: await response.text()
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);

  return {
    status: response.status,
    bytes: (await response.arrayBuffer()).byteLength
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }

  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }

  if (ext === ".js") {
    return "text/javascript; charset=utf-8";
  }

  if (ext === ".png") {
    return "image/png";
  }

  if (ext === ".svg") {
    return "image/svg+xml";
  }

  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
