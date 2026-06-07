"use client";
import { useEffect } from "react";

/**
 * Removes CopilotKit's own promotional bubble (their cloud "check-for-updates" advisory,
 * e.g. "Big update: Series A, Threads and CopilotKit Enterprise Intelligence") that they
 * render on the popup launcher on a timer. It is NOT part of ClipPilot. Matched strictly on
 * CopilotKit marketing copy in a small node so it can never touch app content.
 */
export default function KillCopilotPromo() {
  useEffect(() => {
    const PROMO = /(series a|enterprise intelligence|big update|new version|update available|threads)/i;
    const sweep = () => {
      // Known CopilotKit branding/console bits.
      document
        .querySelectorAll(".copilotKitDevConsole, .poweredBy, [class*='DevConsole']")
        .forEach((e) => ((e as HTMLElement).style.display = "none"));

      // The advisory bubble: a small node that mentions CopilotKit + promo copy.
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const t = el.textContent || "";
        if (t.length < 180 && /copilotkit/i.test(t) && PROMO.test(t)) {
          // Climb to the bubble's small outer container, then hide it.
          let c = el as HTMLElement;
          while (
            c.parentElement &&
            c.parentElement !== document.body &&
            (c.parentElement.textContent || "").length < 200
          ) {
            c = c.parentElement;
          }
          c.style.display = "none";
        }
      }
    };

    sweep();
    const iv = setInterval(sweep, 1000);
    return () => clearInterval(iv);
  }, []);

  return null;
}
