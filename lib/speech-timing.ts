export function estimateNarrationSeconds(text: string) {
  const hanCharacters = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  const punctuationPauses = (text.match(/[，。！？；,.!?;]/g) ?? []).length * 0.16;
  return hanCharacters / 4.15 + latinWords / 2.7 + punctuationPauses;
}

export function speechRateForDuration(text: string, durationSeconds?: number) {
  if (!durationSeconds) return 0;
  const estimatedSeconds = estimateNarrationSeconds(text);
  const availableSeconds = Math.max(1.5, durationSeconds - 0.45);
  return Math.max(-20, Math.min(45, Math.round((estimatedSeconds / availableSeconds - 1) * 100)));
}

function id3v2Size(body: Buffer) {
  if (body.length < 10 || body.subarray(0, 3).toString("ascii") !== "ID3") return 0;
  const size = ((body[6] & 0x7f) << 21)
    | ((body[7] & 0x7f) << 14)
    | ((body[8] & 0x7f) << 7)
    | (body[9] & 0x7f);
  return Math.min(body.length, size + 10);
}

export function estimateCbrMp3Duration(body: Buffer, bitrateKbps: number) {
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0 || body.length === 0) return 0;
  const audioBytes = Math.max(0, body.length - id3v2Size(body));
  return (audioBytes * 8) / (bitrateKbps * 1000);
}

export function correctedSpeechRate(currentRate: number, actualSeconds: number, targetSeconds: number) {
  if (actualSeconds <= 0 || targetSeconds <= 0) return currentRate;
  const currentFactor = 1 + currentRate / 100;
  const requiredFactor = currentFactor * (actualSeconds / targetSeconds);
  return Math.max(-20, Math.min(45, Math.round((requiredFactor - 1) * 100)));
}
