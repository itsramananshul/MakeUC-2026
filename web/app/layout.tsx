import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./world.css";

export const metadata: Metadata = {
  title: "AFTERMAP · World map",
  description: "A collaborative world map for disaster surveys, field reports, and candidate routes.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
