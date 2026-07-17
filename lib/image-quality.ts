import sharp from "sharp";

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

export class GeneratedImageQualityError extends Error {}

export async function normalizeGeneratedImage(body: Buffer) {
  if (body.length < 8_000) throw new GeneratedImageQualityError("生成图片文件过小。");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(body, { failOn: "warning" }).rotate().metadata();
  } catch (error) {
    throw new GeneratedImageQualityError("图片服务返回了无法解析的文件。", { cause: error });
  }
  if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 288) {
    throw new GeneratedImageQualityError("生成图片分辨率过低。");
  }
  if (!metadata.format || !["jpeg", "png", "webp", "avif"].includes(metadata.format)) {
    throw new GeneratedImageQualityError("图片服务返回了不支持的格式。");
  }

  const normalized = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "attention" })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
  const stats = await sharp(normalized)
    .resize(160, 90, { fit: "fill" })
    .greyscale()
    .stats();
  const entropy = stats.entropy ?? 0;
  const standardDeviation = stats.channels[0]?.stdev ?? 0;
  if (entropy < 0.8 || standardDeviation < 5) {
    throw new GeneratedImageQualityError("生成画面过于空白或缺少可辨识内容。");
  }

  return {
    body: normalized,
    metadata: {
      sourceFormat: metadata.format,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      entropy: Number(entropy.toFixed(3)),
      standardDeviation: Number(standardDeviation.toFixed(3))
    }
  };
}
