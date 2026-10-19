"use client";

import { Share } from "lucide-react";
import { useEffect, useState } from "react";
import {
  INSTALL_READY_EVENT,
  captureInstallPrompt,
  hasInstallPrompt,
  installAdvice,
  isStandalone,
  isIosDevice,
  registerServiceWorker,
  showInstallPrompt,
  type InstallAdvice,
} from "@/lib/pwa";
import { applyTextSize, getTextSize } from "@/lib/prefs";
import { useStore } from "@/lib/state/store";
import { keepAwake } from "@/lib/wakeLock";
import { Button, Card } from "./ui";

/** Mounted once: registers offline support, shows "new version" and keeps the iPhone keyboard from covering buttons. */
export function PwaRuntime() {
  const [apply, setApply] = useState<null | (() => void)>(null);
  const playing = useStore((s) => !!s.session);

  // the screen stays on while a session is open
  useEffect(() => (playing ? keepAwake() : undefined), [playing]);

  useEffect(() => {
    applyTextSize(getTextSize());
    captureInstallPrompt();
    registerServiceWorker((fn) => setApply(() => fn));
  }, []);

  // iPhone: a fixed bottom bar sits under the keyboard, so hide it while a box is being typed in
  useEffect(() => {
    if (!isIosDevice(navigator.userAgent, navigator.maxTouchPoints)) return;
    const on = (e: Event) => {
      if ((e.target as HTMLElement | null)?.matches?.("input, textarea, select")) document.body.dataset.kb = "1";
    };
    const off = () => {
      delete document.body.dataset.kb;
    };
    window.addEventListener("focusin", on);
    window.addEventListener("focusout", off);
    return () => {
      window.removeEventListener("focusin", on);
      window.removeEventListener("focusout", off);
    };
  }, []);

  if (!apply) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-24 z-[60] mx-auto flex w-full max-w-md items-center gap-3 rounded-2xl border-2 border-gain/50 bg-[#10261a] px-4 py-3 text-lg shadow-xl md:max-w-2xl">
      <span className="flex-1">A new version is ready. Your saved rounds stay.</span>
      <Button variant="primary" className="shrink-0" onClick={() => apply()}>
        Update
      </Button>
    </div>
  );
}

const DISMISS_KEY = "roulette-companion-install-hint-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Home-screen hint: how to put the app on the phone. Shown only on phones that have not installed it yet. */
export function InstallCard() {
  const [advice, setAdvice] = useState<InstallAdvice>("none");

  useEffect(() => {
    const update = () => setAdvice(wasDismissed() ? "none" : installAdvice(navigator.userAgent, isStandalone(), hasInstallPrompt(), navigator.maxTouchPoints));
    update();
    window.addEventListener(INSTALL_READY_EVENT, update);
    return () => window.removeEventListener(INSTALL_READY_EVENT, update);
  }, []);

  if (advice === "none") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private window: it will simply show again next time */
    }
    setAdvice("none");
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-xl font-bold">Put this app on your phone</h2>
      {advice === "prompt" && (
        <>
          <p className="text-lg text-muted">It opens full-screen like any other app, and it also works without internet.</p>
          <Button variant="primary" className="w-full" onClick={() => void showInstallPrompt()}>
            Install App
          </Button>
        </>
      )}
      {advice === "ios-safari" && (
        <ol className="list-inside list-decimal space-y-1 text-lg text-muted">
          <li>
            Tap the <Share aria-label="Share" className="inline align-text-bottom" size={22} /> <b className="text-fg">Share</b> button at the bottom of Safari.
          </li>
          <li>
            Scroll down and tap <b className="text-fg">Add to Home Screen</b>.
          </li>
          <li>
            Tap <b className="text-fg">Add</b>.
          </li>
        </ol>
      )}
      {advice === "ios-other" && <p className="text-lg text-muted">On an iPhone the app can only be installed from <b className="text-fg">Safari</b>. Open this same address in Safari, then use Share → Add to Home Screen.</p>}
      {advice === "android-menu" && (
        <ol className="list-inside list-decimal space-y-1 text-lg text-muted">
          <li>
            Tap the <b className="text-fg">⋮</b> menu of your browser.
          </li>
          <li>
            Tap <b className="text-fg">Install app</b> or <b className="text-fg">Add to Home screen</b>.
          </li>
        </ol>
      )}
      <button className="min-h-[44px] w-full text-base text-muted underline" onClick={dismiss}>
        Do not show this again
      </button>
    </Card>
  );
}
