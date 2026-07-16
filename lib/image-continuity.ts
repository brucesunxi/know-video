import type { Project, Scene } from "@/lib/types";

export type ImageReferenceRole = "current" | "anchor";

export function stableImageSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2_147_483_647;
}

export function projectVisualIdentity(project: Project) {
  const palettes = project.currentVersion.scenes
    .flatMap((scene) => scene.style.palette)
    .filter((color, index, values) => values.indexOf(color) === index)
    .slice(0, 6);
  const continuity = project.currentVersion.scenes
    .flatMap((scene) => scene.visualPrompt.split("\n"))
    .filter((line) => /Shared visual world|Art direction|Lighting|Recurring motif|Avoid:/i.test(line))
    .filter((line, index, values) => values.indexOf(line) === index)
    .slice(0, 5);
  return [
    `Project visual identity: "${project.title}".`,
    `Locked palette: ${palettes.join(", ")}.`,
    ...continuity,
    "Keep recurring people, products, wardrobe, architecture, material language, lighting direction, lens character, and color treatment recognizably consistent across every scene.",
    "Do not redesign recurring subjects between scenes. Changes in shot scale and action are allowed; identity and art direction are locked."
  ].join("\n");
}

export function sceneImagePrompt(
  scene: Scene,
  project: Project,
  referenceRoles: ImageReferenceRole[]
) {
  const palette = scene.style.palette.join(", ");
  const referenceDirection = referenceRoles.map((role, index) => role === "current"
    ? `Reference image ${index} is the current version of this exact scene. Preserve its central subject identity, composition logic, environment, and visual language while improving fidelity and following the revised direction.`
    : `Reference image ${index} is the project's visual anchor. Match its recurring subject identity, design language, materials, lighting, lens character, and color treatment without copying its exact composition.`).join("\n");

  return [
    `Create a polished 16:9 key visual for a scene in a product video called "${project.title}".`,
    projectVisualIdentity(project),
    referenceDirection,
    `Scene ${scene.sceneNumber}: ${scene.title}.`,
    `Visual direction: ${scene.visualPrompt}`,
    `Motion direction to imply: ${scene.motionPrompt}`,
    `Mood: ${scene.style.mood}. Theme: ${scene.style.theme}. Palette: ${palette}.`,
    "Make it a finished cinematic frame rather than a wireframe or a presentation slide: strong composition, depth, premium lighting, and one clear subject.",
    "Show the actual human workflow, device, environment, and product interaction described by the scene. Use spatial layers and purposeful visual storytelling.",
    "Use little or no text inside the generated image. Never show prompt instructions, layout annotations, labels, lorem ipsum, fake logos, watermarks, or generic floating cards.",
    "Keep important subjects inside a 16:9 center-safe area."
  ].filter(Boolean).join("\n");
}
