import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { frameRect, type Size } from './camera/zoom';
import { useCameraZoom } from './camera/zoomStore';

interface StageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** True once the camera is live. */
  live: boolean;
  children: ReactNode;
}

const NO_SIZE: Size = { width: 0, height: 0 };

/**
 * The camera view: mirrored video, a mirrored overlay canvas on top of it, and
 * unmirrored HUD content above both. The video and the canvas share one frame,
 * placed by the camera zoom (see camera/zoom.ts) and always the camera's own
 * shape, so landmark coordinates line up with the picture at every zoom. What
 * the frame does not cover is the stage colour.
 */
export function Stage({ videoRef, canvasRef, live, children }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>(NO_SIZE);
  const [video, setVideo] = useState<Size>(NO_SIZE);
  const zoom = useCameraZoom();

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStage({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const update = () => {
      if (element.videoWidth <= 0 || element.videoHeight <= 0) return;
      setVideo((size) =>
        size.width === element.videoWidth && size.height === element.videoHeight
          ? size
          : { width: element.videoWidth, height: element.videoHeight },
      );
    };
    update();
    element.addEventListener('loadedmetadata', update);
    element.addEventListener('resize', update);
    return () => {
      element.removeEventListener('loadedmetadata', update);
      element.removeEventListener('resize', update);
    };
  }, [videoRef]);

  const frame = frameRect(stage, video, zoom);

  return (
    <div className="stage" ref={stageRef} data-live={live}>
      <div
        className="stage__frame"
        data-testid="camera-frame"
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      >
        <video ref={videoRef} className="stage__video" playsInline muted data-testid="camera" />
        <canvas ref={canvasRef} className="stage__canvas" />
      </div>
      <div className="stage__overlay">{children}</div>
    </div>
  );
}
