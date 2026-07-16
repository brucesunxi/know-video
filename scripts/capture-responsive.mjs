import { writeFile } from "node:fs/promises";

const [
  url,
  output,
  widthValue = "390",
  heightValue = "844",
  portValue = "9223",
  ...clickTexts
] = process.argv.slice(2);
if (!url || !output) {
  throw new Error("Usage: node scripts/capture-responsive.mjs <url> <output> [width] [height] [debug-port]");
}

const width = Number(widthValue);
const height = Number(heightValue);
const port = Number(portValue);
const target = await fetch(
  `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
  { method: "PUT" }
).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width <= 760
});
await send("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, 2_000));
for (const clickText of clickTexts) {
  const clicked = await send("Runtime.evaluate", {
    expression: `(() => {
      const target = ${JSON.stringify(clickText)};
      const control = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim().includes(target)
      );
      if (!control) return false;
      control.click();
      return true;
    })()`,
    returnByValue: true
  });
  if (!clicked.result.value) throw new Error(`Could not find button containing: ${clickText}`);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

const metrics = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  })`,
  returnByValue: true
});
const screenshot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
  fromSurface: true
});
await writeFile(output, Buffer.from(screenshot.data, "base64"));
console.log(metrics.result.value);
socket.close();
