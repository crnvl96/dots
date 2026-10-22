import { createRequire } from "node:module";
import { closeSync, existsSync, openSync, readSync, realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type GlimpseModule = {
  open: (html: string, options?: { width?: number; height?: number; title?: string }) => GlimpseWindow;
  getNativeHostInfo: () => { path: string; platform: string; buildHint: string };
};

function machArch(path: string): "arm64" | "x64" | "universal" | undefined {
  const fd = openSync(path, "r");
  const header = Buffer.alloc(8);
  try {
    if (readSync(fd, header, 0, 8, 0) < 8) return undefined;
  } finally {
    closeSync(fd);
  }

  const magic = header.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xbebafeca) return "universal";

  const little = header.readUInt32LE(0);
  const isLittle = little === 0xfeedfacf || little === 0xfeedface;
  const isBig = magic === 0xfeedfacf || magic === 0xfeedface;
  if (!isLittle && !isBig) return undefined;

  const cpu = (isLittle ? header.readUInt32LE(4) : header.readUInt32BE(4)) & ~0x01000000;
  if (cpu === 12) return "arm64";
  if (cpu === 7) return "x64";
  return undefined;
}

function loadGlimpse(): { glimpse: GlimpseModule } | { reason: string } {
  let glimpse: GlimpseModule;
  try {
    // Pi loads this file through ~/.pi/agent/extensions, which has no node_modules.
    glimpse = createRequire(realpathSync(__filename))("glimpseui");
  } catch {
    return {
      reason: "glimpseui is not installed. Run npm install in home/.pi of this dotfiles checkout.",
    };
  }

  let host: ReturnType<GlimpseModule["getNativeHostInfo"]>;
  try {
    host = glimpse.getNativeHostInfo();
  } catch (error) {
    return { reason: error instanceof Error ? error.message : "Glimpse is not available on this platform." };
  }

  if (host.platform !== "linux-chromium" && !existsSync(host.path)) {
    return { reason: `Glimpse binary is missing. ${host.buildHint}` };
  }

  if (process.platform === "darwin" && existsSync(host.path)) {
    const arch = machArch(host.path);
    if (arch && arch !== "universal" && arch !== process.arch) {
      return {
        reason: `Glimpse binary is ${arch}, but this Mac is ${process.arch}. In home/.pi, allow glimpseui's install script and run npm rebuild glimpseui (needs swiftc).`,
      };
    }
  }

  return { glimpse };
}

type GlimpseWindow = {
  setHTML: (html: string) => void;
  show: (options?: { title?: string }) => void;
  on: (event: "closed", listener: () => void) => void;
};

const html = `<!doctype html>
<html>
  <head>
    <style>
      :root { color-scheme: light dark; }
      /* Rosé Pine Dawn */
      :root, :root[data-theme="rose-pine-dawn"] {
        --rp-base: #faf4ed;
        --rp-surface: #fffaf3;
        --rp-text: #575279;
        --rp-iris: #907aa9;
      }
      /* Rosé Pine */
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="rose-pine-dawn"]) {
          --rp-base: #191724;
          --rp-surface: #1f1d2e;
          --rp-text: #e0def4;
          --rp-iris: #c4a7e7;
        }
      }
      :root[data-theme="rose-pine"] {
        --rp-base: #191724;
        --rp-surface: #1f1d2e;
        --rp-text: #e0def4;
        --rp-iris: #c4a7e7;
      }
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        background: var(--rp-base);
        color: var(--rp-text);
        font-family: system-ui, sans-serif;
      }
      h1 {
        margin: 0;
        color: var(--rp-iris);
        font-weight: 500;
        font-size: 2rem;
      }
    </style>
    <script>
      const query = matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        document.documentElement.dataset.theme = query.matches ? "rose-pine" : "rose-pine-dawn";
      };
      apply();
      query.addEventListener("change", apply);
    </script>
  </head>
  <body>
    <h1>hello world</h1>
  </body>
</html>`;

let window: GlimpseWindow | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("review", {
    description: "Show hello world in a Glimpse window",
    handler: async (_args, ctx) => {
      const loaded = loadGlimpse();
      if ("reason" in loaded) {
        ctx.ui.notify(loaded.reason, "error");
        return;
      }

      if (window) {
        window.setHTML(html);
        window.show({ title: "review" });
        return;
      }

      try {
        window = loaded.glimpse.open(html, { width: 420, height: 240, title: "review" });
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Could not open Glimpse.", "error");
        return;
      }

      window.on("error", (error: Error) => {
        window = undefined;
        ctx.ui.notify(error.message, "error");
      });
      window.on("closed", () => {
        window = undefined;
      });
    },
  });
}
