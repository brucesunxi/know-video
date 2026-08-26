import type { GenerationOptions } from "@/lib/types";

export type VisualStyleName = GenerationOptions["style"];

export const visualStyleProfiles: Record<VisualStyleName, {
  key: "cinematic" | "minimal" | "vivid" | "warm";
  label: VisualStyleName;
  palette: string[];
  artDirection: string;
  lighting: string;
  cameraLanguage: string;
  materials: string;
  composition: string;
  avoid: string;
}> = {
  电影质感: {
    key: "cinematic",
    label: "电影质感",
    palette: ["#0B1220", "#1E3448", "#2DD4BF", "#F5C56B", "#F8FAFC"],
    artDirection: "cinematic corporate film, dramatic depth, realistic environments, visible human stakes, premium commercial production value",
    lighting: "low-key directional lighting, soft haze, rim light, controlled shadows, teal-and-warm-gold contrast",
    cameraLanguage: "35mm or 50mm lens, dolly push-ins, low-angle hero frames, shallow depth of field, motivated match cuts",
    materials: "glass, brushed metal, dark fabric, concrete, subtle reflections, volumetric light",
    composition: "layered foreground-midground-background depth, strong leading lines, one clear hero subject, restrained negative space",
    avoid: "flat white UI mockups, pastel palettes, cute shapes, lifestyle stock-photo warmth, cartoon energy"
  },
  极简高级: {
    key: "minimal",
    label: "极简高级",
    palette: ["#F8FAFC", "#E5EDF3", "#111827", "#0F766E", "#CBD5E1"],
    artDirection: "premium minimalist brand film, quiet luxury, precise spacing, visually explicit business logic, editorial restraint",
    lighting: "bright softbox lighting, airy shadows, clean white or pale gray environments, controlled highlights",
    cameraLanguage: "locked-off symmetry, slow lateral slides, overhead precision shots, macro details, calm transitions",
    materials: "matte glass, white ceramic, satin metal, paper, clear acrylic, fine grid texture",
    composition: "asymmetric negative space around a complete cause-and-effect scene, exact alignment, a limited set of recognizable information-bearing objects connected by a clear action or route",
    avoid: "empty abstract tableaux, lone cubes or acrylic blocks, meaningless hands, decorative geometry without business meaning, busy control rooms, neon sci-fi, dramatic smoke, heavy gradients, crowded teams, loud saturated colors"
  },
  明快有活力: {
    key: "vivid",
    label: "明快有活力",
    palette: ["#FFFFFF", "#2563EB", "#14B8A6", "#F97316", "#FACC15"],
    artDirection: "bright energetic launch film, optimistic SaaS momentum, clear actions, modern colorful product storytelling",
    lighting: "high-key daylight, crisp highlights, clean shadows, lively accent colors, fresh studio brightness",
    cameraLanguage: "quick push-ins, whip-pan inspired transitions, overhead-to-medium reveals, snappy parallax, rhythmic cuts",
    materials: "color glass, acrylic panels, light wood, whiteboards, dynamic markers, polished screens",
    composition: "diagonal movement, visible progress paths, modular scenes, active human gestures, energetic spacing",
    avoid: "dark moody rooms, slow solemn camera, beige warmth, monochrome minimalism, overly serious boardroom stillness"
  },
  温暖自然: {
    key: "warm",
    label: "温暖自然",
    palette: ["#FFF7ED", "#D6A35D", "#3F5F4A", "#7C6A58", "#1F2937"],
    artDirection: "warm human-centered commercial film, natural collaboration, trustworthy product value, approachable realism",
    lighting: "soft window light, golden-hour warmth, gentle shadows, practical lamps, natural skin tones",
    cameraLanguage: "handheld micro-movement, medium close-ups, over-the-shoulder collaboration shots, soft rack focus",
    materials: "wood, paper, linen, warm glass, plants, notebooks, softly lit workspaces",
    composition: "human faces and hands, tactile work surfaces, comfortable spacing, authentic lived-in environments",
    avoid: "cold neon sci-fi, sterile white minimalism, abstract tech grids, hyper-saturated startup graphics, harsh contrast"
  }
};

export function visualStyleProfile(style?: GenerationOptions["style"]) {
  return visualStyleProfiles[style ?? "电影质感"] ?? visualStyleProfiles["电影质感"];
}

export function visualStyleDirection(style?: GenerationOptions["style"]) {
  const profile = visualStyleProfile(style);
  return [
    `Selected visual style: ${profile.label}.`,
    `Art direction: ${profile.artDirection}.`,
    `Palette: ${profile.palette.join(", ")}.`,
    `Lighting: ${profile.lighting}.`,
    `Camera language: ${profile.cameraLanguage}.`,
    `Materials: ${profile.materials}.`,
    `Composition: ${profile.composition}.`,
    `Avoid: ${profile.avoid}.`
  ].join(" ");
}

const exactVisualStyleContracts: Record<string, string> = {
  chalkboard: "2D chalk drawing only: hand-drawn powdery chalk strokes on a dark green or charcoal board, imperfect diagrams and arrows, no photography, no 3D rendering, no glossy materials.",
  "simple-line": "2D minimal line illustration only: clean thin outlines, simplified human figures, generous white space and very limited flat accent colors, no photography, no 3D volume, no painterly shading.",
  collage: "2D paper collage only: visibly cut unprinted paper edges, layered solid-color paper and natural fiber textures, torn shapes and handcrafted depth. No newspapers, magazines, printed fragments, typography, headline-like shapes, letters, numbers, posters, photorealistic scenes, or smooth 3D objects.",
  "comic-book": "2D comic-book illustration only: bold ink contours, halftone texture, borderless cinematic composition, dramatic expressions and flat high-contrast color, no speech bubbles, sound-effect lettering, panel captions, photography or 3D render.",
  memphis: "2D contemporary business illustration only: friendly simplified people, crisp vector-like forms, soft flat colors and restrained geometric accents, no photography or 3D render.",
  isometric: "2D isometric illustration only: consistent 30-degree axonometric geometry, modular spaces and objects, clean flat shading, no perspective photography or cinematic lens effects.",
  "pixel-art": "STRICT 2D PIXEL ART ONLY: visibly square hard-edged pixels, deliberately low-resolution sprite design, limited indexed-color palette, pixel-stepped diagonals, retro game environments and purely pictorial iconography. No interface lettering or numbers. No voxels, no low-poly 3D, no smooth gradients, no photorealism, no cinematic lens blur, and no anti-aliased illustration.",
  "safety-poster": "2D safety-training illustration only: bold simplified figures, clear action silhouettes, high-contrast warning colors and instructional composition communicated entirely through images, with no poster headline, labels, symbols containing characters, photography or glossy 3D render.",
  "cinematic-realism": "Photorealistic live-action commercial frame: believable people and locations, natural materials, motivated cinematic lighting, real lens depth and documentary detail; no cartoon, vector art or game rendering.",
  "product-ui": "Polished product interface demonstration using only blank containers, icons, charts, color blocks, and unlabeled controls: credible screen layouts, clean device and UI surfaces, precise visual hierarchy and restrained dimensional highlights; absolutely no interface words, letters, numbers, logos, or pseudo-writing, and no unrelated cinematic environment or decorative abstract art."
};

export function exactVisualStyleDirection(input?: Pick<GenerationOptions, "visualStyleId" | "visualStyleLabel" | "visualStylePrompt">) {
  if (!input?.visualStyleId && !input?.visualStylePrompt) return "";
  const contract = input.visualStyleId ? exactVisualStyleContracts[input.visualStyleId] : undefined;
  return [
    `Locked rendering style: ${input.visualStyleLabel || input.visualStyleId || "custom"}.`,
    contract ?? input.visualStylePrompt,
    input.visualStylePrompt ? `User-selected style definition: ${input.visualStylePrompt}` : "",
    "Apply this exact rendering medium to every character, object, environment, light effect, and transition in every scene. Scene content may change, but the rendering medium must not drift or be substituted."
  ].filter(Boolean).join(" ");
}
