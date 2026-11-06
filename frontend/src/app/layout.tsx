import type { Metadata } from "next";
import "./globals.css";
import { RootProviders } from "@/components/root-providers";

export const metadata: Metadata = {
  title: "AIsmering — Online Proctoring & Anti-Cheat System",
  description:
    "AI-driven remote exam monitoring with human-in-the-loop proctor review. Advisory flags only — no automated accusations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
