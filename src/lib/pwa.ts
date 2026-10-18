/** Helpers for installing the app on a phone and for offline use. */

export type InstallAdvice =
  /** nothing to show: already installed, or not a phone */
  | "none"
  /** Android/Chrome gave us an Install button to offer */
  | "prompt"
  /** iPhone/iPad Safari: Share → Add to Home Screen */
  | "ios-safari"
  /** iPhone/iPad in another browser: open it in Safari first */
  | "ios-other"
  /** Android without an install button: browser menu → Install app */
  | "android-menu";

export function isIosDevice(ua: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ pretends to be a Mac, but a Mac has no touch screen
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
}

export function installAdvice(ua: string, standalone: boolean, hasPrompt: boolean, maxTouchPoints = 0): InstallAdvice {
  if (standalone) return "none";
  const ios = isIosDevice(ua, maxTouchPoints);
  if (!ios && !/Android/i.test(ua)) return "none"; // a computer: no install hint
  if (hasPrompt) return "prompt";
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(ua) ? "ios-other" : "ios-safari";
  return "android-menu";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/* ───────── the Android "Install" button ───────── */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
export const INSTALL_READY_EVENT = "rc-install-ready";

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it so our own button can show it
    deferred = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_READY_EVENT));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.dispatchEvent(new Event(INSTALL_READY_EVENT));
  });
}

export const hasInstallPrompt = () => deferred !== null;

export async function showInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const d = deferred;
  deferred = null;
  await d.prompt();
  const choice = await d.userChoice;
  window.dispatchEvent(new Event(INSTALL_READY_EVENT));
  return choice.outcome;
}

/* ───────── offline support ───────── */
/**
 * Registers the service worker (production only, so development is never served from
 * a saved copy). `onUpdateReady` is called with a function that applies a waiting update.
 */
export function registerServiceWorker(onUpdateReady: (apply: () => void) => void): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  let userAsked = false;
  const offer = (worker: ServiceWorker) =>
    onUpdateReady(() => {
      userAsked = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    });

  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      // the first visit's files are saved too, so the app also opens offline right after installing
      void navigator.serviceWorker.ready.then((r) => {
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin));
        r.active?.postMessage({ type: "CACHE_URLS", urls });
      });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (userAsked) location.reload(); // only when the user pressed Update
      });
    } catch {
      /* no offline support (for example a private window): the app still works online */
    }
  };
  if (document.readyState === "complete") void start();
  else window.addEventListener("load", () => void start(), { once: true });
}
