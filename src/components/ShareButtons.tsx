"use client";

import { csvFileName, roundSummaryText, sessionCsv, sessionSummaryText } from "@/lib/roulette/report";
import type { Round, Session } from "@/lib/roulette/types";
import { downloadTextFile, shareText } from "@/lib/share";
import { useStore } from "@/lib/state/store";
import { Button } from "./ui";

const tell = (notice: string) => useStore.setState({ notice, error: null });

/** Share a short message (WhatsApp and so on), and for a whole session also save a spreadsheet file. */
export function ShareButtons({ session, rounds, round }: { session: Session; rounds: Round[]; round?: Round }) {
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        onClick={async () => {
          const text = round ? roundSummaryText(session, rounds, round) : sessionSummaryText(session, rounds);
          const r = await shareText(text, "Roulette Companion");
          if (r === "copied") tell("Copied. You can paste it in WhatsApp or a message.");
          else if (r === "failed") useStore.setState({ error: "Sharing did not work on this phone." });
        }}
      >
        {round ? "Share This Round" : "Share Summary"}
      </Button>
      {!round && (
        <Button
          className="w-full"
          onClick={() => {
            downloadTextFile(csvFileName(session), sessionCsv(session, rounds));
            tell("Spreadsheet file saved. Look in your Downloads.");
          }}
        >
          Download Spreadsheet
        </Button>
      )}
    </div>
  );
}
