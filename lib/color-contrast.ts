type Rgb = { red: number; green: number; blue: number };

function parseHexColor(value: string): Rgb | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16) / 255,
    green: Number.parseInt(match[1].slice(2, 4), 16) / 255,
    blue: Number.parseInt(match[1].slice(4, 6), 16) / 255
  };
}

function relativeLuminance(rgb: Rgb) {
  const linear = [rgb.red, rgb.green, rgb.blue].map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function saturation(rgb: Rgb) {
  const maximum = Math.max(rgb.red, rgb.green, rgb.blue);
  const minimum = Math.min(rgb.red, rgb.green, rgb.blue);
  if (maximum === minimum) return 0;
  const lightness = (maximum + minimum) / 2;
  return (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));
}

export function sceneAccentColor(palette: string[]) {
  const candidates = palette.flatMap((color) => {
    const rgb = parseHexColor(color);
    if (!rgb) return [];
    const luminance = relativeLuminance(rgb);
    if (luminance < 0.18) return [];
    const score = saturation(rgb) * 0.72
      + Math.min(luminance, 0.78) * 0.38
      - (luminance > 0.92 ? 0.18 : 0);
    return [{ color, score }];
  });
  return candidates.sort((left, right) => right.score - left.score)[0]?.color ?? "#22c7b8";
}

export function readableTextColor(background: string) {
  const rgb = parseHexColor(background);
  if (!rgb) return "#06111f";
  const backgroundLuminance = relativeLuminance(rgb);
  const darkLuminance = relativeLuminance({ red: 6 / 255, green: 17 / 255, blue: 31 / 255 });
  const lightLuminance = 1;
  const darkContrast = (backgroundLuminance + 0.05) / (darkLuminance + 0.05);
  const lightContrast = (lightLuminance + 0.05) / (backgroundLuminance + 0.05);
  return darkContrast >= lightContrast ? "#06111f" : "#ffffff";
}
