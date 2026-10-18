"use client";

import type { ReactNode } from "react";
import { Button } from "./ui";

/**
 * One purpose per screen: a title, a short sentence, the content and a fixed
 * footer with a consistent Back and one obvious primary action.
 */
export function ScreenFrame({
  title,
  subtitle,
  children,
  onBack,
  backLabel = "Back",
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryTone = "primary",
  above,
  hideHeading,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryTone?: "primary" | "secondary";
  /** content shown above the title (session bar, etc.) */
  above?: ReactNode;
  /** keep the title for screen readers but do not show it */
  hideHeading?: boolean;
}) {
  const hasFooter = !!onBack || !!primaryLabel;
  return (
    <div className={hasFooter ? "pb-36" : "pb-8"}>
      <div className="space-y-5">
        {above}
        {hideHeading ? (
          <h1 className="sr-only">{title}</h1>
        ) : (
          <header>
            <h1 className="text-3xl font-bold leading-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-lg text-muted">{subtitle}</p> : null}
          </header>
        )}
        {children}
      </div>
      {hasFooter && (
        <div className="kb-hide safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-md gap-3 px-4 py-3 md:max-w-2xl">
            {onBack && (
              <Button onClick={onBack} className={primaryLabel ? "shrink-0" : "w-full"}>
                {backLabel}
              </Button>
            )}
            {primaryLabel && (
              <Button variant={primaryTone} className="flex-1" disabled={primaryDisabled} onClick={onPrimary}>
                {primaryLabel}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
