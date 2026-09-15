import { useCallback, useEffect, useRef, useState } from "react";

// Fetch-on-mount + refresh-on-demand hook with normalized error state.
export function useApi(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    Promise.resolve()
      .then(() => fetcherRef.current())
      .then((data) => {
        if (active && mounted.current) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (active && mounted.current) setState({ data: null, loading: false, error });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, refresh };
}
