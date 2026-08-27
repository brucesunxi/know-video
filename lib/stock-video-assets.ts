import { getOptionalEnv } from "@/lib/env";
import { assetUrlForKey, uploadToR2 } from "@/lib/r2";
import { styleAllowsFreeStockVideo } from "@/lib/style-motion-policy";
import type { Project, Scene, SceneAsset } from "@/lib/types";

type StockVideoCandidate = {
  id: string;
  provider: "pexels" | "pixabay";
  downloadUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  durationSeconds: number;
  attribution?: string;
  query: string;
};

const STOP_WORDS = new Set([
  "about", "after", "before", "camera", "cinematic", "close", "from", "into", "lighting", "scene",
  "shot", "style", "their", "there", "these", "this", "through", "video", "visual", "with"
]);

const CHINESE_STOCK_TERMS: Array<[RegExp, string]> = [
  [/包子|包子铺|馒头|面点|饺子|蒸笼/u, "steamed bao buns bamboo basket kitchen cooking"],
  [/幼儿园|学前|儿童|孩子/u, "kindergarten classroom children learning"],
  [/学校|课堂|教育|学习/u, "classroom students learning"],
  [/咖啡|烘焙|咖啡店/u, "coffee shop barista roasting coffee"],
  [/工地|施工|安全帽|高空作业/u, "construction workers safety equipment"],
  [/办公室|团队|企业|会议/u, "business team office meeting"],
  [/客户|客服|服务/u, "customer service agent helping customer"],
  [/仓库|库存|物流|包裹/u, "warehouse workers inventory logistics"],
  [/房产|楼盘|住宅|公寓/u, "modern apartment real estate interior"],
  [/金融|银行|投资/u, "financial advisor meeting client"],
  [/医疗|医院|医生|健康/u, "doctor patient modern hospital"],
  [/科技|软件|编程|电脑/u, "software developer working computer"],
  [/游戏|电竞/u, "gamer playing computer game"],
  [/餐厅|美食|厨房/u, "restaurant chef cooking kitchen"],
  [/旅行|旅游|酒店/u, "travel destination hotel guests"],
  [/制造|工厂|生产线/u, "factory workers production line"],
  [/农业|农场|种植/u, "farmer working sustainable farm"],
  [/环保|能源|太阳能/u, "renewable energy solar panels workers"]
];

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stockSearchTerms(scene: Pick<Scene, "title" | "voiceover" | "visualPrompt" | "style">) {
  const configured = scene.style.stockSearchTerms?.map((term) => term.trim()).filter(Boolean) ?? [];
  if (configured.length > 0) return configured.slice(0, 4);

  const source = `${scene.title} ${scene.voiceover} ${scene.visualPrompt}`;
  const mapped = CHINESE_STOCK_TERMS.filter(([pattern]) => pattern.test(source)).map(([, term]) => term);
  if (mapped.length > 0) return mapped.slice(0, 3);

  const englishWords = source.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const unique = [...new Set(englishWords.filter((word) => !STOP_WORDS.has(word)))];
  return unique.length > 0 ? [unique.slice(0, 7).join(" ")] : [];
}

export function hasFreeStockVideoProvider() {
  return Boolean(getOptionalEnv("PEXELS_API_KEY") || getOptionalEnv("PIXABAY_API_KEY"));
}

async function searchPexels(query: string): Promise<StockVideoCandidate[]> {
  const apiKey = getOptionalEnv("PEXELS_API_KEY");
  if (!apiKey) return [];
  const response = await fetch(`https://api.pexels.com/v1/videos/search?orientation=landscape&per_page=12&query=${encodeURIComponent(query)}`, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(18_000)
  });
  if (!response.ok) throw new Error(`Pexels search failed with ${response.status}`);
  const body = await response.json() as {
    videos?: Array<{
      id: number;
      url: string;
      duration: number;
      user?: { name?: string };
      video_files?: Array<{ link: string; width?: number; height?: number; file_type?: string; quality?: string }>;
    }>;
  };
  return (body.videos ?? []).flatMap((video) => {
    const files = (video.video_files ?? [])
      .filter((file) => file.file_type === "video/mp4" && (file.width ?? 0) >= 960 && (file.height ?? 0) >= 540)
      .sort((left, right) => Math.abs((left.width ?? 0) - 1280) - Math.abs((right.width ?? 0) - 1280));
    const file = files[0];
    return file ? [{
      id: String(video.id), provider: "pexels" as const, downloadUrl: file.link, pageUrl: video.url,
      width: file.width ?? 1280, height: file.height ?? 720, durationSeconds: video.duration,
      attribution: video.user?.name, query
    }] : [];
  });
}

async function searchPixabay(query: string): Promise<StockVideoCandidate[]> {
  const apiKey = getOptionalEnv("PIXABAY_API_KEY");
  if (!apiKey) return [];
  const response = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&safesearch=true&per_page=20`, {
    signal: AbortSignal.timeout(18_000)
  });
  if (!response.ok) throw new Error(`Pixabay search failed with ${response.status}`);
  const body = await response.json() as {
    hits?: Array<{
      id: number;
      pageURL: string;
      duration: number;
      user?: string;
      videos?: Record<string, { url?: string; width?: number; height?: number }>;
    }>;
  };
  return (body.hits ?? []).flatMap((video) => {
    const files = Object.values(video.videos ?? {})
      .filter((file) => file.url && (file.width ?? 0) >= 960 && (file.height ?? 0) >= 540)
      .sort((left, right) => Math.abs((left.width ?? 0) - 1280) - Math.abs((right.width ?? 0) - 1280));
    const file = files[0];
    return file?.url ? [{
      id: String(video.id), provider: "pixabay" as const, downloadUrl: file.url, pageUrl: video.pageURL,
      width: file.width ?? 1280, height: file.height ?? 720, durationSeconds: video.duration,
      attribution: video.user, query
    }] : [];
  });
}

async function findCandidate(scene: Scene, used: Set<string>) {
  const terms = stockSearchTerms(scene);
  for (const query of terms) {
    const settled = await Promise.allSettled([searchPexels(query), searchPixabay(query)]);
    const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const usable = candidates.filter((candidate) => !used.has(`${candidate.provider}:${candidate.id}`) && candidate.durationSeconds >= 3);
    if (usable.length === 0) continue;
    const index = stableHash(`${scene.id}:${scene.sceneNumber}:${query}`) % Math.min(usable.length, 6);
    return usable[index];
  }
  return undefined;
}

async function downloadCandidate(candidate: StockVideoCandidate) {
  const response = await fetch(candidate.downloadUrl, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`${candidate.provider} video download failed with ${response.status}`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > 80_000_000) throw new Error("Free stock video exceeds the 80 MB import limit");
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < 10_000 || body.byteLength > 80_000_000) throw new Error("Free stock video has an invalid file size");
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
  if (!contentType.startsWith("video/")) throw new Error("Free stock provider did not return a video");
  return { body, contentType };
}

async function importSceneStockVideo(
  project: Project,
  scene: Scene,
  used: Set<string>,
  recoveryFallback = false
) {
  const candidate = await findCandidate(scene, used);
  if (!candidate) throw new Error("No relevant free stock video was found");
  const downloaded = await downloadCandidate(candidate);
  const key = `stock/${project.id}/${project.currentVersion.id}/scene-${scene.sceneNumber}-${candidate.provider}-${candidate.id}-${crypto.randomUUID()}.mp4`;
  const uploaded = await uploadToR2({ key, body: downloaded.body, contentType: downloaded.contentType });
  used.add(`${candidate.provider}:${candidate.id}`);
  const availableOffset = Math.max(0, candidate.durationSeconds - scene.durationSeconds);
  const sourceStartSeconds = availableOffset > 0
    ? (stableHash(`${scene.id}:${candidate.id}:offset`) % Math.max(1, Math.floor(availableOffset * 10))) / 10
    : 0;
  return {
    id: crypto.randomUUID(),
    type: "clip",
    r2Key: uploaded.key,
    url: assetUrlForKey(uploaded.key, uploaded.publicUrl),
    metadata: {
      source: "free-stock-video",
      provider: candidate.provider,
      providerId: candidate.id,
      sourcePageUrl: candidate.pageUrl,
      attribution: candidate.attribution,
      searchQuery: candidate.query,
      width: candidate.width,
      height: candidate.height,
      duration: scene.durationSeconds,
      sourceDurationSeconds: candidate.durationSeconds,
      sourceStartSeconds,
      costUsd: 0,
      editingMethod: "moneyprinterturbo-inspired-stock-cut",
      recoveryFallback
    }
  } satisfies SceneAsset;
}

export async function generateProjectStockClips(
  project: Project,
  sceneNumbers: number[],
  options: { recoveryFallback?: boolean } = {}
) {
  if (!hasFreeStockVideoProvider()) throw new Error("Free stock video is not configured");
  const targets = new Set(sceneNumbers);
  const scenes = [...project.currentVersion.scenes];
  const used = new Set<string>(project.currentVersion.scenes.flatMap((scene) => (
    scene.assets.flatMap((asset) => {
      if (asset.metadata?.source !== "free-stock-video") return [];
      const provider = String(asset.metadata?.provider ?? "");
      const providerId = String(asset.metadata?.providerId ?? "");
      return provider && providerId ? [`${provider}:${providerId}`] : [];
    })
  )));
  const failures: Array<{ sceneNumber: number; error: unknown }> = [];
  const styleProtectedSceneNumbers: number[] = [];
  for (const [index, scene] of scenes.entries()) {
    if (!targets.has(scene.sceneNumber)) continue;
    if (!styleAllowsFreeStockVideo(scene.style)) {
      styleProtectedSceneNumbers.push(scene.sceneNumber);
      scenes[index] = {
        ...scene,
        style: {
          ...scene.style,
          motion: {
            mode: "local",
            preset: scene.style.motion?.preset ?? "auto",
            intensity: scene.style.motion?.intensity ?? "standard",
            seed: scene.style.motion?.seed ?? scene.sceneNumber
          }
        },
        assets: scene.assets.filter((asset) => asset.type !== "clip" || asset.metadata?.source !== "free-stock-video")
      };
      continue;
    }
    try {
      const clip = await importSceneStockVideo(project, scene, used, options.recoveryFallback === true);
      scenes[index] = {
        ...scene,
        style: {
          ...scene.style,
          motion: {
            mode: "ai",
            preset: scene.style.motion?.preset ?? "auto",
            intensity: scene.style.motion?.intensity ?? "standard",
            seed: scene.style.motion?.seed ?? scene.sceneNumber
          }
        },
        assets: [clip, ...scene.assets.filter((asset) => asset.type !== "clip")]
      };
    } catch (error) {
      failures.push({ sceneNumber: scene.sceneNumber, error });
      console.warn(`[stock-video-assets] Scene ${scene.sceneNumber} free stock import failed:`, error);
    }
  }
  return {
    project: { ...project, currentVersion: { ...project.currentVersion, renderUrl: undefined, status: "draft" as const, scenes } },
    failures,
    styleProtectedSceneNumbers
  };
}
