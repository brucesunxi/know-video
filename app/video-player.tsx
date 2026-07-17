"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { AlertCircle, FileVideo2, Loader2, RefreshCcw } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { productionDurationInFrames } from "@/lib/production-settings";
import { KnowVideoComposition } from "@/video/know-video-composition";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "@/video/config";

export const KnowVideoPlayer = forwardRef<PlayerRef, { project: Project; className?: string }>(function KnowVideoPlayer(
  { project, className },
  ref
) {
  const [retryKey, setRetryKey] = useState(0);
  const [useRenderedVideo, setUseRenderedVideo] = useState(false);
  const [renderedVideoFailed, setRenderedVideoFailed] = useState(false);
  const renderUrl = project.currentVersion.renderUrl;

  useEffect(() => {
    setUseRenderedVideo(false);
    setRenderedVideoFailed(false);
    setRetryKey(0);
  }, [project.currentVersion.id]);

  if (useRenderedVideo && renderUrl) {
    return (
      <div className={`${className ?? ""} kv-player-shell`}>
        {renderedVideoFailed ? (
          <div className="kv-player-fallback" role="alert">
            <AlertCircle size={28} />
            <strong>已导出成片暂时无法播放</strong>
            <p>可以重新载入动态预览，或稍后再次尝试播放成片。</p>
            <button onClick={() => {
              setRenderedVideoFailed(false);
              setUseRenderedVideo(false);
              setRetryKey((current) => current + 1);
            }} type="button">
              <RefreshCcw size={16} />
              重新载入动态预览
            </button>
          </div>
        ) : (
          <video
            autoPlay
            className="kv-rendered-video"
            controls
            onError={() => setRenderedVideoFailed(true)}
            playsInline
            src={renderUrl}
          />
        )}
        <div className="kv-player-mode">
          <button onClick={() => setUseRenderedVideo(false)} type="button">
            返回动态预览
          </button>
          <span>已导出成片</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className ?? ""} kv-player-shell`}>
      <Player
        key={`${project.currentVersion.id}-${retryKey}`}
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
        bufferStateDelayInMilliseconds={250}
        errorFallback={() => (
          <div className="kv-player-fallback" role="alert">
            <AlertCircle size={28} />
            <strong>动态预览没有成功载入</strong>
            <p>场景素材可能仍在传输，或当前浏览器暂时无法解码其中一个媒体文件。</p>
            <div>
              <button onClick={() => setRetryKey((current) => current + 1)} type="button">
                <RefreshCcw size={16} />
                重新载入
              </button>
              {renderUrl ? (
                <button className="secondary" onClick={() => setUseRenderedVideo(true)} type="button">
                  <FileVideo2 size={16} />
                  播放已导出成片
                </button>
              ) : null}
            </div>
          </div>
        )}
        renderLoading={() => (
          <div className="kv-player-loading" role="status">
            <Loader2 className="kv-spin" size={28} />
            <span>正在载入场景画面和配音</span>
          </div>
        )}
        showPosterWhenBuffering
        showPosterWhenBufferingAndPaused
        style={{ height: "100%", width: "100%" }}
      />
      {renderUrl ? (
        <div className="kv-player-mode">
          <span>动态预览</span>
          <button onClick={() => setUseRenderedVideo(true)} type="button">
            播放已导出成片
          </button>
        </div>
      ) : null}
    </div>
  );
});
