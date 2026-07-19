import type { ProductionSettings } from "@/lib/types";

const playbackRates = [0.75, 1, 1.25, 1.5] as const;

function nearestPlaybackRate(value: number): ProductionSettings["playbackRate"] {
  return playbackRates.reduce((best, rate) => (
    Math.abs(rate - value) < Math.abs(best - value) ? rate : best
  ));
}

export function productionSettingsFromRequest(request: string): Partial<ProductionSettings> {
  const settings: Partial<ProductionSettings> = {};
  const normalized = request.toLowerCase();

  if (/(?:关闭|关掉|不要|隐藏|移除|删除|去掉|取消).{0,8}(?:字幕|caption|subtitle)|(?:字幕|caption|subtitle).{0,8}(?:关闭|关掉|不要|隐藏|移除|删除|去掉|取消)/iu.test(normalized)) {
    settings.captionsEnabled = false;
  } else if (/(?:开启|打开|显示|加上|添加|恢复).{0,8}(?:字幕|caption|subtitle)|(?:字幕|caption|subtitle).{0,8}(?:开启|打开|显示|加上|添加|恢复)/iu.test(normalized)) {
    settings.captionsEnabled = true;
  }

  if (/(?:字幕|caption|subtitle).{0,10}(?:简洁|极简|无底|透明|minimal)/iu.test(normalized)) {
    settings.captionStyle = "minimal";
  } else if (/(?:字幕|caption|subtitle).{0,10}(?:强调|高亮|亮色|highlight)/iu.test(normalized)) {
    settings.captionStyle = "highlight";
  } else if (/(?:字幕|caption|subtitle).{0,10}(?:深色底|黑底|底框|boxed)/iu.test(normalized)) {
    settings.captionStyle = "boxed";
  }

  const explicitRate = normalized.match(/(?:速度|速率|播放|全片|视频)?\s*(0\.75|1(?:\.0)?|1\.25|1\.5)\s*(?:倍|x)/iu);
  if (explicitRate) {
    settings.playbackRate = nearestPlaybackRate(Number(explicitRate[1]));
  } else if (/(?:恢复|改回|调整为).{0,6}(?:正常|原速|标准速度)|(?:正常|原速|标准速度).{0,6}(?:播放|速度)/iu.test(normalized)) {
    settings.playbackRate = 1;
  } else if (/(?:节奏|速度|播放|语速|旁白速度|配音速度).{0,8}(?:更快|加快|快一点|提速)|(?:加快|提速).{0,8}(?:节奏|速度|播放|语速|旁白速度|配音速度|全片|视频)/iu.test(normalized)) {
    settings.playbackRate = /(?:很快|明显加快|大幅提速)/u.test(normalized) ? 1.5 : 1.25;
  } else if (/(?:节奏|速度|播放|语速|旁白速度|配音速度).{0,8}(?:更慢|放慢|慢一点|降速)|(?:放慢|降速).{0,8}(?:节奏|速度|播放|语速|旁白速度|配音速度|全片|视频)/iu.test(normalized)) {
    settings.playbackRate = 0.75;
  }

  const musicPercent = normalized.match(/(?:背景音乐|音乐|bgm).{0,12}?(\d{1,2})\s*%/iu);
  if (musicPercent) {
    settings.musicVolume = Math.min(0.5, Math.max(0, Number(musicPercent[1]) / 100));
  } else if (/(?:背景音乐|音乐|bgm).{0,8}(?:静音|关闭|关掉|不要声音)/iu.test(normalized)) {
    settings.musicVolume = 0;
  } else if (/(?:背景音乐|音乐|bgm).{0,8}(?:小一点|降低|调低|轻一点)/iu.test(normalized)) {
    settings.musicVolume = 0.08;
  } else if (/(?:背景音乐|音乐|bgm).{0,8}(?:大一点|提高|调高|响一点)/iu.test(normalized)) {
    settings.musicVolume = 0.2;
  }

  if (/(?:关闭|取消|不要|禁用).{0,8}(?:音乐避让|自动压低|旁白避让)|(?:音乐避让|自动压低|旁白避让).{0,8}(?:关闭|取消|不要|禁用)/iu.test(normalized)) {
    settings.musicDucking = "off";
  } else if (/(?:音乐避让|自动压低|旁白避让|旁白时压低音乐).{0,10}(?:明显|强|强力|更多|大幅)|(?:明显|强|强力|更多|大幅).{0,10}(?:音乐避让|自动压低|旁白避让)|(?:旁白|配音).{0,8}(?:明显|强|强力|更多|大幅).{0,6}(?:压低|降低).{0,4}(?:背景音乐|音乐)/iu.test(normalized)) {
    settings.musicDucking = "strong";
  } else if (/(?:开启|打开|启用|使用).{0,8}(?:音乐避让|自动压低|旁白避让)|(?:音乐避让|自动压低|旁白避让|旁白时压低音乐)/iu.test(normalized)) {
    settings.musicDucking = "balanced";
  }

  if (/(?:logo|标志|品牌标识).{0,12}(?:左上|左上角)/iu.test(normalized)) settings.logoPosition = "top-left";
  if (/(?:logo|标志|品牌标识).{0,12}(?:右上|右上角)/iu.test(normalized)) settings.logoPosition = "top-right";
  if (/(?:logo|标志|品牌标识).{0,12}(?:左下|左下角)/iu.test(normalized)) settings.logoPosition = "bottom-left";
  if (/(?:logo|标志|品牌标识).{0,12}(?:右下|右下角)/iu.test(normalized)) settings.logoPosition = "bottom-right";
  const logoPercent = normalized.match(/(?:logo|标志|品牌标识).{0,12}?(\d{1,2})\s*%/iu);
  if (logoPercent) {
    settings.logoSize = Math.min(24, Math.max(6, Number(logoPercent[1])));
  } else if (/(?:logo|标志|品牌标识).{0,8}(?:调大|放大|大一点)/iu.test(normalized)) {
    settings.logoSize = 16;
  } else if (/(?:logo|标志|品牌标识).{0,8}(?:调小|缩小|小一点)/iu.test(normalized)) {
    settings.logoSize = 9;
  }

  return settings;
}

export function isProductionOnlyRequest(request: string) {
  const settings = productionSettingsFromRequest(request);
  if (Object.keys(settings).length === 0) return false;
  if (
    settings.playbackRate
    && /(?:语速|旁白速度|配音速度|播放速度|速度|节奏).{0,8}(?:更快|加快|快一点|提速|更慢|放慢|慢一点|降速)|(?:加快|提速|放慢|降速).{0,8}(?:语速|旁白速度|配音速度|播放速度|速度|节奏|全片|视频)/iu.test(request)
    && !/(?:第\s*[0-9一二三四五六七八九十]+|场景|镜头|章节|画面|视觉|标题|文案|语言|中文|英文|人物|角色|背景|构图|风格|画风|色调|配色|主题)/iu.test(request)
  ) {
    return true;
  }
  if (settings.musicDucking && !/(?:第\s*[0-9一二三四五六七八九十]+|场景|镜头|章节|画面|视觉|标题|文案|语言|中文|英文|人物|角色|背景|构图|风格|画风|色调|配色|主题)/iu.test(request)) {
    return true;
  }
  return !/(?:第\s*[0-9一二三四五六七八九十]+|场景|镜头|章节|画面|视觉|旁白|配音音色|标题|文案|语言|中文|英文|人物|角色|背景|构图|风格|画风|色调|配色|主题)/iu.test(request);
}
