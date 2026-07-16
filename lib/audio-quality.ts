export type AudioInspection = {
  format: "mp3" | "wav";
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  frameCount?: number;
  rms?: number;
};

const mpeg1Layer3Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Layer3Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const sampleRates = [44_100, 48_000, 32_000];

function id3v2Size(body: Buffer) {
  if (body.length < 10 || body.subarray(0, 3).toString("ascii") !== "ID3") return 0;
  const size = ((body[6] & 0x7f) << 21)
    | ((body[7] & 0x7f) << 14)
    | ((body[8] & 0x7f) << 7)
    | (body[9] & 0x7f);
  return Math.min(body.length, size + 10);
}

function inspectMp3(body: Buffer): AudioInspection | undefined {
  let offset = id3v2Size(body);
  let durationSeconds = 0;
  let frameCount = 0;
  let detectedRate = 0;
  let channels = 0;

  while (offset + 4 <= body.length) {
    if (body[offset] !== 0xff || (body[offset + 1] & 0xe0) !== 0xe0) {
      if (frameCount > 0) break;
      offset += 1;
      continue;
    }
    const versionBits = (body[offset + 1] >> 3) & 0x03;
    const layerBits = (body[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (body[offset + 2] >> 4) & 0x0f;
    const rateIndex = (body[offset + 2] >> 2) & 0x03;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      if (frameCount > 0) break;
      offset += 1;
      continue;
    }
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const bitrate = (version === 1 ? mpeg1Layer3Bitrates : mpeg2Layer3Bitrates)[bitrateIndex];
    const rateDivisor = version === 1 ? 1 : version === 2 ? 2 : 4;
    const sampleRate = sampleRates[rateIndex] / rateDivisor;
    const padding = (body[offset + 2] >> 1) & 0x01;
    const frameLength = Math.floor(((version === 1 ? 144_000 : 72_000) * bitrate) / sampleRate) + padding;
    if (frameLength < 24 || offset + frameLength > body.length) break;
    const samplesPerFrame = version === 1 ? 1152 : 576;
    durationSeconds += samplesPerFrame / sampleRate;
    frameCount += 1;
    detectedRate ||= sampleRate;
    channels ||= ((body[offset + 3] >> 6) & 0x03) === 3 ? 1 : 2;
    offset += frameLength;
  }

  if (frameCount < 3 || durationSeconds <= 0) return undefined;
  return {
    format: "mp3",
    durationSeconds,
    sampleRate: detectedRate,
    channels,
    frameCount
  };
}

function inspectWav(body: Buffer): AudioInspection | undefined {
  if (
    body.length < 44
    || body.subarray(0, 4).toString("ascii") !== "RIFF"
    || body.subarray(8, 12).toString("ascii") !== "WAVE"
  ) return undefined;

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= body.length) {
    const name = body.subarray(offset, offset + 4).toString("ascii");
    const size = body.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > body.length) return undefined;
    if (name === "fmt " && size >= 16) {
      audioFormat = body.readUInt16LE(start);
      channels = body.readUInt16LE(start + 2);
      sampleRate = body.readUInt32LE(start + 4);
      bitsPerSample = body.readUInt16LE(start + 14);
    } else if (name === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (audioFormat !== 1 || channels < 1 || sampleRate < 8_000 || bitsPerSample !== 16 || dataSize < 2) {
    return undefined;
  }
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const durationSeconds = dataSize / bytesPerSecond;
  const sampleCount = Math.floor(dataSize / 2);
  const stride = Math.max(1, Math.floor(sampleCount / 24_000));
  let squareSum = 0;
  let inspected = 0;
  for (let index = 0; index < sampleCount; index += stride) {
    const value = body.readInt16LE(dataOffset + index * 2) / 32_768;
    squareSum += value * value;
    inspected += 1;
  }
  const rms = inspected > 0 ? Math.sqrt(squareSum / inspected) : 0;
  return { format: "wav", durationSeconds, sampleRate, channels, rms };
}

export function inspectAudio(body: Buffer) {
  return inspectWav(body) ?? inspectMp3(body);
}

export function assertUsableSpeechAudio(
  body: Buffer,
  options: { targetDurationSeconds?: number } = {}
) {
  const inspection = inspectAudio(body);
  if (!inspection) throw new Error("语音服务返回了无法解码的音频。");
  if (inspection.durationSeconds < 0.35) throw new Error("语音服务返回的音频过短。");
  if (inspection.format === "wav" && (inspection.rms ?? 0) < 0.0015) {
    throw new Error("语音服务返回的音频接近静音。");
  }
  if (
    options.targetDurationSeconds
    && inspection.durationSeconds > options.targetDurationSeconds + 0.18
  ) {
    throw new Error("旁白内容过长，无法在当前场景时长内自然读完。");
  }
  return inspection;
}
