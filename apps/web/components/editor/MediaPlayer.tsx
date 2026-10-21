"use client";

import { api } from "@/lib/api";
import type { MediaFile } from "@/lib/types";

interface MediaPlayerProps {
  media: MediaFile;
  onElementReady: (el: HTMLMediaElement | null) => void;
}

export function MediaPlayer({ media, onElementReady }: MediaPlayerProps) {
  const src = api.mediaFileUrl(media.id);

  if (media.media_type === "video") {
    return (
      <video
        ref={onElementReady}
        src={src}
        controls={false}
        className="aspect-video w-full rounded-lg bg-black"
      />
    );
  }

  return <audio ref={onElementReady} src={src} controls={false} className="hidden" />;
}
