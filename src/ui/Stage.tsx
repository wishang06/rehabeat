import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

interface StageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** True once the camera is live. */
  live: boolean;
  children: ReactNode;
}

/**
 * The camera view: mirrored video, a mirrored overlay canvas on top of it, and
 * unmirrored HUD content above both. The box takes the camera's own aspect
 * ratio so landmark coordinates line up with the picture.
 */
export function Stage({ videoRef, canvasRef, live, children }: StageProps) {
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setAspect(video.videoWidth / video.videoHeight);
      }
    };
    update();
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
    };
  }, [videoRef]);

  return (
    <div className="stage" data-live={live} style={{ '--aspect': aspect } as CSSProperties}>
      <video ref={videoRef} className="stage__video" playsInline muted data-testid="camera" />
      <canvas ref={canvasRef} className="stage__canvas" />
      <div className="stage__overlay">{children}</div>
    </div>
  );
}
