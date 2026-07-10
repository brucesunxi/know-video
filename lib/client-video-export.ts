import type { Project } from "@/lib/types";

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load a scene image."));
    image.src = url;
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  direction: number
) {
  const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const scale = baseScale * (1.03 + progress * 0.07);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const travel = Math.max(0, drawWidth - width) * 0.32;
  const x = (width - drawWidth) / 2 + (progress - 0.5) * travel * direction;
  const y = (height - drawHeight) / 2 - progress * Math.max(0, drawHeight - height) * 0.12;
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const characters = Array.from(value.trim());
  const lines: string[] = [];
  let current = "";

  for (const character of characters) {
    const candidate = current + character;
    if (context.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = character;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export async function exportProjectWebm(project: Project, onProgress: (progress: number) => void) {
  const sceneImages = project.currentVersion.scenes.map((scene) =>
    scene.assets.find((asset) => asset.type === "image" && asset.url)?.url
  );
  if (sceneImages.some((url) => !url)) {
    throw new Error("请先为所有场景生成画面，再导出视频。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建视频画布。");

  const images = await Promise.all(sceneImages.map((url) => loadImage(url as string)));
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("当前浏览器不支持 WebM 视频导出。");

  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("视频编码失败。"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  const totalDuration = project.currentVersion.durationSeconds;
  const startedAt = performance.now();
  recorder.start(1000);

  await new Promise<void>((resolve) => {
    const renderFrame = (now: number) => {
      const elapsed = Math.min(totalDuration, (now - startedAt) / 1000);
      let sceneStart = 0;
      let sceneIndex = 0;
      for (let index = 0; index < project.currentVersion.scenes.length; index += 1) {
        const duration = project.currentVersion.scenes[index].durationSeconds;
        if (elapsed < sceneStart + duration || index === project.currentVersion.scenes.length - 1) {
          sceneIndex = index;
          break;
        }
        sceneStart += duration;
      }

      const scene = project.currentVersion.scenes[sceneIndex];
      const localProgress = Math.min(1, Math.max(0, (elapsed - sceneStart) / scene.durationSeconds));
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawCover(context, images[sceneIndex], canvas.width, canvas.height, localProgress, sceneIndex % 2 === 0 ? 1 : -1);

      const shade = context.createLinearGradient(0, 0, 0, canvas.height);
      shade.addColorStop(0, "rgba(3, 8, 18, 0.20)");
      shade.addColorStop(0.55, "rgba(3, 8, 18, 0.06)");
      shade.addColorStop(1, "rgba(3, 8, 18, 0.82)");
      context.fillStyle = shade;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "rgba(255,255,255,0.78)";
      context.font = "700 18px Arial, sans-serif";
      context.fillText(`KNOW VIDEO  ·  SCENE ${scene.sceneNumber}`, 58, 58);
      context.fillStyle = "#ffffff";
      context.font = "800 46px Arial, sans-serif";
      context.fillText(scene.title.slice(0, 32), 58, 570);
      context.font = "500 25px Arial, sans-serif";
      const lines = wrapText(context, scene.voiceover, 1120, 2);
      lines.forEach((line, index) => context.fillText(line, 58, 620 + index * 34));

      const fade = Math.min(1, localProgress / 0.08, (1 - localProgress) / 0.08);
      context.fillStyle = `rgba(3, 8, 18, ${1 - Math.max(0, fade)})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

      onProgress(Math.round((elapsed / totalDuration) * 100));
      if (elapsed >= totalDuration) {
        resolve();
        return;
      }
      requestAnimationFrame(renderFrame);
    };
    requestAnimationFrame(renderFrame);
  });

  recorder.stop();
  const blob = await finished;
  stream.getTracks().forEach((track) => track.stop());
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.title.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").replace(/^-|-$/g, "") || "know-video"}.webm`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
