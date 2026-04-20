import http from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.LUMEN_API_PORT || 8787);

const defaultStore = {
  sessions: [],
  captures: []
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      return respondJson(response, 204, null);
    }

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return respondJson(response, 200, {
        ok: true,
        service: "lumen-api"
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/session") {
      const store = await readStore();
      const session = findSession(store, request.headers["x-lumen-session"]);

      return respondJson(response, 200, {
        session: session || null,
        meta: {
          backendReachable: true
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/session/demo") {
      const store = await readStore();
      const body = await readJsonBody(request);
      const session = {
        id: `remote-${crypto.randomUUID()}`,
        plan: "pro",
        user: {
          name: body?.name || "Lumen Explorer",
          email: "demo@lumen.app"
        },
        createdAt: new Date().toISOString()
      };

      store.sessions = [session, ...store.sessions.filter((entry) => entry.id !== session.id)];
      await writeStore(store);

      return respondJson(response, 200, {
        session,
        meta: {
          backendReachable: true
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/session/logout") {
      return respondJson(response, 200, {
        ok: true
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/captures") {
      const store = await readStore();
      const session = findSession(store, request.headers["x-lumen-session"]);
      const captures = session
        ? store.captures.filter((entry) => entry.sessionId === session.id)
        : [];

      return respondJson(response, 200, {
        captures
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/captures") {
      const store = await readStore();
      const session = findSession(store, request.headers["x-lumen-session"]);
      const body = await readJsonBody(request);

      if (!session) {
        return respondJson(response, 401, {
          error: "Missing or invalid session."
        });
      }

      const capture = {
        ...body,
        sessionId: session.id
      };

      store.captures = [capture, ...store.captures].slice(0, 200);
      await writeStore(store);

      return respondJson(response, 201, {
        capture
      });
    }

    return respondJson(response, 404, {
      error: "Not found."
    });
  } catch (error) {
    return respondJson(response, 500, {
      error: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Lumen API listening on http://127.0.0.1:${PORT}`);
});

async function readStore() {
  await mkdir(DATA_DIR, {
    recursive: true
  });

  if (!existsSync(DATA_FILE)) {
    await writeFile(DATA_FILE, JSON.stringify(defaultStore, null, 2));
    return structuredClone(defaultStore);
  }

  const raw = await readFile(DATA_FILE, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(defaultStore, null, 2));
    return structuredClone(defaultStore);
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, {
    recursive: true
  });

  await writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}

function findSession(store, sessionId) {
  if (!sessionId) {
    return null;
  }

  return store.sessions.find((session) => session.id === sessionId) || null;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let payload = "";

    request.on("data", (chunk) => {
      payload += chunk;
    });

    request.on("end", () => {
      if (!payload) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(payload));
      } catch (error) {
        reject(new Error("Request body was not valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, x-lumen-session",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });

  response.end(payload === null ? "" : JSON.stringify(payload));
}
