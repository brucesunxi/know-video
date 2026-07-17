export async function postRenderCallback(input, payload, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maximumAttempts = payload.status === "running" ? 3 : 6;
  let lastError;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(input.callbackUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ ...payload, sandboxName: input.sandboxName }),
        signal: AbortSignal.timeout(15_000)
      });
      if (response.ok) return;
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Render callback returned ${response.status}${detail ? `: ${detail}` : ""}`);
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts) break;
      await wait(Math.min(5_000, 750 * (2 ** (attempt - 1))));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Render callback failed");
}
