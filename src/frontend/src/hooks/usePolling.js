import { useEffect } from "react";

// Interval polling that pauses while the browser tab is hidden.
export function usePolling(refresh, intervalMs, enabled = true) {
  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs, enabled]);
}
