/**
 * Keeps the phone screen from dimming or locking while a session is open.
 * The phone drops the lock whenever the app is hidden, so it is asked for again when the app comes back.
 * Returns a function that lets go. Does nothing where the phone or browser does not support it.
 */
export function keepAwake(): () => void {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return () => {};
  let lock: WakeLockSentinel | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || lock || document.visibilityState !== "visible") return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (stopped) return void sentinel.release().catch(() => {});
      lock = sentinel;
      sentinel.addEventListener("release", () => {
        if (lock === sentinel) lock = null;
      });
    } catch {
      /* low battery or not allowed: the screen simply behaves as usual */
    }
  };
  const onVisible = () => void acquire();

  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
