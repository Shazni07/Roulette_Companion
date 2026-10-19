"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { canVibrate, getTextSize, getVibrate, setTextSize, setVibrate, buzz, type TextSize } from "@/lib/prefs";
import { Card } from "./ui";

function Choice({ label, options, value, onPick }: { label: string; options: { id: string; text: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div>
      <div className="mb-2 text-lg font-semibold">{label}</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={clsx("min-h-[56px] rounded-2xl border-2 text-lg font-bold", value === o.id ? "border-gain bg-gain/10 text-gain" : "border-line bg-surface2")}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Home screen: text size, and the small buzz on phones that support it. Kept on this phone only. */
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
    <Card className="space-y-4">
      <h2 className="text-xl font-bold">Settings</h2>
      <Choice
        label="Text Size"
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
    </Card>
  );
}
