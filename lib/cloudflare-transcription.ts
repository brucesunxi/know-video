export type CloudflareTranscriptionResult = {
  text?: string;
  transcription_info?: { text?: string };
};

export function parseCloudflareTranscript(result: CloudflareTranscriptionResult) {
  const transcript = result.transcription_info?.text || result.text;
  const normalized = transcript?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 8_000) : undefined;
}
