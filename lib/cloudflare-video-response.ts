type UnifiedVideoGeneration = {
  state?: string;
  result?: {
    video?: string;
  };
};

export function parseCloudflareVideoUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as { state?: unknown; result?: unknown };
  const generation = typeof root.state === "string"
    ? root
    : root.result && typeof root.result === "object"
      ? root.result as { state?: unknown; result?: unknown }
      : undefined;
  if (!generation || generation.state !== "Completed") return undefined;
  if (!generation.result || typeof generation.result !== "object") return undefined;
  const video = (generation.result as UnifiedVideoGeneration["result"])?.video;
  return typeof video === "string" && /^https:\/\//i.test(video) ? video : undefined;
}

export function isMp4Buffer(body: Buffer) {
  return body.length >= 12 && body.subarray(4, 8).toString("ascii") === "ftyp";
}
