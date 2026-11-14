import { useEffect, useRef } from 'react';

/** Calls `callback` once per display frame for as long as the component is mounted. */
export function useAnimationFrame(callback: () => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      id = requestAnimationFrame(tick);
      latest.current();
    });
    return () => cancelAnimationFrame(id);
  }, []);
}
