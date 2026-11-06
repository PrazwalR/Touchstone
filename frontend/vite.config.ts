/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { selectDeployment } from "./src/chain/selectDeployment.ts";

// The production page reads chain state from the configured RPC and history origins. Fonts are bundled locally
// (Geist) or served by Google. Development keeps Vite's hot-reload socket, so the policy is build-only.
function contentSecurityPolicy(rpcUrl: string, historyUrl?: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${new URL(rpcUrl).origin}${historyUrl ? ` ${new URL(historyUrl).origin}` : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "touchstone-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        "<!-- csp -->",
        `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
      ),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const selected = selectDeployment(env.VITE_CHAIN);
  const rpcUrl = env.VITE_RPC_URL || selected.publicRpc;
  return {
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(rpcUrl, env.VITE_HISTORY_URL || undefined),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: { target: "es2022", sourcemap: false },
    // The Docs view bundles these repository files. Only they are served from outside frontend/ in development:
    // never the repository root, which holds .env.
    server: {
      fs: {
        allow: [
          ".",
          "../docs",
          "../research/results",
          "../contracts/snapshots",
          "../DEPLOYMENTS.md",
        ],
      },
    },
    test: { environment: "node", include: ["test/**/*.test.ts"] },
  };
});
