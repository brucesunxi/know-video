import sharp from "sharp";

type ImageSignature = {
  luminanceBits: Uint8Array;
  edgeBits: Uint8Array;
  colors: Uint8Array;
};

const SIGNATURE_WIDTH = 20;
const SIGNATURE_HEIGHT = 12;

async function imageSignature(body: Buffer): Promise<ImageSignature> {
  const { data, info } = await sharp(body, { failOn: "warning" })
    .rotate()
    .resize(SIGNATURE_WIDTH, SIGNATURE_HEIGHT, { fit: "fill" })
    .blur(0.65)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const luminance = new Float32Array(pixels);
  let luminanceTotal = 0;

  for (let index = 0; index < pixels; index += 1) {
    const offset = index * info.channels;
    const value = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    luminance[index] = value;
    luminanceTotal += value;
  }

  const mean = luminanceTotal / Math.max(1, pixels);
  const luminanceBits = Uint8Array.from(luminance, (value) => value >= mean ? 1 : 0);
  const edgeBits = new Uint8Array((info.width - 1) * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width - 1; x += 1) {
      const left = luminance[y * info.width + x];
      const right = luminance[y * info.width + x + 1];
      edgeBits[y * (info.width - 1) + x] = right >= left ? 1 : 0;
    }
  }

  return {
    luminanceBits,
    edgeBits,
    colors: Uint8Array.from(data)
  };
}

function bitAgreement(left: Uint8Array, right: Uint8Array) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let matches = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) matches += 1;
  }
  return matches / length;
}

function colorSimilarity(left: Uint8Array, right: Uint8Array) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let absoluteDifference = 0;
  for (let index = 0; index < length; index += 1) {
    absoluteDifference += Math.abs(left[index] - right[index]);
  }
  return Math.max(0, 1 - absoluteDifference / (length * 255));
}

export async function imagePerceptualSimilarity(left: Buffer, right: Buffer) {
  const [leftSignature, rightSignature] = await Promise.all([
    imageSignature(left),
    imageSignature(right)
  ]);
  const luminance = bitAgreement(leftSignature.luminanceBits, rightSignature.luminanceBits);
  const edges = bitAgreement(leftSignature.edgeBits, rightSignature.edgeBits);
  const colors = colorSimilarity(leftSignature.colors, rightSignature.colors);
  return Number((luminance * 0.5 + edges * 0.35 + colors * 0.15).toFixed(4));
}

export const ADJACENT_SCENE_DUPLICATE_THRESHOLD = 0.89;
// Frames above this lower threshold receive a semantic shot-composition review.
// Pixel similarity alone misses the same pose and camera setup when the model
// changes palette, lighting, clothing, or rendering medium.
export const POSSIBLE_SCENE_DUPLICATE_THRESHOLD = 0.7;
