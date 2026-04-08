import type { CSSProperties } from "react";

type Props = {
  /** Largura mínima para reduzir salto de layout quando os pontos animam. */
  minWidth?: string | number;
  style?: CSSProperties;
  className?: string;
};

/**
 * Três pontos com animação CSS — visíveis no primeiro frame (SSR/hidratação),
 * sem depender de `useEffect`/`setInterval` (o intervalo só começava depois da pintura).
 */
export default function InlineLoadingDots({ minWidth = "1.15em", style, className }: Props) {
  return (
    <span
      className={["decide-inline-loading-dots", className].filter(Boolean).join(" ")}
      style={{ minWidth, verticalAlign: "baseline", ...style }}
      aria-hidden
    >
      <span className="decide-inline-loading-dots__dot">.</span>
      <span className="decide-inline-loading-dots__dot">.</span>
      <span className="decide-inline-loading-dots__dot">.</span>
    </span>
  );
}
