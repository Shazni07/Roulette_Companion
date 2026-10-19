"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { canVibrate, getTextSize, getVibrate, setTextSize, setVibrate, buzz, type TextSize } from "@/lib/prefs";

/** One quiet line: a label on the left and a small two-way switch on the right. */
function Choice({ label, options, value, onPick }: { label: string; options: { id: string; text: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-base text-muted">{label}</span>
      <div className="inline-flex rounded-xl border border-line p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={clsx("min-h-[40px] min-w-[72px] rounded-lg px-3 text-base", value === o.id ? "bg-surface2 font-semibold text-fg" : "text-muted")}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Home screen, at the bottom: text size, and the small buzz on phones that support it. Kept on this phone only. */
export function SettingsCard() {
  const [size, setSize] = useState<TextSize>("normal");
  const [vibrate, setVib] = useState(true);
  const [canBuzz, setCanBuzz] = useState(false);

  useEffect(() => {
    setSize(getTextSize());
    setVib(getVibrate());
    setCanBuzz(canVibrate());
  }, []);

  return (
    <section aria-label="Settings" className="space-y-1 border-t border-line pt-3">
      <Choice
        label="Text size"
        value={size}
        options={[
          { id: "normal", text: "Normal" },
          { id: "large", text: "Large" },
        ]}
        onPick={(id) => {
          setSize(id as TextSize);
          setTextSize(id as TextSize);
        }}
      />
      {canBuzz && (
        <Choice
          label="Vibration"
          value={vibrate ? "on" : "off"}
          options={[
            { id: "on", text: "On" },
            { id: "off", text: "Off" },
          ]}
          onPick={(id) => {
            setVib(id === "on");
            setVibrate(id === "on");
            if (id === "on") buzz(30);
          }}
        />
      )}
    </section>
  );
}
