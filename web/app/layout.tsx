import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFTERMAP · Live field map",
  description: "A collaborative field map for disaster response drills.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
