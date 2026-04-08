import { useRouter } from "next/router";
import type { ReactNode } from "react";
import DecideLogoHeader from "./DecideLogoHeader";

export default function AppLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const isLanding = router.pathname === "/";
  /** Iframes: `/embed/*` e `/fees-client?embed=1` — sem header; o shell pai já mostra logo e menu. */
  const isFeesClientEmbed =
    router.pathname === "/fees-client" && String(router.query.embed ?? "") === "1";
  const isEmbedChromeless = router.pathname.startsWith("/embed/") || isFeesClientEmbed;

  return (
    <div
      className={[className, !isLanding ? "decide-app-client" : ""].filter(Boolean).join(" ")}
      style={{
        minHeight: "100%",
        boxSizing: "border-box",
      }}
    >
      {!isLanding && !isEmbedChromeless ? <DecideLogoHeader /> : null}
      {children}
    </div>
  );
}
