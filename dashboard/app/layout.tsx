import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { Toaster } from "@/components/toast";
import { TooltipProvider } from "@/components/ui";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "ClipPilot — Mission Control",
  description: "Autonomous podcast → shorts factory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="blueprint-grid bg-black font-sans text-neutral-100 antialiased">
        <TooltipProvider delayDuration={300} skipDelayDuration={100}>
          <CopilotKit runtimeUrl="/api/copilotkit">
            <CopilotSidebar
              defaultOpen
              labels={{
                title: "ClipPilot Copilot",
                initial:
                  "Try: “find trending tech podcasts and clip the most controversial moments”",
              }}
            >
              {children}
            </CopilotSidebar>
          </CopilotKit>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
