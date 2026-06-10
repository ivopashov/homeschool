const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = __dirname;
const port = Number(process.env.PORT || 3001);

loadLocalEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  if (request.url.startsWith("/api/")) {
    await handleApi(request, response);
    return;
  }

  const urlPath = decodeURIComponent(request.url.split("?")[0]);
  const filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
});

async function handleApi(request, nativeResponse) {
  const apiName = request.url.split("?")[0].replace("/api/", "");
  const apiPath = path.join(root, "api", `${apiName}.js`);

  if (!fs.existsSync(apiPath)) {
    nativeResponse.writeHead(404, { "Content-Type": "application/json" });
    nativeResponse.end(JSON.stringify({ error: "API route not found" }));
    return;
  }

  request.body = await readJson(request);
  request.url = request.url || "";
  const mod = await import(pathToFileURL(apiPath).href);
  const handler = mod.default || mod;
  const response = createResponse(nativeResponse);
  await handler(request, response);
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function createResponse(nativeResponse) {
  let statusCode = 200;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      nativeResponse.writeHead(statusCode, { "Content-Type": "application/json" });
      nativeResponse.end(JSON.stringify(payload));
    },
    end(payload = "") {
      nativeResponse.writeHead(statusCode);
      nativeResponse.end(payload);
    },
  };
}

server.listen(port, () => {
  console.log(`Summer Adventure OS running at http://localhost:${port}`);
});

function loadLocalEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key] && value) {
      process.env[key] = value;
    }
  }
}
