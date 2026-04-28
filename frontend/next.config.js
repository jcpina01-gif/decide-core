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

/**
 * `../freeze` no *output file tracing* cria ficheiros sob `.next/trace/freeze/`. No Windows, com
 * o repo em OneDrive/Documentos (ou antivírus) isso dispara muitas vezes
 * `EPERM: scandir '.next\\trace\\freeze'`. Em Linux (Vercel) o mesmo *glob* funciona. Para
 * forçar o *trace* do *freeze* no Windows, define `DECIDE_WIN_FREEZE_TRACE=1` (caminho fora
 * de OneDrive ajuda) ou muda a pasta de *build* com `NEXT_DIST_DIR` para um disco local.
 */
const shouldIncludeFreezeInOutputTrace =
  process.platform !== "win32" || String(process.env.DECIDE_WIN_FREEZE_TRACE || "").trim() === "1";

const traceFreezeGlobs = shouldIncludeFreezeInOutputTrace ? ["../freeze/**/*"] : [];

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

  /**
   * Expõe o commit de build no cliente (Vercel define `VERCEL_GIT_COMMIT_SHA`). Permite ver na caixa
   * de teste do plano se o browser carregou o JavaScript do deploy recente; sem isto, cache a parecer «nada mudou».
   */
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "",
  },

  /** Garante que os CSV/JSON da landing entram no bundle serverless (fs em /api/landing/*). */
  outputFileTracingIncludes: {
    /** Lê `../freeze/.../model_outputs` (mesmo padrão que /api/client/plan-decision-kpis); sem isto, em Vercel só o landing entra no *trace* e o gráfico cai a 15-04. */
    "/api/landing/freeze-cap15-backtest": [...traceFreezeGlobs, "./data/landing/**/*"],
    "/api/landing/core-overlayed": ["./data/landing/**/*"],
    /** Plano de aprovação (freeze + CSVs) em deploy Vercel com root `frontend/`. */
    "/api/client/approval-plan": [...traceFreezeGlobs, "../backend/data/**/*"],
    "/api/client/plan-decision-kpis": [...traceFreezeGlobs, "../backend/data/**/*"],
    /** Histórico de pesos + SSR do relatório leem `weights_by_rebalance*` (mesmo merge que o API). */
    "/api/client/recommendations-history": [...traceFreezeGlobs, "../backend/data/**/*"],
    "/client/approve": [...traceFreezeGlobs, "../backend/data/**/*"],
    "/client/report": [
      ...traceFreezeGlobs,
      "../backend/data/**/*",
      "./data/landing/freeze-cap15/**/*",
    ],
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  /**
   * Em Windows o `next build` pode parecer «congelado» minutos sem linhas no ecrã.
   * ProgressPlugin mostra % webpack (útil para distinguir compilação lenta de bloqueio a 0% CPU).
   */
  webpack: (config, { dev, webpack: webpackMod }) => {
    if (!dev) {
      let lastPct = -1;
      config.plugins.push(
        new webpackMod.ProgressPlugin((p, message) => {
          const pct = Math.floor(p * 100);
          if (pct >= 100 || pct <= 0 || pct - lastPct >= 3) {
            lastPct = pct;
            console.log(`[next build] webpack ${pct}% ${message || ""}`);
          }
        }),
      );
    }
    return config;
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
      /** HTML do relatório sem cache agressivo — ajuda o browser a apanhar JS novo após deploy. */
      {
        source: "/client/report",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
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
