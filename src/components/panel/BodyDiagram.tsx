import womanImg from "@/assets/body-diagram-woman.png";

type Zone = "weight" | "waist" | "hips" | "chest";

/**
 * Realistic female figure with a highlighted measurement zone.
 * The active band pulses in gold/coral so the client sees exactly where to place the tape.
 */
export function BodyDiagram({ zone }: { zone: Zone }) {
  const active = {
    chest: zone === "chest",
    waist: zone === "waist",
    hips: zone === "hips",
    weight: zone === "weight",
  };

  // y-positions tuned to the illustration (viewBox 512x896)
  const Y = { chest: 235, waist: 330, hips: 430 };

  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg
        viewBox="0 0 512 896"
        className="h-auto w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.68 0.21 25)" />
            <stop offset="100%" stopColor="oklch(0.82 0.16 78)" />
          </linearGradient>
          <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.82 0.16 78)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="oklch(0.82 0.16 78)" stopOpacity="0" />
          </radialGradient>
          <filter id="soften" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient glow when weighing */}
        {active.weight && (
          <ellipse cx="256" cy="500" rx="220" ry="380" fill="url(#glowGrad)" />
        )}

        {/* Realistic figure */}
        <image
          href={womanImg}
          x="0"
          y="0"
          width="512"
          height="896"
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Band + label helper positions */}
        {/* Chest */}
        <BandRow
          y={Y.chest}
          x1={168}
          x2={344}
          labelX={370}
          label="ГРУДЬ"
          active={active.chest}
        />

        {/* Waist */}
        <BandRow
          y={Y.waist}
          x1={178}
          x2={334}
          labelX={370}
          label="ТАЛИЯ"
          active={active.waist}
        />

        {/* Hips */}
        <BandRow
          y={Y.hips}
          x1={168}
          x2={344}
          labelX={370}
          label="БЁДРА"
          active={active.hips}
        />

        {/* Weight scale */}
        {active.weight && (
          <g>
            <rect
              x="176"
              y="866"
              width="160"
              height="14"
              rx="7"
              fill="url(#bandGrad)"
              filter="url(#soften)"
            />
            <text
              x="256"
              y="855"
              textAnchor="middle"
              className="fill-gold"
              style={{ fontSize: 22, letterSpacing: 3 }}
            >
              ВЕСЫ
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function BandRow({
  y,
  x1,
  x2,
  labelX,
  label,
  active,
}: {
  y: number;
  x1: number;
  x2: number;
  labelX: number;
  label: string;
  active: boolean;
}) {
  return (
    <g>
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={active ? "url(#bandGrad)" : "oklch(0.78 0.05 60 / 0.35)"}
        strokeWidth={active ? 6 : 2}
        strokeLinecap="round"
        strokeDasharray={active ? undefined : "4 6"}
        filter={active ? "url(#soften)" : undefined}
      />
      {active && (
        <ellipse
          cx={(x1 + x2) / 2}
          cy={y}
          rx={(x2 - x1) / 2 + 6}
          ry={14}
          fill="url(#bandGrad)"
          opacity="0.18"
        />
      )}
      <line
        x1={x2 + 4}
        y1={y}
        x2={labelX - 6}
        y2={y}
        stroke={active ? "oklch(0.82 0.16 78)" : "oklch(0.78 0.05 60 / 0.35)"}
        strokeWidth="1.5"
      />
      <text
        x={labelX}
        y={y + 7}
        className={active ? "fill-gold" : "fill-warm-gray/50"}
        style={{ fontSize: 20, letterSpacing: 3 }}
      >
        {label}
      </text>
    </g>
  );
}
