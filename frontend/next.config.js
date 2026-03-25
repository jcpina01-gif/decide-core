/**
 * Pasta de build (default `.next`).
 *
 * O distDir tem de ficar DENTRO de `frontend/` — se estiver fora (ex. AppData ou ../next-cache),
 * o Node resolve `require("react/...")` a partir do .js compilado e não encontra `node_modules`
 * → "Cannot find module 'react/jsx-dev-runtime'".
 *
 * EPERM em `.next/trace` (OneDrive): usa `scripts/next-trace-eperm-workaround.cjs` no npm run dev.
 *
 * NEXT_DIST_DIR só é aceite se, resolvido, continuar dentro de `frontend/` (ex. `.next-build`).
 */
const path = require("path");

const projectDir = __dirname;

function resolveDistDir() {
  if (process.env.DECIDE_NEXT_DIST_IN_PROJECT === "1") {
    return ".next";
  }
  const raw =
    process.env.NEXT_DIST_DIR != null && String(process.env.NEXT_DIST_DIR).trim() !== ""
      ? String(process.env.NEXT_DIST_DIR).trim()
      : "";
  if (!raw) {
    return ".next";
  }
  const resolved = path.resolve(projectDir, raw);
  const proj = path.resolve(projectDir);
  const prefix = proj + path.sep;
  if (resolved !== proj && !resolved.startsWith(prefix)) {
    console.warn(
      "[next.config] NEXT_DIST_DIR must stay inside the frontend folder (Node needs node_modules next to the build tree). Using .next",
    );
    return ".next";
  }
  return raw.split(path.sep).join("/");
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: resolveDistDir(),
  reactStrictMode: false,
  pageExtensions: ["tsx", "ts", "jsx", "js"],

  /** Garante que os CSV/JSON da landing entram no bundle serverless (fs em /api/landing/*). */
  outputFileTracingIncludes: {
    "/api/landing/freeze-cap15-backtest": ["./data/landing/**/*"],
    "/api/landing/core-overlayed": ["./data/landing/**/*"],
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  async redirects() {
    return [
      {
        source: "/client/dashboard",
        destination: "/client-dashboard",
        permanent: false,
      },
    ];
  },

  /**
   * Páginas /embed/* são iframed pelo kpi_server (Flask :5000). Garantir que podem ser embebidas
   * (alguns proxies / futuras políticas podem restringir; frame-ancestors * = qualquer origem pai).
   */
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
