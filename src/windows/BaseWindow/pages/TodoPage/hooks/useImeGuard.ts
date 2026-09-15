import { useRef, useCallback } from "react";
import type { KeyboardEvent } from "react";

/* ------------------------------------------------------------------ */
/* IME 守卫：追踪组合输入状态，防止拼写期间的 Enter 被当作“提交”       */
/* ------------------------------------------------------------------ */
export function useImeGuard() {
  const composingRef = useRef(false);
  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
  }, []);
  const isComposing = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) =>
      composingRef.current || e.nativeEvent.isComposing,
    [],
  );
  return { composingRef, onCompositionStart, onCompositionEnd, isComposing };
}
