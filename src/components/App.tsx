"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "@/lib/state/store";
import { useCloud } from "@/lib/sync/cloud";
import { PwaRuntime } from "./PwaParts";
import { BetsScreen } from "./screens/Bets";
import { HistoryScreen, PastDetailScreen } from "./screens/History";
import { FinishScreen, ResultScreen, ReviewScreen, SavedScreen, WinningScreen } from "./screens/Play";
import { KeepNumbersScreen, NumbersScreen, ResumeScreen } from "./screens/RoundSetup";
import { HomeScreen, StartScreen } from "./screens/Setup";

export function App() {
  const { ready, init, error, notice, clearMessages, screen } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  // online storage starts once the saved sessions are loaded (does nothing when it is not set up)
  useEffect(() => {
    if (ready) void useCloud.getState().start();
  }, [ready]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.setState({ notice: null }), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // each new screen starts at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 md:max-w-2xl">
      {(error || notice) && (
        <div className="fixed inset-x-0 top-0 z-[70] mx-auto w-full max-w-md px-4 pt-3 md:max-w-2xl">
          <div
            role={error ? "alert" : "status"}
            className={clsx(
              "flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-lg shadow-xl",
              error ? "border-loss/60 bg-[#2e1616] text-loss" : "border-gain/50 bg-[#10261a] text-gain",
            )}
          >
            <span className="flex-1">{error ?? notice}</span>
            <button aria-label="Close message" onClick={clearMessages} className="flex h-11 w-11 shrink-0 items-center justify-center">
              <X size={22} />
            </button>
          </div>
        </div>
      )}
      <PwaRuntime />
      <main>{ready ? <Current screen={screen} /> : <p className="py-20 text-center text-xl text-muted">Opening your saved sessions…</p>}</main>
    </div>
  );
}

function Current({ screen }: { screen: ReturnType<typeof useStore.getState>["screen"] }) {
  switch (screen) {
    case "home":
      return <HomeScreen />;
    case "setup":
      return <StartScreen />;
    case "resume":
      return <ResumeScreen />;
    case "numbers":
      return <NumbersScreen />;
    case "keepnumbers":
      return <KeepNumbersScreen />;
    case "bets":
      return <BetsScreen />;
    case "review":
      return <ReviewScreen />;
    case "winning":
      return <WinningScreen />;
    case "result":
      return <ResultScreen />;
    case "saved":
      return <SavedScreen />;
    case "finish":
      return <FinishScreen />;
    case "history":
      return <HistoryScreen />;
    case "pastdetail":
      return <PastDetailScreen />;
  }
}
