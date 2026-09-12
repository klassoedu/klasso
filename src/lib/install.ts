"use client";

import { useEffect, useState } from "react";
import { detectEnvironment } from "./push-client";

/**
 * Home-screen install.
 *
 * Two different things wear the same name. On Chromium the browser fires
 * `beforeinstallprompt`, which we stash in layout.tsx (it fires once, early,
 * and is gone if nobody is listening) and replay on a tap — a genuine one-tap
 * install. WebKit implements none of that: on iOS the *only* route is the user
 * doing Share → Add to Home Screen themselves, so there the best we can do is
 * show them exactly where to tap.
 *
 * This matters beyond tidiness: iOS web push only works from an installed
 * home-screen app, so a user who never installs never gets a single reminder.
 */
export type InstallMode = "prompt" | "ios-manual" | "installed" | "unavailable";

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "klasso-install-dismissed";
/** A dismissal is a "not now", not a "never" — ask again after a fortnight. */
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function snoozeInstall(): void {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
}

export function useInstall(): { mode: InstallMode; install: () => Promise<boolean> } {
  const [mode, setMode] = useState<InstallMode>("unavailable");

  useEffect(() => {
    const resolve = () => {
      const env = detectEnvironment();
      if (env.standalone) return setMode("installed");
      if (snoozed()) return setMode("unavailable");
      const stashed = (window as { __klassoInstall?: PromptEvent | null }).__klassoInstall;
      if (stashed) return setMode("prompt");
      // Safari on iPhone/iPad is the manual case. Desktop Safari can install
      // too, but it is not where anyone runs a college timetable.
      if (env.isIOS) return setMode("ios-manual");
      return setMode("unavailable");
    };
    resolve();
    window.addEventListener("klasso:installable", resolve);
    window.addEventListener("klasso:installed", resolve);
    return () => {
      window.removeEventListener("klasso:installable", resolve);
      window.removeEventListener("klasso:installed", resolve);
    };
  }, []);

  const install = async () => {
    const event = (window as { __klassoInstall?: PromptEvent | null }).__klassoInstall;
    if (!event) return false;
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      // The event is single-use whatever the answer.
      (window as { __klassoInstall?: PromptEvent | null }).__klassoInstall = null;
      if (outcome === "accepted") { setMode("installed"); return true; }
      snoozeInstall();
      setMode("unavailable");
      return false;
    } catch {
      return false;
    }
  };

  return { mode, install };
}
