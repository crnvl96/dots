import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm, access, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, prepareDemo, capture, launchChrome } from "./cli.mjs";

const url = "http://localhost:3000/path?q=hello%20world&mode=demo";

test("defaults and overrides", () => {
  const defaults = parseArgs("browser-demo", [url]);
  assert.equal(defaults.port, 9002);
  assert.equal(defaults.scale, 2);
  assert.equal(defaults.inputMode, "smooth");
  assert.equal(defaults.fps, 60);
  const options = parseArgs("browser-demo", [
    url,
    "--port",
    "9222",
    "--viewport",
    "1920x1080",
    "--scale",
    "1.5",
    "--input-mode",
    "smooth",
    "--session",
    "demo",
  ]);
  assert.equal(options.port, 9222);
  assert.equal(options.width, 1920);
  assert.equal(options.height, 1080);
  assert.equal(options.scale, 1.5);
  assert.equal(options.inputMode, "smooth");
  assert.equal(options.url, url);
  assert.deepEqual(parseArgs("chrome-debug", ["--help"]), { help: true });
});

test("CLI entry point works when seeded as a symlink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-symlink-test-"));
  try {
    const link = join(dir, "cli.mjs");
    await symlink(fileURLToPath(new URL("./cli.mjs", import.meta.url)), link);
    const output = execFileSync(process.execPath, [link, "browser-demo", "--help"], {
      encoding: "utf8",
    });
    assert.match(output, /Usage:/);
    assert.match(output, /--port 9002/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid arguments fail before launch", () => {
  for (const args of [
    [],
    ["file:///tmp/a"],
    [url, "extra"],
    [url, "--unknown"],
    [url, "--port"],
    [url, "--port", "0"],
    [url, "--port", "65536"],
    [url, "--port", "1.5"],
    [url, "--timeout", "0"],
    [url, "--scale", "NaN"],
    [url, "--viewport", "0x900"],
    [url, "--viewport", "1440,900"],
    [url, "--input-mode", "humane"],
    [url, "--session", "default"],
    [url, "--session", "../bad"],
    [url, "--fps", "60"],
    [url, "--tab", "t1"],
    ["attach"],
    ["attach", url, "--tab", "t1"],
    ["attach", "--tab", "t1", "--viewport", "1440x900"],
    ["attach", "--tab", "t1", "--timeout", "15"],
    ["record", "a.mp4"],
    ["record", "a.png", "--session", "demo"],
    ["record", "a.mp4", "--session", "demo", "--fps", "61"],
    ["screenshot", "a.png", "--session", "demo", "--port", "9002"],
    ["stop", "--session", "demo", "--wait", "body"],
  ]) {
    assert.throws(() => parseArgs("browser-demo", args), undefined, args.join(" "));
  }
  assert.throws(() => parseArgs("chrome-debug", [url, "--session", "demo"]));
});

function mockBrowser() {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      if (args[0] === "session") return "demo-p9002-worktree";
      if (args.includes("info")) return JSON.stringify({ success: true, data: { active: true } });
      if (args.includes("list")) return JSON.stringify({ success: true, data: { tabs: [
        { active: true, targetId: "test-target", tabId: "t1", url: "about:blank" },
      ] } });
      return "ok";
    },
  };
}

test("reused Chrome gets a new tab, configured before navigation", async () => {
  const mock = mockBrowser();
  const options = parseArgs("browser-demo", [url, "--session", "demo", "--wait", "#ready"]);
  let launchArgs;
  let saved;
  const session = await prepareDemo(options, {
    run: mock.run,
    launch: async (...args) => {
      launchArgs = args;
      return { reused: true };
    },
    save: async (...args) => {
      saved = args;
    },
  });
  assert.equal(session, "demo");
  assert.equal(launchArgs[0].url, "about:blank");
  assert.deepEqual(launchArgs[1], { navigateReuse: false });
  assert.deepEqual(saved, ["demo", { port: 9002, inputMode: "smooth" }]);
  const actions = mock.calls.map((args) => args.slice(9));
  assert.deepEqual(actions.slice(0, 5), [
    ["tab", "list", "--json"],
    ["tab", "new"],
    ["set", "viewport", "1440", "900", "2"],
    ["set", "media", "dark"],
    ["open", url],
  ]);
  assert.deepEqual(actions[5], ["wait", "--load", "domcontentloaded"]);
  assert.deepEqual(actions[6], ["wait", "#ready"]);
  assert.match(actions[7][1], /document.fonts.ready/);
  assert.equal(mock.calls[0][6], "--no-pin-tab");
  for (const args of mock.calls.slice(1))
    assert.deepEqual(args.slice(0, 9), [
      "--session",
      "demo",
      "--cdp",
      "9002",
      "--input-mode",
      "smooth",
      "--pin-tab",
      "--color-scheme",
      "dark",
    ]);
});

test("fresh Chrome reuses its explicit startup target without an extra tab", async () => {
  const mock = mockBrowser();
  await prepareDemo(parseArgs("browser-demo", [url, "--session", "demo"]), {
    launch: async () => ({ reused: false }),
    save: async () => {},
    run(args) {
      const result = mock.run(args);
      if (args.includes("list")) return JSON.stringify({ success: true, data: { tabs: [
        { targetId: "existing-page", url: "https://example.com" },
        { targetId: "startup-target", url: "about:blank" },
      ] } });
      return result;
    },
  });
  const actions = mock.calls.map((args) => args.slice(9));
  assert.deepEqual(actions.slice(0, 2), [
    ["tab", "list", "--json"], ["tab", "startup-target"],
  ]);
  assert.equal(actions.some((args) => args[0] === "tab" && args[1] === "new"), false);
  assert.equal(actions.filter((args) => args[0] === "open").length, 1);
});

test("fresh Chrome fails closed if its startup target cannot be identified", async () => {
  const mock = mockBrowser();
  await assert.rejects(prepareDemo(parseArgs("browser-demo", [url, "--session", "demo"]), {
    launch: async () => ({ reused: false }),
    save: async () => { throw new Error("must not save"); },
    run(args) {
      mock.run(args);
      return JSON.stringify({ success: true, data: { tabs: [] } });
    },
  }), /startup tab/);
  assert.equal(mock.calls.some((args) => args.includes("open")), false);
});

test("attach selects an existing tab without launching, opening, or resizing", async () => {
  const mock = mockBrowser();
  let saved;
  const options = parseArgs("browser-demo", ["attach", "--tab", "t2", "--session", "demo"]);
  assert.equal(options.action, "attach");
  const session = await prepareDemo(options, {
    run: mock.run,
    launch: async () => { throw new Error("attach must not launch Chrome"); },
    save: async (...args) => { saved = args; },
  });
  assert.equal(session, "demo");
  assert.deepEqual(saved, ["demo", { port: 9002, inputMode: "smooth" }]);
  const actions = mock.calls.map((args) => args.slice(9));
  assert.deepEqual(actions[0], ["tab", "list", "--json"]);
  assert.equal(mock.calls[0][6], "--no-pin-tab");
  assert.deepEqual(actions[1], ["tab", "t2"]);
  assert.equal(mock.calls[1][6], "--pin-tab");
  assert.equal(actions.some((args) => ["open", "set"].includes(args[0])), false);
  assert.equal(actions.some((args) => args[0] === "tab" && args[1] === "new"), false);
});

test("attach failure never falls back to opening a tab", async () => {
  const mock = mockBrowser();
  await assert.rejects(prepareDemo(
    parseArgs("browser-demo", ["attach", "--tab", "missing", "--session", "demo"]), {
      run(args) {
        mock.run(args);
        if (args.at(-1) === "missing") throw new Error("Unknown tab");
        return "ok";
      },
      launch: async () => { throw new Error("must not launch"); },
      save: async () => { throw new Error("must not save"); },
    },
  ), /Unknown tab/);
  assert.equal(mock.calls.length, 2);
});

test("automatic session is scoped to worktree and port", async () => {
  const mock = mockBrowser();
  const session = await prepareDemo(parseArgs("browser-demo", [url]), {
    run: mock.run,
    launch: async () => {},
    save: async () => {},
  });
  assert.equal(session, "demo-p9002-worktree");
  assert.deepEqual(mock.calls[0], [
    "session",
    "id",
    "--scope",
    "worktree",
    "--prefix",
    "demo-p9002",
  ]);
});

test("demo persists connection settings for capture on a non-default port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-session-test-"));
  const previous = process.env.CHROME_DEBUG_STATE_DIR;
  process.env.CHROME_DEBUG_STATE_DIR = dir;
  try {
    const mock = mockBrowser();
    await prepareDemo(
      parseArgs("browser-demo", [
        url,
        "--session",
        "demo",
        "--port",
        "9222",
        "--input-mode",
        "smooth",
      ]),
      { run: mock.run, launch: async () => {} },
    );
    assert.deepEqual(JSON.parse(await readFile(join(dir, "sessions", "demo.json"), "utf8")), {
      port: 9222,
      inputMode: "smooth",
    });
    await capture(parseArgs("browser-demo", ["stop", "--session", "demo"]), mock.run);
    assert.deepEqual(mock.calls.at(-1), [
      "--session",
      "demo",
      "--cdp",
      "9222",
      "--input-mode",
      "smooth",
      "--pin-tab",
      "--color-scheme",
      "dark",
      "record",
      "stop",
    ]);
  } finally {
    if (previous === undefined) delete process.env.CHROME_DEBUG_STATE_DIR;
    else process.env.CHROME_DEBUG_STATE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("readiness failure prevents further commands", async () => {
  const mock = mockBrowser();
  await assert.rejects(
    prepareDemo(parseArgs("browser-demo", [url, "--session", "demo", "--wait", "#ready"]), {
      launch: async () => {},
      save: async () => {
        throw new Error("must not save failed setup");
      },
      run: (args) => {
        if (args.at(-1) === "#ready") throw new Error("not ready");
        return mock.run(args);
      },
    }),
    /not ready/,
  );
  assert.equal(
    mock.calls.some((args) => args.includes("eval")),
    false,
  );
});

test("screenshot helper preserves paths, waits, and requests PNG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-capture-"));
  try {
    const mock = mockBrowser();
    const path = join(dir, "with spaces", "page.png");
    const options = parseArgs("browser-demo", [
      "screenshot",
      path,
      "--session",
      "demo",
      "--wait",
      "button",
      "--full",
    ]);
    await capture(options, mock.run, async () => ({ port: 9222, inputMode: "smooth" }));
    assert.deepEqual(mock.calls[0], ["--session", "demo", "session", "info", "--json"]);
    for (const args of mock.calls.slice(1))
      assert.deepEqual(args.slice(0, 9), [
        "--session",
        "demo",
        "--cdp",
        "9222",
        "--input-mode",
        "smooth",
        "--pin-tab",
        "--color-scheme",
        "dark",
      ]);
    assert.deepEqual(mock.calls.at(-1).slice(9), [
      "screenshot",
      resolve(path),
      "--screenshot-format",
      "png",
      "--full",
    ]);
    await access(join(dir, "with spaces"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recording installs neon effects on current and future documents at 60 fps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-record-test-"));
  try {
    const mock = mockBrowser();
    const path = join(dir, "demo.mp4");
    let saved;
    await capture(parseArgs("browser-demo", ["record", path, "--session", "demo"]),
      mock.run, async () => ({ port: 9002, inputMode: "smooth" }), {
        start: async (port, targetId) => {
          assert.equal(port, 9002);
          assert.equal(targetId, "test-target");
          return 123;
        },
        save: async (...args) => { saved = args; },
      });
    assert.deepEqual(saved, ["demo", {
      port: 9002, inputMode: "smooth", cursorPid: 123, cursorTargetId: "test-target",
    }]);
    const source = await readFile(new URL("./demo-cursor.js", import.meta.url), "utf8");
    assert.match(source, /MutationObserver/);
    assert.match(source, /event.isTrusted/);
    assert.match(source, /ring second/);
    assert.deepEqual(mock.calls.at(-1).slice(9), [
      "record", "start", resolve(path), "--cursor", "--fps", "60",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop cleans up its cursor worker and saved recording metadata", async () => {
  const mock = mockBrowser();
  let stopped, saved;
  await capture(parseArgs("browser-demo", ["stop", "--session", "demo"]), mock.run,
    async () => ({ port: 9002, inputMode: "smooth", cursorPid: 123, cursorTargetId: "test-target" }), {
      stop: async (...args) => { stopped = args; },
      save: async (...args) => { saved = args; },
    });
  assert.deepEqual(stopped, [123, "test-target"]);
  assert.deepEqual(saved, ["demo", { port: 9002, inputMode: "smooth" }]);
});

test("failed recording start cleans up its cursor worker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-record-failure-"));
  try {
    const mock = mockBrowser();
    let stopped;
    const saved = [];
    await assert.rejects(capture(
      parseArgs("browser-demo", ["record", join(dir, "test.mp4"), "--session", "demo"]),
      (args) => {
        if (args.includes("record") && args.includes("start")) throw new Error("record failed");
        return mock.run(args);
      },
      async () => ({ port: 9002, inputMode: "smooth" }), {
        start: async () => 123,
        stop: async (...args) => { stopped = args; },
        save: async (...args) => { saved.push(args); },
      },
    ), /record failed/);
    assert.deepEqual(stopped, [123, "test-target"]);
    assert.deepEqual(saved.at(-1), ["demo", { port: 9002, inputMode: "smooth" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("capture refuses an inactive session without launching a browser", async () => {
  const calls = [];
  const options = parseArgs("browser-demo", ["stop", "--session", "missing"]);
  await assert.rejects(
    capture(options, (args) => {
      calls.push(args);
      return '{"success":true,"data":{"active":false}}';
    }),
    /not active/,
  );
  assert.equal(calls.length, 1);
});

test("stop recording does not navigate or wait", async () => {
  const mock = mockBrowser();
  await capture(parseArgs("browser-demo", ["stop", "--session", "demo"]), mock.run, async () => ({
    port: 9002,
    inputMode: "human",
  }));
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(mock.calls.at(-1).slice(9), ["record", "stop"]);
});

test("capture refuses missing or invalid connection settings without browser commands", async () => {
  for (const settings of [
    null,
    {},
    { port: 0, inputMode: "human" },
    { port: 9002, inputMode: "bad" },
  ]) {
    const mock = mockBrowser();
    await assert.rejects(
      capture(
        parseArgs("browser-demo", ["stop", "--session", "demo"]),
        mock.run,
        async () => settings,
      ),
      /no valid demo connection settings/,
    );
    assert.equal(mock.calls.length, 1);
  }
});

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

// A local fake Chrome verifies real process ownership/startup checks without a browser.
async function withFakeChrome(callback) {
  const dir = await mkdtemp(join(tmpdir(), "browser-launch-test-"));
  const previous = {
    state: process.env.CHROME_DEBUG_STATE_DIR,
    executable: process.env.CHROME_DEBUG_EXECUTABLE,
  };
  const fixture = join(dir, "fake-chrome.mjs");
  const executable = join(dir, "chrome");
  await writeFile(
    fixture,
    `import {createServer} from 'node:http';
const port = Number(process.argv.find(a=>a.startsWith('--remote-debugging-port=')).split('=')[1]);
if (process.env.FAKE_CHROME_TIMEOUT) { setInterval(()=>{},1000); }
else { createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify(q.url === '/json/list' ? [{type:'page',id:'startup',url:'about:blank'}] : {webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/test'}));}).listen(port,'127.0.0.1'); }
`,
  );
  await writeFile(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, {
    mode: 0o755,
  });
  process.env.CHROME_DEBUG_STATE_DIR = join(dir, "state with spaces");
  process.env.CHROME_DEBUG_EXECUTABLE = executable;
  const port = await freePort();
  const options = { port, timeout: 2, url: "about:blank" };
  try {
    await callback(options, join(process.env.CHROME_DEBUG_STATE_DIR, String(port)));
  } finally {
    try {
      const owner = JSON.parse(
        await readFile(
          join(process.env.CHROME_DEBUG_STATE_DIR, String(port), "owner.json"),
          "utf8",
        ),
      );
      process.kill(owner.pid, "SIGTERM");
    } catch {
      /* Startup may fail before writing ownership. */
    }
    if (previous.state === undefined) delete process.env.CHROME_DEBUG_STATE_DIR;
    else process.env.CHROME_DEBUG_STATE_DIR = previous.state;
    if (previous.executable === undefined) delete process.env.CHROME_DEBUG_EXECUTABLE;
    else process.env.CHROME_DEBUG_EXECUTABLE = previous.executable;
    await rm(dir, { recursive: true, force: true });
  }
}

test("launcher waits for CDP and reuses only its owned process", async () => {
  await withFakeChrome(async (options, state) => {
    const first = await launchChrome(options);
    assert.equal(first.reused, false);
    const second = await launchChrome(options);
    assert.equal(second.reused, true);
    assert.equal(second.pid, first.pid);
    const ownerPath = join(state, "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    try {
      await writeFile(ownerPath, JSON.stringify({ ...owner, endpoint: "ws://different" }));
      await assert.rejects(launchChrome(options), /not owned/);
      await writeFile(ownerPath, JSON.stringify({ ...owner, pid: process.pid }));
      await assert.rejects(launchChrome(options), /not owned/);
    } finally {
      await writeFile(ownerPath, JSON.stringify(owner));
    }
  });
});

test("launcher rejects an unrelated listener without starting Chrome", async () => {
  await withFakeChrome(async (options, state) => {
    const server = createServer((request, response) => response.end("not Chrome"));
    await new Promise((done) => server.listen(options.port, "127.0.0.1", done));
    try {
      await assert.rejects(launchChrome(options), /not owned/);
      await assert.rejects(access(join(state, "owner.json")));
      await assert.rejects(access(join(state, "launch.lock")));
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

test("launcher fails with a bounded timeout and releases its lock", async () => {
  process.env.FAKE_CHROME_TIMEOUT = "1";
  try {
    await withFakeChrome(async (options, state) => {
      const start = Date.now();
      await assert.rejects(launchChrome({ ...options, timeout: 1 }), /within 1s/);
      assert.ok(Date.now() - start < 3000);
      await assert.rejects(access(join(state, "launch.lock")));
    });
  } finally {
    delete process.env.FAKE_CHROME_TIMEOUT;
  }
});

test("missing executable fails and releases its lock", async () => {
  await withFakeChrome(async (options, state) => {
    process.env.CHROME_DEBUG_EXECUTABLE = "/nonexistent/dotfiles-chrome";
    await assert.rejects(launchChrome(options), /ENOENT/);
    await assert.rejects(access(join(state, "launch.lock")));
  });
});
