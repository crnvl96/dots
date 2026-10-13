#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { pathToFileURL, fileURLToPath } from "node:url";

const cursorWorkerPath = fileURLToPath(new URL("./demo-cursor-worker.mjs", import.meta.url));

const usage = `Usage:
  chrome-debug <url> [--port 9002] [--timeout 15]
  browser-demo <url> [--port 9002] [--session name]
               [--viewport 1440x900] [--scale 2] [--input-mode smooth]
               [--wait selector] [--timeout 15]
  browser-demo attach --tab <tab-id> [--port 9002] [--session name]
               [--input-mode smooth] [--wait selector]
  browser-demo screenshot <path.png> --session name [--wait selector] [--full]
  browser-demo record <path.mp4|path.webm> --session name [--fps 60] [--wait selector]
  browser-demo stop --session name

Demo setup uses dark mode, a pinned tab, and 2x device scale.
Fresh launches reuse the startup tab; attach never opens or navigates a tab.
Find existing tab ids: agent-browser --session name --cdp 9002 tab list
Recording includes a neon cursor, glow, and double-ring click burst.
CHROME_DEBUG_EXECUTABLE overrides the Chrome executable.
CHROME_DEBUG_STATE_DIR overrides ~/.local/state/agent-browser/chrome.
Timeout is Chrome startup time in seconds; page waits use agent-browser's timeout.`;

export function parseArgs(command, argv) {
  if (!["chrome-debug", "browser-demo"].includes(command)) throw new Error("Unknown command");
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const options = {
    command,
    port: 9002,
    timeout: 15,
    width: 1440,
    height: 900,
    scale: 2,
    inputMode: "smooth",
    fps: 60,
  };
  const positional = [];
  const supplied = new Set();
  const values = new Set([
    "--port",
    "--timeout",
    "--session",
    "--viewport",
    "--scale",
    "--input-mode",
    "--wait",
    "--fps",
    "--tab",
  ]);
  const allowed =
    command === "chrome-debug" ? new Set(["--port", "--timeout"]) : new Set([...values, "--full"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
    supplied.add(arg);
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    const key = { "--input-mode": "inputMode", "--wait": "wait" }[arg] || arg.slice(2);
    options[key] = value;
  }
  for (const [key, max] of [
    ["port", 65535],
    ["timeout", 300],
    ["fps", 60],
  ]) {
    if (
      !/^\d+$/.test(String(options[key])) ||
      Number(options[key]) < 1 ||
      Number(options[key]) > max
    )
      throw new Error(`${key} must be an integer between 1 and ${max}`);
    options[key] = Number(options[key]);
  }
  if (options.viewport) {
    const match = /^(\d+)x(\d+)$/.exec(options.viewport);
    if (!match) throw new Error("Viewport must have the form 1440x900");
    options.width = Number(match[1]);
    options.height = Number(match[2]);
  }
  if (options.width < 1 || options.height < 1 || options.width > 7680 || options.height > 7680)
    throw new Error("Viewport dimensions must be between 1 and 7680");
  options.scale = Number(options.scale);
  if (!Number.isFinite(options.scale) || options.scale < 1 || options.scale > 4)
    throw new Error("Scale must be between 1 and 4");
  if (!["instant", "smooth", "human"].includes(options.inputMode))
    throw new Error("Invalid input mode");
  if (options.session && !/^[a-zA-Z0-9_-]+$/.test(options.session))
    throw new Error("Invalid session name");
  if (options.session === "default")
    throw new Error("Use a named session, not the shared default session");
  if (command === "browser-demo" && positional[0] === "attach") {
    options.action = positional.shift();
    if (!options.tab || options.tab.startsWith("-"))
      throw new Error("Attach requires --tab <tab-id>; use agent-browser --cdp <port> tab list");
  } else if (command === "browser-demo" && ["screenshot", "record", "stop"].includes(positional[0])) {
    options.action = positional.shift();
    if (!options.session) throw new Error("Capture commands require --session name");
    if (options.action !== "stop") {
      options.path = positional.shift();
      if (!options.path) throw new Error("An output path is required");
      const extension = options.action === "screenshot" ? /\.png$/i : /\.(mp4|webm)$/i;
      if (!extension.test(options.path))
        throw new Error("Use .png for screenshots or .mp4/.webm for recordings");
      options.path = resolve(options.path);
    }
  } else {
    options.action = "open";
    options.url = positional.shift();
    if (!options.url) throw new Error("A URL is required");
    const url = new URL(options.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Use an http:// or https:// URL");
  }
  if (positional.length) throw new Error("Unexpected positional arguments");
  const actionFlags = {
    screenshot: ["--session", "--wait", "--full"],
    record: ["--session", "--wait", "--fps"],
    stop: ["--session"],
    attach: ["--port", "--session", "--tab", "--input-mode", "--wait"],
    open:
      command === "chrome-debug"
        ? ["--port", "--timeout"]
        : [...values].filter((flag) => !["--fps", "--tab"].includes(flag)),
  };
  for (const flag of supplied) {
    if (!actionFlags[options.action].includes(flag))
      throw new Error(`${flag} is not supported for ${options.action}`);
  }
  return options;
}

export function runBrowser(args) {
  return execFileSync("agent-browser", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    timeout: 35000,
  }).trim();
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function occupied(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.destroy();
      done(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(true));
  });
}

async function endpoint(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(1000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("CDP endpoint is not ready");
  const data = await response.json();
  if (!data.webSocketDebuggerUrl) throw new Error("Invalid CDP endpoint");
  return data.webSocketDebuggerUrl;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function ownedProcess(owner, profile, port) {
  if (!owner || !alive(owner.pid)) return false;
  try {
    const cmd = execFileSync("ps", ["-p", String(owner.pid), "-o", "command="], {
      encoding: "utf8",
    });
    return (
      cmd.includes(`--user-data-dir=${profile}`) && cmd.includes(`--remote-debugging-port=${port}`)
    );
  } catch {
    return false;
  }
}

export async function launchChrome(options, { navigateReuse = true } = {}) {
  const state = resolve(
    process.env.CHROME_DEBUG_STATE_DIR || join(homedir(), ".local/state/agent-browser/chrome"),
    String(options.port),
  );
  const profile = join(state, "profile");
  const ownerPath = join(state, "owner.json");
  const lock = join(state, "launch.lock");
  await mkdir(state, { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      `Another launch is in progress. If it was interrupted, remove ${lock} and retry.`,
    );
  }
  try {
    const executable =
      process.env.CHROME_DEBUG_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const args = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${options.port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    const owner = await readJson(ownerPath);
    const ours = ownedProcess(owner, profile, options.port);
    if (await occupied(options.port)) {
      if (!ours || owner.endpoint !== (await endpoint(options.port).catch(() => null)))
        throw new Error(
          `Port ${options.port} is occupied by a browser/service not owned by chrome-debug. Use another --port.`,
        );
      if (navigateReuse && options.url !== "about:blank")
        await startProcess(executable, [...args, options.url], state);
      return { reused: true, state, pid: owner.pid };
    }
    if (ours)
      throw new Error(
        `Managed Chrome is still running but CDP is unavailable; close that Chrome or use another --port. Log: ${join(state, "chrome.log")}`,
      );
    const pid = await startProcess(executable, [...args, options.url], state);
    // Save ownership immediately so a failed startup remains diagnosable.
    await writeFile(ownerPath, JSON.stringify({ pid, endpoint: null }), { mode: 0o600 });
    const deadline = Date.now() + options.timeout * 1000;
    while (Date.now() < deadline) {
      if (!alive(pid))
        throw new Error(`Chrome exited during startup. See ${join(state, "chrome.log")}`);
      const ws = await endpoint(options.port).catch(() => null);
      if (ws) {
        // CDP can become ready before Chrome creates its startup page. Connecting
        // agent-browser in that gap creates its own blank page, leaving two tabs.
        const targets = await fetch(`http://127.0.0.1:${options.port}/json/list`, {
          signal: AbortSignal.timeout(1000), redirect: "error",
        }).then((response) => response.json()).catch(() => []);
        if (!Array.isArray(targets) || !targets.some((target) => target.type === "page")) {
          await new Promise((done) => setTimeout(done, 100));
          continue;
        }
        if (!ownedProcess({ pid }, profile, options.port))
          throw new Error("Chrome process ownership changed during startup");
        await writeFile(ownerPath, JSON.stringify({ pid, endpoint: ws }), { mode: 0o600 });
        return { reused: false, state, pid };
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(
      `Chrome did not become ready within ${options.timeout}s. See ${join(state, "chrome.log")}`,
    );
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function startProcess(executable, args, state) {
  const log = await open(join(state, "chrome.log"), "a", 0o600);
  try {
    const child = spawn(executable, args, { detached: true, stdio: ["ignore", log.fd, log.fd] });
    await new Promise((done, reject) => {
      child.once("spawn", done);
      child.once("error", reject);
    });
    child.unref();
    return child.pid;
  } finally {
    await log.close();
  }
}

function demoSessionPath(session) {
  return resolve(
    process.env.CHROME_DEBUG_STATE_DIR || join(homedir(), ".local/state/agent-browser/chrome"),
    "sessions",
    `${session}.json`,
  );
}

async function saveDemoSession(session, settings) {
  const path = demoSessionPath(session);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(settings), { mode: 0o600 });
}

export async function prepareDemo(
  options,
  { run = runBrowser, launch = launchChrome, save = saveDemoSession } = {},
) {
  const session =
    options.session ||
    run(["session", "id", "--scope", "worktree", "--prefix", `demo-p${options.port}`]);
  if (!/^[a-zA-Z0-9_-]+$/.test(session) || session === "default")
    throw new Error("Could not derive a safe named session");
  // Attach must not launch Chrome, even when the requested endpoint is unavailable.
  const launched = options.action === "attach"
    ? null
    : await launch({ ...options, url: "about:blank" }, { navigateReuse: false });
  const flags = [
    "--session",
    session,
    "--cdp",
    String(options.port),
    "--input-mode",
    options.inputMode,
    "--pin-tab",
    "--color-scheme",
    "dark",
  ];
  const command = (...args) => run([...flags, ...args]);
  // A first attachment with --pin-tab creates a fresh tab by design. Discover
  // without pinning first, then explicitly bind the chosen tab and enable pinning.
  const discovered = run([
    ...flags.map((flag) => flag === "--pin-tab" ? "--no-pin-tab" : flag),
    "tab", "list", "--json",
  ]);
  if (options.action === "attach") {
    command("tab", options.tab); // Explicit selection, never an implicitly chosen tab.
  } else {
    if (launched?.reused === false) {
      // Only a fresh, owned launch has a startup tab we may safely reuse.
      const result = JSON.parse(discovered);
      const startup = result.data?.tabs?.find((tab) => tab.url === "about:blank");
      if (!result.success || !startup?.targetId)
        throw new Error("Could not identify the fresh Chrome startup tab; refusing to navigate another tab");
      command("tab", startup.targetId);
    } else {
      // Discovery bound an existing tab; now create exactly one isolated demo tab.
      command("tab", "new"); // Preserve every existing tab on reused Chrome.
    }
    command("set", "viewport", String(options.width), String(options.height), String(options.scale));
    command("set", "media", "dark");
    command("open", options.url);
  }
  waitReady(command, options.wait);
  await save(session, { port: options.port, inputMode: options.inputMode });
  return session;
}

function waitReady(command, selector) {
  command("wait", "--load", "domcontentloaded");
  if (selector) command("wait", selector);
  command(
    "eval",
    "(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()",
  );
}

export async function startCursor(port, targetId) {
  const child = spawn(process.execPath, [cursorWorkerPath, String(port), targetId], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Cursor worker startup timed out"));
    }, 6000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Cursor worker exited during startup")); });
    child.once("message", (message) => {
      clearTimeout(timer);
      if (!message.ready) {
        child.kill("SIGTERM");
        reject(new Error(message.error || "Cursor worker failed"));
      } else {
        child.unref();
        resolve(child.pid);
      }
    });
  });
}

export function stopCursor(pid, targetId) {
  if (!alive(pid)) return;
  const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (!cmd.includes(cursorWorkerPath) || !cmd.includes(targetId))
    throw new Error("Cursor worker ownership changed; refusing to stop an unrelated process");
  process.kill(pid, "SIGTERM");
}

export async function capture(
  options,
  run = runBrowser,
  load = (session) => readJson(demoSessionPath(session)),
  { start = startCursor, stop = stopCursor, save = saveDemoSession } = {},
) {
  const info = JSON.parse(run(["--session", options.session, "session", "info", "--json"]));
  if (!info.success || !info.data?.active)
    throw new Error(
      `Session ${options.session} is not active. Run browser-demo <url> --session ${options.session} first.`,
    );
  const settings = await load(options.session);
  if (
    !settings ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535 ||
    !["instant", "smooth", "human"].includes(settings.inputMode)
  )
    throw new Error(
      `Session ${options.session} has no valid demo connection settings. Run browser-demo <url> --session ${options.session} again.`,
    );
  const command = (...args) =>
    run([
      "--session",
      options.session,
      "--cdp",
      String(settings.port),
      "--input-mode",
      settings.inputMode,
      "--pin-tab",
      "--color-scheme",
      "dark",
      ...args,
    ]);
  if (options.action === "stop") {
    const result = command("record", "stop");
    if (settings.cursorPid && settings.cursorTargetId) {
      await stop(settings.cursorPid, settings.cursorTargetId);
      const { cursorPid, cursorTargetId, ...connection } = settings;
      await save(options.session, connection);
    }
    return result;
  }
  await mkdir(dirname(options.path), { recursive: true });
  waitReady(command, options.wait);
  if (options.action === "screenshot") {
    return command(
      "screenshot",
      options.path,
      "--screenshot-format",
      "png",
      ...(options.full ? ["--full"] : []),
    );
  }
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("Recording requires ffmpeg on PATH. Install it with brew install ffmpeg.");
  }
  const tabs = JSON.parse(command("tab", "list", "--json"));
  const active = tabs.data?.tabs?.find((tab) => tab.active);
  if (!tabs.success || !active?.targetId) throw new Error("Could not identify recording tab");
  if (settings.cursorPid)
    throw new Error("A demo recording is already configured; run browser-demo stop first");
  const cursorPid = await start(settings.port, active.targetId);
  try {
    await save(options.session, { ...settings, cursorPid, cursorTargetId: active.targetId });
    return command("record", "start", options.path, "--cursor", "--fps", String(options.fps));
  } catch (error) {
    await stop(cursorPid, active.targetId);
    await save(options.session, settings);
    throw error;
  }
}

export async function main(command, argv) {
  const options = parseArgs(command, argv);
  if (options.help) {
    console.log(usage);
    return;
  }
  if (command === "chrome-debug") {
    const result = await launchChrome(options);
    console.log(
      `Chrome ${result.reused ? "reused" : "ready"} on 127.0.0.1:${options.port}\nProfile: ${join(result.state, "profile")}`,
    );
    console.log(
      `Attach without a new tab: agent-browser --session chrome-p${options.port} --cdp ${options.port} --no-pin-tab tab list\nThen: browser-demo attach --port ${options.port} --session chrome-p${options.port} --tab <tab-id>\nKeep --cdp ${options.port} on subsequent agent-browser commands.`,
    );
  } else if (["open", "attach"].includes(options.action)) {
    const session = await prepareDemo(options);
    console.log(
      options.action === "attach"
        ? `Demo attached: ${session}; tab ${options.tab}; viewport unchanged; ${options.inputMode} pointer`
        : `Demo ready: ${session}\nViewport: ${options.width}x${options.height} @ ${options.scale}x; dark; ${options.inputMode} pointer`,
    );
    console.log(
      `export AGENT_BROWSER_SESSION=${session}\nexport AGENT_BROWSER_INPUT_MODE=${options.inputMode}\nagent-browser --session ${session} --cdp ${options.port} --pin-tab snapshot -i\nbrowser-demo screenshot ./page.png --session ${session}\nbrowser-demo record ./demo.mp4 --session ${session}\nbrowser-demo stop --session ${session}`,
    );
  } else {
    console.log(await capture(options));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv[2], process.argv.slice(3)).catch((error) => {
    console.error(`Error: ${error.stderr?.toString().trim() || error.message}`);
    process.exitCode = 1;
  });
}
