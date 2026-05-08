import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const siteRoots = [
  {
    name: "docs artifact root",
    root: path.join(repoRoot, "docs"),
    legacyDocsMode: "redirect",
    assetPath: "/assets/proof-social-card.png"
  },
  {
    name: "repository root",
    root: repoRoot,
    legacyDocsMode: "landing",
    assetPath: "/assets/proof-social-card.png"
  }
];
const results = [];

try {
  for (const target of siteRoots) {
    results.push(await runRouteChecks(target));
  }

  console.log(JSON.stringify({
    ok: true,
    results
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null
  }, null, 2));
  process.exitCode = 1;
}

async function runRouteChecks(target) {
  const fixture = await startStaticServer(target.root);

  try {
    const root = await fetchText(`${fixture.origin}/`);
    assert(root.status === 200, `Expected ${target.name} root route to load.`, root);
    assert(root.body.includes("Clean, responsive"), `Expected ${target.name} root route to serve the Lumen landing page.`, {
      sample: root.body.slice(0, 240)
    });

    const legacyDocs = await fetchText(`${fixture.origin}/docs/`);
    assert(legacyDocs.status === 200, `Expected ${target.name} legacy docs route to load.`, legacyDocs);

    if (target.legacyDocsMode === "redirect") {
      assert(legacyDocs.body.includes("Lumen moved to the root URL"), "Expected legacy docs route to explain the move.", {
        sample: legacyDocs.body.slice(0, 240)
      });
      assert(legacyDocs.body.includes("url=../"), "Expected legacy docs route to redirect one level up.", {
        sample: legacyDocs.body.slice(0, 240)
      });
    } else {
      assert(legacyDocs.body.includes("Clean, responsive"), "Expected repository-root docs route to serve the landing page.", {
        sample: legacyDocs.body.slice(0, 240)
      });
    }

    const notFound = await fetchText(`${fixture.origin}/missing-route`);
    assert(notFound.status === 404, `Expected ${target.name} missing routes to use the 404 page.`, notFound);
    assert(notFound.body.includes("/lumen-extension/"), `Expected ${target.name} 404 page to redirect to the public root URL.`, {
      sample: notFound.body.slice(0, 240)
    });

    const socialCard = await fetchBytes(`${fixture.origin}${target.assetPath}`);
    assert(socialCard.status === 200, `Expected ${target.name} social image asset to load.`, socialCard);
    assert(socialCard.bytes > 1024, `Expected ${target.name} social image asset to contain data.`, socialCard);

    return {
      name: target.name,
      origin: fixture.origin,
      checks: [
        "/",
        "/docs/",
        "/missing-route",
        target.assetPath
      ]
    };
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

async function startStaticServer(siteRoot) {
  const serverInstance = createServer(async (request, response) => {
    try {
      const filePath = resolveFilePath(request.url || "/", siteRoot);

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
    origin: `http://127.0.0.1:${address.port}`,
    siteRoot
  };
}

function resolveFilePath(requestUrl, siteRoot) {
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
