import { useEffect, useState } from "react";
import { readFxHedgePrefs } from "../lib/fxHedgePrefs";

/**
 * Uma linha discreta de contexto (hedge), abaixo dos KPIs hero.
 */
export default function ClientHedgeMicroLine() {
  const [line, setLine] = useState<string>("");

  useEffect(() => {
    const sync = () => {
      try {
        const p = readFxHedgePrefs();
        if (!p) setLine("");
        else {
          const pct = Math.round(p.pct);
          setLine(pct <= 0 ? "Hedge cambial: inactivo" : `Hedge cambial activo (${pct}%)`);
        }
      } catch {
        setLine("");
      }
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  if (!line) return null;

  return <div className="decide-app-hedge-line">{line}</div>;
}
