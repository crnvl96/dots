// Keep the page CDP connection alive: Chrome removes init scripts when the
// connection that registered them disconnects. Owned by one demo recording.
import { readFile } from "node:fs/promises";

const [port, targetId] = process.argv.slice(2);
let socket, identifier;
let stopping = false;
const pending = new Map();
let nextId = 0;
const startupTimer = setTimeout(() => fail(new Error("Cursor startup timed out")), 5000);

function fail(error) {
  if (process.connected) process.send({ error: error.message });
  socket?.close();
  process.exitCode = 1;
  clearTimeout(startupTimer);
  if (process.connected) process.disconnect();
}
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(0), 2000);
  try {
    if (identifier && socket.readyState === WebSocket.OPEN)
      await request("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  } finally {
    socket?.close();
    clearTimeout(deadline);
    process.exit(0);
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

try {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1000), redirect: "error",
  });
  const target = (await response.json()).find((tab) => tab.id === targetId && tab.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Recording tab is no longer available");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  socket.addEventListener("close", () => process.exit(0));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Cursor CDP connection failed")), { once: true });
  });
  await request("Page.enable", {});
  const installed = await request("Page.addScriptToEvaluateOnNewDocument", {
    source: await readFile(new URL("./demo-cursor.js", import.meta.url), "utf8"),
    worldName: "browser-demo-cursor",
    runImmediately: true,
  });
  identifier = installed.identifier;
  if (!identifier) throw new Error("Cursor script returned no identifier");
  clearTimeout(startupTimer);
  process.send({ ready: true });
  process.disconnect();
} catch (error) {
  fail(error);
}
