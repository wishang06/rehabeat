import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { stageLayout } from './camera/rails';
import { DEFAULT_ZOOM, frameRect, type Size } from './camera/zoom';

interface StageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** True once the camera is live. */
  live: boolean;
  /** Keep a rail each side of the picture for the HUD panels (Play and Calibrate on a wide window). */
  rails?: boolean;
  children: ReactNode;
}

const NO_SIZE: Size = { width: 0, height: 0 };

/**
 * The camera view: mirrored video, a mirrored overlay canvas on top of it, and
 * unmirrored HUD content above both. The video and the canvas share one frame,
 * placed by the camera zoom (see camera/zoom.ts) and always the camera's own
 * shape, so landmark coordinates line up with the picture at every zoom. What
 * the frame does not cover is the stage colour. With `rails`, the picture
 * keeps to the middle of the stage and the HUD panels get the sides
 * (--rail, see camera/rails.ts).
 */
export function Stage({ videoRef, canvasRef, live, rails = false, children }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>(NO_SIZE);
  const [video, setVideo] = useState<Size>(NO_SIZE);

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

  const layout = stageLayout(stage, video, rails);
  const frame = frameRect(layout.picture, video, DEFAULT_ZOOM);

  return (
    <div
      className="stage"
      ref={stageRef}
      data-live={live}
      data-rails={layout.rail > 0}
      style={{ '--rail': `${layout.rail}px` } as CSSProperties}
    >
      <div className="stage__picture" style={{ left: layout.picture.x, width: layout.picture.width }}>
        <div
          className="stage__frame"
          data-testid="camera-frame"
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        >
          <video ref={videoRef} className="stage__video" playsInline muted data-testid="camera" />
          <canvas ref={canvasRef} className="stage__canvas" />
        </div>
      </div>
      <div className="stage__overlay">{children}</div>
    </div>
  );
}
