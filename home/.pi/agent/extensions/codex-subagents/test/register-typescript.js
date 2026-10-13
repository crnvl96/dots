import { registerHooks } from "node:module";

const extensionRoot = new URL("../", import.meta.url).href;

// Preserve the extension's compiled-style imports when testing its TS source in Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error.code !== "ERR_MODULE_NOT_FOUND" ||
        !context.parentURL?.startsWith(extensionRoot) ||
        !(specifier.startsWith("./") || specifier.startsWith("../")) ||
        !specifier.endsWith(".js")
      ) {
        throw error;
      }
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});
