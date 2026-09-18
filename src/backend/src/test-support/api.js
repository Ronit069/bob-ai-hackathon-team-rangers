// API test helpers — kept under src/ so Node's test discovery does not run this file.
import { createApp } from "../app.js";
import { config } from "../common/config.js";

export async function startTestServer(db, { aiProvider = null } = {}) {
  // Tests must not depend on the developer's local .env: Bob starts from the frozen
  // contract default (disabled) unless a test explicitly enables it.
  config.bobEnabled = false;
  const app = createApp({ db, aiProvider });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function api(baseUrl, path, { method = "GET", body, rawBody } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}
