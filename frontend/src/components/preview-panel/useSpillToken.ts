import { useCallback, useRef, useState } from "react";
import { api } from "../../api";
import { errorMessage } from "@/utils/errors";

export function useSpillToken() {
  const [spillToken, setSpillToken] = useState<string | null>(null);
  const spillTokenRef = useRef<string | null>(null);
  const releasedSpillTokensRef = useRef<Set<string>>(new Set());

  const releaseSpillToken = useCallback(async (token: string | null) => {
    if (!token) return;
    if (releasedSpillTokensRef.current.has(token)) return;
    if (releasedSpillTokensRef.current.size >= 64) {
      const oldest = releasedSpillTokensRef.current.values().next().value;
      if (oldest) releasedSpillTokensRef.current.delete(oldest);
    }
    releasedSpillTokensRef.current.add(token);
    try {
      await api.fileTokenCleanup(token);
    } catch (err) {
      console.warn(
        "[preview] spill cleanup failed:",
        errorMessage(err, String(err)),
      );
    }
  }, []);

  return { spillToken, setSpillToken, spillTokenRef, releaseSpillToken };
}
