"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { prefetch } from "remotion";
import { AlertCircle, FileVideo2, Loader2, RefreshCcw } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { compositionRevision } from "@/lib/composition-revision";
import { productionDurationInFrames } from "@/lib/production-settings";
import { previewPreloadAssets } from "@/lib/preview-preload";
import { KnowVideoComposition } from "@/video/know-video-composition";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/video/config";

export const KnowVideoPlayer = forwardRef<PlayerRef, { project: Project; className?: string; uiLanguage?: "zh-CN" | "en" }>(function KnowVideoPlayer(
  { project, className, uiLanguage = "zh-CN" },
  ref
) {
  const text = (zh: string, en: string) => uiLanguage === "zh-CN" ? zh : en;
  const [retryKey, setRetryKey] = useState(0);
  const [useRenderedVideo, setUseRenderedVideo] = useState(false);
  const [renderedVideoFailed, setRenderedVideoFailed] = useState(false);
  const renderUrl = project.currentVersion.renderUrl;
  const previewRevision = compositionRevision(project.currentVersion);

  useEffect(() => {
    const handles = previewPreloadAssets(project).map((asset) => {
      const handle = prefetch(asset.url, {
        credentials: "same-origin",
        logLevel: "warn"
      });
      void handle.waitUntilDone().catch(() => undefined);
      return handle;
    });
    return () => handles.forEach((handle) => handle.free());
  }, [previewRevision, project]);

  useEffect(() => {
    setUseRenderedVideo(false);
    setRenderedVideoFailed(false);
    setRetryKey(0);
  }, [project.currentVersion.id, previewRevision]);

  if (useRenderedVideo && renderUrl) {
    return (
      <div className={`${className ?? ""} kv-player-shell`}>
        {renderedVideoFailed ? (
          <div className="kv-player-fallback" role="alert">
            <AlertCircle size={28} />
            <strong>{text("已导出成片暂时无法播放", "The exported video cannot be played right now")}</strong>
            <p>{text("可以重新载入动态预览，或稍后再次尝试播放成片。", "Reload the live preview or try the exported video again later.")}</p>
            <button onClick={() => {
              setRenderedVideoFailed(false);
              setUseRenderedVideo(false);
              setRetryKey((current) => current + 1);
            }} type="button">
              <RefreshCcw size={16} />
              {text("重新载入动态预览", "Reload live preview")}
            </button>
          </div>
        ) : (
          <video
            autoPlay
            className="kv-rendered-video"
            controls
            onError={() => setRenderedVideoFailed(true)}
            playsInline
            preload="auto"
            src={renderUrl}
          />
        )}
        <div className="kv-player-mode">
          <button onClick={() => setUseRenderedVideo(false)} type="button">
            {text("返回动态预览", "Back to live preview")}
          </button>
          <span>{text("已导出成片", "Exported video")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className ?? ""} kv-player-shell`}>
      <Player
        key={`${project.currentVersion.id}-${previewRevision}-${retryKey}`}
        ref={ref}
        component={KnowVideoComposition}
        inputProps={{ project }}
        durationInFrames={productionDurationInFrames(project.currentVersion, VIDEO_FPS)}
        compositionWidth={VIDEO_WIDTH}
        compositionHeight={VIDEO_HEIGHT}
        fps={VIDEO_FPS}
        controls
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        bufferStateDelayInMilliseconds={120}
        errorFallback={() => (
          <div className="kv-player-fallback" role="alert">
            <AlertCircle size={28} />
            <strong>{text("动态预览没有成功载入", "The live preview could not be loaded")}</strong>
            <p>{text("场景素材可能仍在传输，或当前浏览器暂时无法解码其中一个媒体文件。", "Scene assets may still be transferring, or the browser could not decode one of the media files.")}</p>
            <div>
              <button onClick={() => setRetryKey((current) => current + 1)} type="button">
                <RefreshCcw size={16} />
                {text("重新载入", "Reload")}
              </button>
              {renderUrl ? (
                <button className="secondary" onClick={() => setUseRenderedVideo(true)} type="button">
                  <FileVideo2 size={16} />
                  {text("播放已导出成片", "Play exported video")}
                </button>
              ) : null}
            </div>
          </div>
        )}
        renderLoading={() => (
          <div className="kv-player-loading" role="status">
            <Loader2 className="kv-spin" size={28} />
            <span>{text("正在载入场景画面和配音", "Loading scene visuals and narration")}</span>
          </div>
        )}
        showPosterWhenBuffering
        showPosterWhenBufferingAndPaused
        style={{ height: "100%", width: "100%" }}
      />
      {renderUrl ? (
        <div className="kv-player-mode">
          <span>{text("动态预览", "Live preview")}</span>
          <button onClick={() => setUseRenderedVideo(true)} type="button">
            {text("播放已导出成片", "Play exported video")}
          </button>
        </div>
      ) : null}
    </div>
  );
});
