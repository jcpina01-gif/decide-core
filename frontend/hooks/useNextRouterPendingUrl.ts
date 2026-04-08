import { useRouter } from "next/router";
import { useEffect, useState } from "react";

/** Caminho sem query — alinhado a `routeChangeStart` / `asPath`. */
export function pathOnlyFromRouteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      return new URL(url).pathname || url;
    } catch {
      /* fall through */
    }
  }
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

export function routePendingMatchesHref(href: string, pendingUrl: string | null): boolean {
  if (!pendingUrl) return false;
  return pathOnlyFromRouteUrl(pendingUrl) === pathOnlyFromRouteUrl(href);
}

/**
 * URL de destino durante `router.push` / clique em `<Link>` (entre `routeChangeStart` e `Complete`/`Error`).
 */
export function useNextRouterPendingUrl(): string | null {
  const router = useRouter();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    const onStart = (url: string) => setPendingUrl(url);
    const onEnd = () => setPendingUrl(null);
    router.events.on("routeChangeStart", onStart);
    router.events.on("routeChangeComplete", onEnd);
    router.events.on("routeChangeError", onEnd);
    return () => {
      router.events.off("routeChangeStart", onStart);
      router.events.off("routeChangeComplete", onEnd);
      router.events.off("routeChangeError", onEnd);
    };
  }, [router]);

  return pendingUrl;
}
