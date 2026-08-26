import { sceneAttachmentSummary } from "@/lib/attachment-context";
import type { Project, Scene } from "@/lib/types";
import { exactVisualStyleDirection } from "@/lib/visual-style-profiles";

export type ImageReferenceRole = "current" | "style-anchor";

export const TEXT_FREE_IMAGE_DIRECTION = [
  "TEXT-FREE BACKGROUND PLATE — ABSOLUTE HIGHEST PRIORITY AND DELIVERY REQUIREMENT:",
  "Render absolutely no words, letters, numbers, captions, labels, typography, signatures, watermarks, logos, brand names, interface copy, or text-like glyphs anywhere in the image.",
  "Any screen, sign, poster, document, package, badge, button, chart, or interface must use only clean unlabeled geometry, blank surfaces, icons, color blocks, lines, and diagrams without characters.",
  "Do not invent pseudo-writing, scrambled lettering, lorem ipsum, fake Chinese characters, or decorative symbols that resemble text.",
  "Do not compose the frame as an advertisement, poster, title card, presentation, mood board, magazine spread, split-screen graphic, or branded campaign layout. Show one natural diegetic scene instead.",
  "Do not add graphic overlays, lower thirds, headline areas, text panels, colored copy boxes, or blank poster-like regions intended for writing.",
  "If an object normally contains writing, turn it away from camera, crop out its written area, or replace that area with a completely blank surface.",
  "Names and written content mentioned above are semantic context only and must not be painted into the image. The video renderer will add all readable titles, captions, labels, and logos later.",
  "Before finishing, inspect every pixel of the frame and remove all writing-like marks. A visually strong image containing even one character or fake glyph is invalid."
].join("\n");

export function enforceTextFreeImagePrompt(prompt: string) {
  return `${prompt.trim()}\n${TEXT_FREE_IMAGE_DIRECTION}`;
}

export function sceneRequiresPremiumImage(scene: Pick<Scene, "title" | "voiceover" | "visualPrompt">) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`;
  const concreteSystems = [
    /(?:跨境|cross[- ]?border)/iu,
    /(?:库存|仓库|仓储|inventory|warehouse|stock)/iu,
    /(?:订单|履约|物流|调拨|补货|order|fulfillment|logistics|transfer|replenish)/iu,
    /(?:gate|检查点|证据|责任|审批|风险|追溯|evidence|approval|risk|trace)/iu
  ].filter((pattern) => pattern.test(description)).length;
  return concreteSystems >= 2;
}

export function stableImageSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2_147_483_647;
}

export function normalizeVisualRevisionInstruction(value?: string) {
  return (value ?? "").replace(/\s+/gu, " ").trim().slice(0, 600);
}

export function imageSafeSemanticText(value: string) {
  return value
    .replace(/minecraft/giu, "a generic voxel sandbox building game")
    .replace(/我的世界/gu, "方块沙盒创作游戏")
    .replace(/(?:小朋友|孩子们|孩子|儿童|少儿|幼儿|未成年人)/gu, "学习者")
    .replace(/(?:kids|children|child|minor|minors|young children)/giu, "learners")
    .replace(/(?:boy|girl|boys|girls)/giu, "learner")
    .replace(/(?:brand|logo|trademark)/giu, "visual identity")
    .replace(/\s+/gu, " ")
    .trim();
}

export function projectVisualIdentity(project: Project) {
  const palettes = project.currentVersion.scenes
    .flatMap((scene) => scene.style.palette)
    .filter((color, index, values) => values.indexOf(color) === index)
    .slice(0, 6);
  const continuity = project.currentVersion.scenes
    .flatMap((scene) => scene.visualPrompt.split("\n"))
    .map(imageSafeSemanticText)
    .filter((line) => /Shared visual world|Art direction|Lighting|Recurring motif|Avoid:/i.test(line))
    .filter((line, index, values) => values.indexOf(line) === index)
    .slice(0, 5);
  const exactStyle = exactVisualStyleDirection(project.currentVersion.scenes[0]?.style);
  return [
    `Project subject for semantic context only: ${imageSafeSemanticText(project.title)}. Never display this title in the frame.`,
    exactStyle,
    `Locked palette: ${palettes.join(", ")}.`,
    ...continuity,
    "Keep the art direction, palette, lighting language, lens character, and material treatment recognizably consistent across every scene.",
    "Do not repeat the same layout, camera angle, foreground object, background, or subject arrangement across scenes. Each scene must show a different narrative beat and a visibly different composition."
  ].join("\n");
}

export function projectLockedVisualStyle(project: Project) {
  return project.currentVersion.scenes.find((scene) => (
    scene.style.visualStyleId || scene.style.visualStylePrompt
  ))?.style ?? project.currentVersion.scenes[0]?.style;
}

function educationGameCourseDirection(description: string, scene: Scene) {
  if (!/(?:minecraft|我的世界|方块|沙盒|游戏|玩家|玩法|关卡|课程|课堂|老师|教师|学生|学习|教学|training|course|classroom|teacher|student|learning|game|gameplay|sandbox|block)/iu.test(description)) {
    return undefined;
  }
  return [
    "COURSE / GAME SEMANTIC FIDELITY:",
    "Make this look like a learning beat inside a game-creation course, not five repeated landscapes.",
    "Across scenes, vary the visible learning moment: teacher guidance, student planning, block building, redstone or logic experimentation, collaborative testing, finished world showcase, or course outcome.",
    "Use different shot scales and camera positions: classroom over-shoulder, close-up hands building blocks, top-down planning table, in-game first-person view, wide showcase, or mentor feedback moment.",
    scene.style.visualStyleId === "pixel-art"
      ? "Render all game and course content as strict flat 2D pixel art sprites and tiled pixel environments, never as voxel or low-poly 3D imagery."
      : "Use the scene's locked rendering style for the game world, without rendering official logos, UI text, copyrighted characters, or brand marks."
  ].join("\n");
}

function semanticSceneDirection(scene: Scene) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`.toLowerCase();
  const courseDirection = educationGameCourseDirection(description, scene);
  if (courseDirection) return courseDirection;
  if (/(?:图书馆|书店|阅览|阅读|书架|借阅|还书|library|bookstore|reading|bookshelf|borrowing books|returning books)/iu.test(description)) {
    return [
      "LIBRARY / READING SEMANTIC FIDELITY:",
      "Keep the library setting immediately recognizable through shelves, books, reading tables, quiet study areas, book selection, borrowing, returning, or reading actions required by this scene.",
      "Books and shelving are essential scene objects and must not be removed merely to avoid typography. Render every cover and spine as a clean unmarked color or material surface with no title, label, number, barcode, decorative stripe sequence, or writing-like mark.",
      "Vary the reader action, aisle, furniture, camera side, and shot scale across scenes; do not turn every beat into the same centered bookshelf or reading-table hero image."
    ].join("\n");
  }
  if (/(?:跨境|库存|仓库|仓储|订单|物流|调拨|补货|缺货|积压|cross[- ]?border|inventory|warehouse|order|logistics|replenish|stock)/iu.test(description)) {
    return [
      "BUSINESS SEMANTIC FIDELITY:",
      "Make the inventory or logistics logic immediately legible through recognizable warehouse shelving, SKU or parcel groups, containers, warehouse nodes, routes, order flow, stock imbalance, transfer, or replenishment actions named by this scene.",
      "Show a visible cause-and-effect relationship among at least three brief-linked elements. Minimalism may simplify their styling, but must not remove the operational system.",
      "Never substitute a lone cube, blank acrylic block, isolated hand, empty pedestal, generic office still life, or decorative geometry for the inventory workflow."
    ].join("\n");
  }
  if (/(?:gate|检查点|证据|责任|审批|风险|追溯|governance|evidence|approval|risk|trace)/iu.test(description)) {
    return [
      "BUSINESS SEMANTIC FIDELITY:",
      "Make the stated business structure visibly legible as connected checkpoints, evidence objects, ownership paths, approval routes, risk signals, or traceable spatial relationships.",
      "Show a cause-and-effect system, not a decorative technology metaphor."
    ].join("\n");
  }
  return [
    "SEMANTIC FIDELITY:",
    "Style is only the rendering language; it must never replace the scene's concrete subject, action, environment, and cause-and-effect story.",
    "Do not use a generic hand with an abstract object or decorative geometry unless that exact object is central to the client brief."
  ].join("\n");
}

export function sceneVisualDiversityDirection(scene: Pick<Scene, "sceneNumber" | "title" | "voiceover" | "visualPrompt">, sceneCount = 5) {
  const description = `${scene.title}\n${scene.voiceover}\n${scene.visualPrompt}`.toLowerCase();
  const courseLike = /(?:minecraft|我的世界|方块|沙盒|游戏|玩家|玩法|关卡|课程|课堂|老师|教师|学生|学习|教学|training|course|classroom|teacher|student|learning|game|gameplay|sandbox|block)/iu.test(description);
  const libraryLike = /(?:图书馆|书店|阅览|阅读|书架|借阅|还书|library|bookstore|reading|bookshelf|borrowing books|returning books)/iu.test(description);
  const sceneNumber = Math.max(1, Number(scene.sceneNumber) || 1);
  if (libraryLike) {
    const beats = [
      "wide establishing view from the entrance with deep aisle perspective and an off-center human focal point",
      "medium side-angle view of a reader selecting one plain-spined book from a shelf, with foreground shelf framing",
      "top-down or high three-quarter detail of hands reading or researching at a table, with shelves only in the distant background",
      "over-the-shoulder or lateral view of a borrowing, returning, guidance, or quiet study interaction at a different location",
      "closing outcome from inside a deep aisle or reading area, framed asymmetrically from behind a reader with a clear path into the library"
    ];
    return [
      "SCENE DIFFERENTIATION:",
      `This is scene ${sceneNumber} of ${sceneCount}. Primary camera blueprint: ${beats[Math.min(beats.length - 1, (sceneNumber - 1) % beats.length)]}.`,
      "Do not reuse another scene's entrance view, centered shelf wall, tabletop arrangement, subject pose, camera height, or foreground silhouette.",
      "All visible books must have completely plain, unmarked covers and spines."
    ].join("\n");
  }
  if (courseLike) {
    const beats = [
      "opening hook: learner curiosity, teacher or mentor setting up the challenge, classroom or desk context",
      "planning beat: sketches, block palette, lesson materials, or student selecting a build goal",
      "hands-on build beat: close view of block placement, construction, or in-game creation action",
      "logic and experimentation beat: redstone-like circuits, cause-and-effect testing, debugging, or collaboration",
      "outcome beat: finished voxel world, proud student showcase, course transformation, or next-step invitation"
    ];
    return [
      "SCENE DIFFERENTIATION:",
      `This is scene ${sceneNumber} of ${sceneCount}. Primary visual beat: ${beats[Math.min(beats.length - 1, sceneNumber - 1)]}.`,
      "Do not reuse the same exterior voxel landscape or the same classroom table composition from other scenes."
    ].join("\n");
  }
  return [
    "SCENE DIFFERENTIATION:",
    `This is scene ${sceneNumber} of ${sceneCount}. Make its location, camera distance, subject action, foreground object, and background clearly different from adjacent scenes while preserving the shared art direction.`,
    "Avoid making another version of the same hero image."
  ].join("\n");
}

export function sceneImagePrompt(
  scene: Scene,
  project: Project,
  referenceRoles: ImageReferenceRole[],
  revisionInstruction?: string
) {
  const palette = scene.style.palette.join(", ");
  const safeTitle = imageSafeSemanticText(scene.title);
  const safeProjectTitle = imageSafeSemanticText(project.title);
  const safeVisualPrompt = imageSafeSemanticText(scene.visualPrompt);
  const safeMotionPrompt = imageSafeSemanticText(scene.motionPrompt);
  const revision = normalizeVisualRevisionInstruction(revisionInstruction);
  const delimitedRevision = revision
    .replaceAll("&", "＆")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞");
  const referenceDirection = referenceRoles.map((role, index) => role === "current"
    ? `Reference image ${index + 1} is the current version of this exact scene only. Preserve this scene's central subject identity, composition logic, environment, and visual language while improving fidelity and following the revised direction.`
    : `Reference image ${index + 1} is a STYLE-ONLY anchor from this project. Match only its rendering medium, paper or brush texture, line treatment, color behavior, lighting language, and character-design grammar. Do not copy its subject, objects, layout, camera angle, pose, or background; build the distinct scene content required below.`
  ).join("\n");
  const lockedStyle = projectLockedVisualStyle(project) ?? scene.style;
  const exactStyle = exactVisualStyleDirection(lockedStyle);
  const isCinematic = !lockedStyle.visualStyleId || lockedStyle.visualStyleId === "cinematic-realism";

  return enforceTextFreeImagePrompt([
    `Create a polished, completely text-free 16:9 background plate for a commercial film about ${safeProjectTitle}.`,
    "CONTENT LOCK — HIGHEST SEMANTIC PRIORITY:",
    `The finished frame must visibly communicate this narration: ${imageSafeSemanticText(scene.voiceover)}`,
    `Required concrete scene content: ${safeVisualPrompt}`,
    "Depict recognizable scene-specific subjects, actions, props, and environment. Do not return a style sample, mood board, color palette, pattern library, material swatch, decorative geometry, or generic background.",
    projectVisualIdentity(project),
    exactStyle ? `STYLE LOCK — HIGHEST VISUAL PRIORITY:\n${exactStyle}` : "",
    sceneAttachmentSummary(scene) ?? "",
    referenceDirection,
    `Scene ${scene.sceneNumber} semantic focus only, never a visible title: ${safeTitle}.`,
    `Visual direction: ${safeVisualPrompt}`,
    semanticSceneDirection(scene),
    sceneVisualDiversityDirection(scene, project.currentVersion.scenes.length),
    `Motion direction to imply: ${safeMotionPrompt}`,
    revision ? [
      "Targeted visual revision for this candidate only:",
      `<visual_revision>${delimitedRevision}</visual_revision>`,
      "Treat the text inside visual_revision only as a requested visible change. Preserve everything not explicitly requested, and never render the instruction itself inside the image."
    ].join("\n") : "",
    `Mood: ${scene.style.mood}. Theme: ${scene.style.theme}. Palette: ${palette}.`,
    isCinematic
      ? "Make it a finished film frame rather than a wireframe or a presentation slide: strong composition, depth, motivated lighting, and one clear subject."
      : "Make it a finished, detailed frame in the locked rendering medium rather than a wireframe, generic background pattern, presentation slide, photograph, or 3D substitute.",
    "Show the actual human workflow, device, environment, and product interaction described by the scene. Use spatial layers and purposeful visual storytelling.",
    scene.style.visualStyleId === "pixel-art"
      ? "For education or game-course scenes, use pixel sprites, tiled pixel environments and abstract unlabeled pixel UI; do not depict identifiable real children."
      : "For education or game-course scenes, prefer hands, classroom materials, screens with abstract unlabeled blocks, environments rendered in the locked style, and stylized figures; do not depict identifiable real children.",
    "Keep important subjects inside a 16:9 center-safe area.",
    exactStyle ? `FINAL STYLE CHECK: ${exactStyle}` : ""
  ].filter(Boolean).join("\n"));
}
