import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeAfterSliderProps {
  before: string;
  after: string;
  beforeAlt?: string;
  afterAlt?: string;
}

export function BeforeAfterSlider({
  before,
  after,
  beforeAlt = "До",
  afterAlt = "После",
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  const update = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, x)));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      update(clientX);
    };
    const onUp = () => (dragging.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [update]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-[4/5] w-full max-w-full touch-pan-y select-none overflow-hidden rounded-3xl border border-gold/20 bg-surface"
      onMouseDown={(e) => {
        dragging.current = true;
        update(e.clientX);
      }}
      onTouchStart={(e) => {
        dragging.current = true;
        update(e.touches[0].clientX);
      }}
    >
      <img
        src={after}
        alt={afterAlt}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
      <div
        className="absolute inset-0 h-full overflow-hidden"
        style={{ width: `${pos}%` }}
      >
        <img
          src={before}
          alt={beforeAlt}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ width: `${100 / (pos / 100)}%`, maxWidth: "none" }}
          loading="lazy"
        />
      </div>

      {/* Labels */}
      <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-background/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-ivory backdrop-blur">
        До
      </div>
      <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-gold px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-background">
        После
      </div>

      {/* Divider + handle */}
      <div
        className="absolute inset-y-0 w-px bg-gold"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gold bg-background/80 backdrop-blur sm:h-12 sm:w-12">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold">
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
