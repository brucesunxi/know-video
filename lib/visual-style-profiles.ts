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
