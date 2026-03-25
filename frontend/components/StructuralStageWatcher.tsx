import React, { useEffect, useState } from "react";
import StructuralStageCard from "./StructuralStageCard";

declare global {
  interface Window {
    __DECIDE_LAST_KPIS_OVERLAY?: any;
    __DECIDE_FETCH_WRAPPED__?: boolean;
    __DECIDE_WATCHER_MOUNTED__?: boolean;
  }
}

export default function StructuralStageWatcher() {
  const [enabled, setEnabled] = useState(true);
  const [last, setLast] = useState<any>(null);

  // Ensure ONLY ONE watcher instance shows UI (avoids double overlay)
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.__DECIDE_WATCHER_MOUNTED__) {
      setEnabled(false);
      return;
    }
    window.__DECIDE_WATCHER_MOUNTED__ = true;

    return () => {
      // release
      window.__DECIDE_WATCHER_MOUNTED__ = false;
    };
  }, []);

  // Wrap fetch once and capture payload
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enabled) return;

    // initial pull if exists
    if (window.__DECIDE_LAST_KPIS_OVERLAY) {
      setLast(window.__DECIDE_LAST_KPIS_OVERLAY);
    }

    if (window.__DECIDE_FETCH_WRAPPED__) return;
    window.__DECIDE_FETCH_WRAPPED__ = true;

    const origFetch = window.fetch.bind(window);

    window.fetch = async (...args: any[]) => {
      const resp = await origFetch(...args);

      try {
        const url = String(args?.[0] ?? "");
        const isTarget =
          url.includes("/api/kpis_overlay/regimes/run") ||
          url.includes("/api/proxy/api/kpis_overlay/regimes/run") ||
          url.includes("kpis_overlay/regimes/run");

        if (isTarget) {
          const clone = resp.clone();
          clone
            .json()
            .then((j) => {
              window.__DECIDE_LAST_KPIS_OVERLAY = j;
              setLast(j);
            })
            .catch(() => {});
        }
      } catch {}

      return resp;
    };
  }, [enabled]);

  if (!enabled) return null;

  const has = !!(last && last.detail && last.detail.structural_stage);
  if (!has) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-[380px] max-w-[90vw] opacity-95">
      <StructuralStageCard data={last} />
    </div>
  );
}