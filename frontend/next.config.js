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

  /**
   * Rotas tipadas geram `.next/types/routes.d.ts`. Em Windows com pasta em OneDrive/`Documents`,
   * esse ficheiro falha frequentemente com EPERM → `next dev` rebenta. Desligar evita o problema;
   * perde-se apenas autocomplete em `<Link href={...}>` — aceitável neste repo.
   */
  typedRoutes: false,

  /** Garante que os CSV/JSON da landing entram no bundle serverless (fs em /api/landing/*). */
  outputFileTracingIncludes: {
    "/api/landing/freeze-cap15-backtest": ["./data/landing/**/*"],
    "/api/landing/core-overlayed": ["./data/landing/**/*"],
    /** Plano de aprovação (freeze + CSVs) em deploy Vercel com root `frontend/`. */
    "/api/client/approval-plan": ["../freeze/**/*", "../backend/data/**/*"],
    "/client/approve": ["../freeze/**/*", "../backend/data/**/*"],
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
   * O browser pede /favicon.ico por defeito. Rewrite serve o SVG na mesma resposta — evita 404 na consola.
   */
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/favicon.svg" }];
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
      /**
       * Persona Embedded Flow: o documento pai não deve negar câmara/microfone a origens Persona.
       * Inclui `self` para não restringir o próprio site. Ver documentação Persona (embedded-flow-security).
       */
      {
        source: "/persona-onboarding",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              'camera=(self "https://inquiry.withpersona.com" "https://inquiry.withpersona-staging.com" "https://canary.withpersona.com" "https://withpersona.com"); microphone=(self "https://inquiry.withpersona.com" "https://inquiry.withpersona-staging.com" "https://canary.withpersona.com" "https://withpersona.com")',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
