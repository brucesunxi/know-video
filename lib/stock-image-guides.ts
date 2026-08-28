import sharp from "sharp";
import { getOptionalEnv } from "@/lib/env";
import { stockSearchTerms } from "@/lib/stock-video-assets";
import { rankStockCandidates } from "@/lib/stock-candidate-policy";
import type { Scene } from "@/lib/types";

type StockImageGuideCandidate = {
  id: string;
  provider: "pexels" | "pixabay";
  imageUrl: string;
  pageUrl: string;
  query: string;
  description?: string;
  tags?: string[];
};

type StockImageGuideOptions = {
  excludedReferenceKeys?: Iterable<string>;
  selectionKey?: string;
  maxCandidates?: number;
};

export type StockImageGuide = {
  body: Buffer;
  deliveryBody: Buffer;
  contentType: "image/jpeg";
  referenceKey: string;
  provider: StockImageGuideCandidate["provider"];
  providerId: string;
  pageUrl: string;
  query: string;
  descriptor: string;
  relevanceScore: number;
  locallyTrusted: boolean;
};

export function hasFreeStockImageGuideProvider() {
  return Boolean(getOptionalEnv("PEXELS_API_KEY") || getOptionalEnv("PIXABAY_API_KEY"));
}

async function searchPexelsImages(query: string): Promise<StockImageGuideCandidate[]> {
  const apiKey = getOptionalEnv("PEXELS_API_KEY");
  if (!apiKey) return [];
  const response = await fetch(`https://api.pexels.com/v1/search?orientation=landscape&per_page=10&query=${encodeURIComponent(query)}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(18_000)
  });
  if (!response.ok) throw new Error(`Pexels image search failed with ${response.status}`);
  const body = await response.json() as {
    photos?: Array<{
      id: number;
      url: string;
      alt?: string;
      src?: { landscape?: string; large?: string; large2x?: string };
    }>;
  };
  return (body.photos ?? []).flatMap((photo) => {
    const imageUrl = photo.src?.landscape || photo.src?.large || photo.src?.large2x;
    return imageUrl ? [{
      id: String(photo.id),
      provider: "pexels" as const,
      imageUrl,
      pageUrl: photo.url,
      query,
      description: photo.alt
    }] : [];
  });
}

async function searchPixabayImages(query: string): Promise<StockImageGuideCandidate[]> {
  const apiKey = getOptionalEnv("PIXABAY_API_KEY");
  if (!apiKey) return [];
  const response = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=20`, {
    signal: AbortSignal.timeout(18_000)
  });
  if (!response.ok) throw new Error(`Pixabay image search failed with ${response.status}`);
  const body = await response.json() as {
    hits?: Array<{
      id: number;
      pageURL: string;
      tags?: string;
      largeImageURL?: string;
      webformatURL?: string;
    }>;
  };
  return (body.hits ?? []).flatMap((image) => {
    const imageUrl = image.largeImageURL || image.webformatURL;
    return imageUrl ? [{
      id: String(image.id),
      provider: "pixabay" as const,
      imageUrl,
      pageUrl: image.pageURL,
      query,
      tags: image.tags?.split(",").map((tag) => tag.trim()).filter(Boolean)
    }] : [];
  });
}

function candidateReferenceKey(candidate: StockImageGuideCandidate) {
  return `stock-guide:${candidate.provider}:${candidate.id}`;
}

async function findGuideCandidates(scene: Scene, options: StockImageGuideOptions) {
  const excluded = new Set(options.excludedReferenceKeys ?? []);
  const maxCandidates = Math.max(1, Math.min(4, Math.floor(options.maxCandidates ?? 1)));
  const collected: StockImageGuideCandidate[] = [];
  for (const query of stockSearchTerms(scene).slice(0, 3)) {
    const settled = await Promise.allSettled([
      searchPexelsImages(query),
      searchPixabayImages(query)
    ]);
    const candidates = settled
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter((candidate) => !excluded.has(candidateReferenceKey(candidate)));
    collected.push(...candidates);
    if (collected.length >= maxCandidates * 3) break;
  }
  const unique = [...new Map(collected.map((candidate) => [candidateReferenceKey(candidate), candidate])).values()];
  return rankStockCandidates(
    scene,
    unique,
    `${scene.id}:${scene.sceneNumber}:${options.selectionKey ?? "default"}:image-guide`
  ).slice(0, maxCandidates);
}

export async function loadFreeStockImageGuides(
  scene: Scene,
  options: StockImageGuideOptions = {}
): Promise<StockImageGuide[]> {
  if (!hasFreeStockImageGuideProvider()) return [];
  const candidates = await findGuideCandidates(scene, options);
  const guides: StockImageGuide[] = [];
  for (const { candidate, evaluation } of candidates) {
    try {
      const response = await fetch(candidate.imageUrl, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`${candidate.provider} image download failed with ${response.status}`);
      const declaredBytes = Number(response.headers.get("content-length") ?? 0);
      if (declaredBytes > 15_000_000) throw new Error("Free stock image exceeds the 15 MB guide limit");
      const source = Buffer.from(await response.arrayBuffer());
      if (source.byteLength < 5_000 || source.byteLength > 15_000_000) {
        throw new Error("Free stock image has an invalid file size");
      }
      const [body, deliveryBody] = await Promise.all([
        sharp(source, { failOn: "warning" })
          .rotate()
          // Cloudflare requires every FLUX.2 input image to be smaller than 512x512.
          .resize(480, 270, { fit: "cover", position: "attention" })
          .jpeg({ quality: 84, chromaSubsampling: "4:2:0" })
          .toBuffer(),
        sharp(source, { failOn: "warning" })
          .rotate()
          .resize(1280, 720, { fit: "cover", position: "attention" })
          .png({ compressionLevel: 8, adaptiveFiltering: true })
          .toBuffer()
      ]);
      guides.push({
        body,
        deliveryBody,
        contentType: "image/jpeg",
        referenceKey: candidateReferenceKey(candidate),
        provider: candidate.provider,
        providerId: candidate.id,
        pageUrl: candidate.pageUrl,
        query: candidate.query,
        descriptor: evaluation.descriptor,
        relevanceScore: evaluation.relevanceScore,
        locallyTrusted: evaluation.locallyTrusted
      });
    } catch (error) {
      console.warn(`[stock-image-guides] Could not import ${candidate.provider}:${candidate.id}:`, error);
    }
  }
  return guides;
}

export async function loadFreeStockImageGuide(
  scene: Scene,
  options: StockImageGuideOptions = {}
): Promise<StockImageGuide | undefined> {
  return (await loadFreeStockImageGuides(scene, { ...options, maxCandidates: 1 }))[0];
}
