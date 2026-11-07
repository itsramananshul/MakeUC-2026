import { fromArrayBuffer } from "geotiff";
import proj4 from "proj4";
import sharp from "sharp";
import { DRILL_BOUNDS, type Bounds } from "./imagery-frame";
import { RequestError } from "./store";

const WEB_MERCATOR = "EPSG:3857";
const MAX_SIZE = 72 * 1024 * 1024;
export const imageryLimit = MAX_SIZE;
type Source = {
  width: number; height: number; data: Uint8Array;
  fromMap: { forward(point: number[]): number[] }; origin: number[]; resolution: number[];
  bounds: Bounds; noData: number | null;
};

function supportedCRS(keys: ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof fromArrayBuffer>>["getImage"]>>["getGeoKeys"]>) {
  const projected = keys?.ProjectedCSTypeGeoKey;
  if (!projected && keys?.GeographicTypeGeoKey === 4326) return "EPSG:4326";
  if (projected === 3857) return WEB_MERCATOR;
  if (projected && ((projected >= 32601 && projected <= 32660) || (projected >= 32701 && projected <= 32760))) {
    return `+proj=utm +zone=${projected % 100} ${projected >= 32701 ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
  }
  throw new RequestError("Use a GeoTIFF in WGS 84, Web Mercator, or WGS 84 UTM.");
}

async function loadSource(buffer: ArrayBuffer): Promise<Source> {
  let image;
  try { image = await (await fromArrayBuffer(buffer)).getImage(); }
  catch { throw new RequestError("One of the files is not a readable GeoTIFF."); }
  if (image.getFileDirectory().hasTag("ModelTransformation")) {
    throw new RequestError("Use a north-up orthomosaic with a GeoTIFF pixel scale.");
  }
  const crs = supportedCRS(image.getGeoKeys());
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const originalWidth = image.getWidth();
  const originalHeight = image.getHeight();
  if (!origin.every(Number.isFinite) || resolution[0] <= 0 || resolution[1] >= 0 ||
      originalWidth * originalHeight > 100_000_000) {
    throw new RequestError("Use north-up GeoTIFFs under 100 million pixels.");
  }
  const nativeBounds = image.getBoundingBox();
  const toMap = proj4(crs, WEB_MERCATOR);
  const corners = [
    [nativeBounds[0], nativeBounds[1]], [nativeBounds[0], nativeBounds[3]],
    [nativeBounds[2], nativeBounds[1]], [nativeBounds[2], nativeBounds[3]],
  ].map(point => toMap.forward(point));
  const bounds: Bounds = [
    Math.min(...corners.map(point => point[0])), Math.min(...corners.map(point => point[1])),
    Math.max(...corners.map(point => point[0])), Math.max(...corners.map(point => point[1])),
  ];
  if (!bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
    throw new RequestError("The orthomosaic has invalid geographic bounds.");
  }
  const downsample = Math.max(1, originalWidth / 1800, originalHeight / 1800);
  const width = Math.ceil(originalWidth / downsample);
  const height = Math.ceil(originalHeight / downsample);
  const data = await image.readRGB({ width, height, interleave: true }) as Uint8Array;
  if (data.length !== width * height * 3) throw new RequestError("Use an RGB or grayscale GeoTIFF.");
  return {
    width, height, data, origin, bounds, fromMap: proj4(WEB_MERCATOR, crs),
    resolution: [resolution[0] * originalWidth / width, resolution[1] * originalHeight / height],
    noData: image.getGDALNoData(),
  };
}

function union(sources: Source[]): Bounds {
  return [
    Math.min(...sources.map(source => source.bounds[0])), Math.min(...sources.map(source => source.bounds[1])),
    Math.max(...sources.map(source => source.bounds[2])), Math.max(...sources.map(source => source.bounds[3])),
  ];
}

export async function mosaic(files: ArrayBuffer[]) {
  if (!files.length || files.length > 8 || files.reduce((sum, file) => sum + file.byteLength, 0) > MAX_SIZE) {
    throw new RequestError("Choose one to eight GeoTIFFs under 72 MB total.");
  }
  const sources: Source[] = [];
  for (const file of files) sources.push(await loadSource(file));
  const coverage = union(sources);
  const aligned = coverage[0] < DRILL_BOUNDS[2] && coverage[2] > DRILL_BOUNDS[0] &&
    coverage[1] < DRILL_BOUNDS[3] && coverage[3] > DRILL_BOUNDS[1] &&
    Math.max(coverage[2] - coverage[0], coverage[3] - coverage[1]) < 15_000;
  const bounds = aligned ? DRILL_BOUNDS : coverage;
  const [west, south, east, north] = bounds;
  const dx = east - west, dy = north - south;
  const width = Math.max(1, Math.round(1500 * Math.min(1, dx / dy)));
  const height = Math.max(1, Math.round(1500 * Math.min(1, dy / dx)));
  const pixels = Buffer.alloc(width * height * 4);
  let painted = 0;
  for (let y = 0; y < height; y++) {
    const worldY = north - (y + .5) * dy / height;
    for (let x = 0; x < width; x++) {
      const worldX = west + (x + .5) * dx / width;
      for (const source of sources) {
        const [minX, minY, maxX, maxY] = source.bounds;
        if (worldX < minX || worldX > maxX || worldY < minY || worldY > maxY) continue;
        const [sx, sy] = source.fromMap.forward([worldX, worldY]);
        const ix = Math.floor((sx - source.origin[0]) / source.resolution[0]);
        const iy = Math.floor((sy - source.origin[1]) / source.resolution[1]);
        if (ix < 0 || ix >= source.width || iy < 0 || iy >= source.height) continue;
        const i = (iy * source.width + ix) * 3;
        if (source.noData !== null && source.data[i] === source.noData &&
            source.data[i + 1] === source.noData && source.data[i + 2] === source.noData) continue;
        const o = (y * width + x) * 4;
        pixels[o] = source.data[i]; pixels[o + 1] = source.data[i + 1];
        pixels[o + 2] = source.data[i + 2]; pixels[o + 3] = 255;
        painted += 1;
        break;
      }
    }
  }
  if (!painted) throw new RequestError("The files do not contain visible map coverage.");
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ quality: 87 }).toBuffer();
  return { bytes, bounds, aligned, width, height, count: sources.length };
}
