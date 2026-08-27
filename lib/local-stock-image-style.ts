import sharp from "sharp";
import type { Scene } from "@/lib/types";

const WIDTH = 1280;
const HEIGHT = 720;

export type LocalStockImageStyleMode =
  | "photographic"
  | "chalkboard"
  | "line-art"
  | "paper-collage"
  | "comic-book"
  | "flat-illustration"
  | "isometric-illustration"
  | "pixel-art"
  | "safety-poster"
  | "product-illustration";

export function localStockImageStyleMode(style: Scene["style"]): LocalStockImageStyleMode {
  switch (style.visualStyleId) {
    case "chalkboard": return "chalkboard";
    case "simple-line": return "line-art";
    case "collage": return "paper-collage";
    case "comic-book": return "comic-book";
    case "memphis": return "flat-illustration";
    case "isometric": return "isometric-illustration";
    case "pixel-art": return "pixel-art";
    case "safety-poster": return "safety-poster";
    case "product-ui": return "product-illustration";
    case "cinematic-realism": return "photographic";
  }
  const description = [style.visualStylePrompt, style.visualStyleLabel, style.theme, style.mood]
    .filter(Boolean)
    .join(" ");
  return /chalk|粉笔/iu.test(description) ? "chalkboard"
    : /line[ -]?art|线稿/iu.test(description) ? "line-art"
      : /collage|拼贴|paper cut|纸艺/iu.test(description) ? "paper-collage"
        : /comic|漫画/iu.test(description) ? "comic-book"
          : /pixel|像素/iu.test(description) ? "pixel-art"
            : /isometric|等距/iu.test(description) ? "isometric-illustration"
              : /illustration|vector|插画|矢量|2d|poster|海报/iu.test(description) ? "flat-illustration"
                : "photographic";
}

async function pixelArt(body: Buffer) {
  const small = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(160, 90, { fit: "cover", position: "attention", kernel: sharp.kernel.nearest })
    .png({ palette: true, colours: 32, dither: 0 })
    .toBuffer();
  return sharp(small)
    .resize(WIDTH, HEIGHT, { kernel: sharp.kernel.nearest })
    .png({ palette: true, colours: 32, dither: 0, compressionLevel: 0 })
    .toBuffer();
}

async function inkEdges(body: Buffer, invert = false) {
  const edges = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
    .greyscale()
    .convolve({
      width: 3,
      height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
    })
    .normalize()
    .threshold(42)
    .negate()
    .png({ palette: true, colours: 8, dither: 0, compressionLevel: 0 })
    .toBuffer();
  if (!invert) return edges;
  return sharp(edges)
    .negate()
    .tint("#b9d8b4")
    .png({ palette: true, colours: 8, dither: 0, compressionLevel: 0 })
    .toBuffer();
}

async function chalkboard(body: Buffer) {
  const tonalBase = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
    .greyscale()
    .normalize()
    .linear(0.38, 0)
    .tint("#244538")
    .png({ palette: true, colours: 24, dither: 0.12, compressionLevel: 0 })
    .toBuffer();
  return sharp(tonalBase)
    .composite([{ input: await inkEdges(body, true), blend: "screen" }])
    .png({ palette: true, colours: 24, dither: 0.12, compressionLevel: 0 })
    .toBuffer();
}

async function lineDrawing(body: Buffer) {
  const paperBase = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
    .greyscale()
    .normalize()
    .linear(0.24, 194)
    .png({ palette: true, colours: 24, dither: 0.1, compressionLevel: 0 })
    .toBuffer();
  return sharp(paperBase)
    .composite([{ input: await inkEdges(body), blend: "multiply" }])
    .png({ palette: true, colours: 24, dither: 0.1, compressionLevel: 0 })
    .toBuffer();
}

async function flatIllustration(body: Buffer, options: {
  colours: number;
  median: number;
  saturation: number;
  brightness: number;
  contrast?: number;
  offset?: number;
  ink?: boolean;
}) {
  let base = sharp(body, { failOn: "warning" })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
    .median(options.median)
    .modulate({ brightness: options.brightness, saturation: options.saturation });
  if (options.contrast || options.offset) {
    base = base.linear(options.contrast ?? 1, options.offset ?? 0);
  }
  const flattened = await base
    .png({ palette: true, colours: options.colours, dither: 0.08, compressionLevel: 0 })
    .toBuffer();
  if (!options.ink) return flattened;
  return sharp(flattened)
    .composite([{ input: await inkEdges(body), blend: "multiply" }])
    .png({ palette: true, colours: options.colours + 4, dither: 0.08, compressionLevel: 0 })
    .toBuffer();
}

export async function normalizeFreeStockImageStyle(body: Buffer, style: Scene["style"]) {
  const mode = localStockImageStyleMode(style);
  if (mode === "pixel-art") return { body: await pixelArt(body), mode };

  if (mode === "chalkboard") return { body: await chalkboard(body), mode };
  if (mode === "line-art") return { body: await lineDrawing(body), mode };
  if (mode === "paper-collage") {
    return {
      body: await flatIllustration(body, {
        colours: 10,
        median: 9,
        saturation: 1.12,
        brightness: 1.04
      }),
      mode
    };
  }
  if (mode === "comic-book") {
    return {
      body: await flatIllustration(body, {
        colours: 18,
        median: 5,
        saturation: 1.38,
        brightness: 1,
        contrast: 1.12,
        offset: -12,
        ink: true
      }),
      mode
    };
  }
  if (mode === "flat-illustration") {
    return {
      body: await flatIllustration(body, {
        colours: 14,
        median: 9,
        saturation: 0.88,
        brightness: 1.08,
        ink: true
      }),
      mode
    };
  }
  if (mode === "isometric-illustration") {
    return {
      body: await flatIllustration(body, {
        colours: 16,
        median: 7,
        saturation: 0.96,
        brightness: 1.05,
        contrast: 1.05,
        offset: -5,
        ink: true
      }),
      mode
    };
  }
  if (mode === "product-illustration") {
    return {
      body: await flatIllustration(body, {
        colours: 12,
        median: 11,
        saturation: 0.68,
        brightness: 1.1,
        ink: true
      }),
      mode
    };
  }

  let image = sharp(body, { failOn: "warning" })
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" });

  switch (mode) {
    case "safety-poster":
      image = image.greyscale().normalize().linear(1.65, -55).threshold(128).tint("#f5c518");
      break;
    case "photographic":
      image = image.modulate({ saturation: 0.94 }).linear(1.04, -4).sharpen();
      break;
    default:
      break;
  }

  const colours = mode === "photographic" ? 128 : 8;
  return {
    body: await image.png({
      palette: true,
      colours,
      dither: mode === "photographic" ? 0.8 : 0.15,
      compressionLevel: 0
    }).toBuffer(),
    mode
  };
}
