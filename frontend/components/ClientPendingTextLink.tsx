import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import InlineLoadingDots from "./InlineLoadingDots";
import { routePendingMatchesHref, useNextRouterPendingUrl } from "../hooks/useNextRouterPendingUrl";

type LinkProps = ComponentProps<typeof Link>;

export type ClientPendingTextLinkProps = Omit<LinkProps, "children"> & {
  children: ReactNode;
};

/**
 * Link interno: mostra três pontos animados enquanto a navegação Next para este `href` está em curso.
 */
export default function ClientPendingTextLink({ href, children, style, ...rest }: ClientPendingTextLinkProps) {
  const pendingUrl = useNextRouterPendingUrl();
  const h = typeof href === "string" ? href : "";
  const pendingHere = h ? routePendingMatchesHref(h, pendingUrl) : false;

  return (
    <Link
      href={href}
      {...rest}
      aria-busy={pendingHere}
      style={{
        ...style,
        cursor: pendingHere ? "wait" : style?.cursor,
      }}
    >
      {pendingHere ? (
        <InlineLoadingDots minWidth="0.85em" style={{ fontSize: "1em", verticalAlign: "middle" }} />
      ) : (
        children
      )}
    </Link>
  );
}
