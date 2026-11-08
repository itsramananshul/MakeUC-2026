import type { Metadata } from "next";
import CatiaMap from "./catia-map";
import catalog from "@/lib/catia-imagery.json";

export const metadata: Metadata = { title: "Catia La Mar aerial imagery · Gaslight Maps" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tiles?: string }> }) {
  const { tiles } = await searchParams;
  const requested = typeof tiles === "string" ? new Set(tiles.split(",")) : null;
  const { imagery } = catalog;
  const { detailTiles, ...central } = imagery;
  const all = [central, ...detailTiles.map(tile => ({
    ...tile, source: imagery.source, timestamp: imagery.timestamp,
  }))];
  const selected = all.filter(tile => requested?.has(tile.url.split("/").at(-1)!.replace(".webp", "")));
  return <CatiaMap imagery={selected.length ? selected : all} selected={selected.length} />;
}
