type Zone = "weight" | "waist" | "hips" | "chest";

/**
 * Stylized female silhouette (front view) with a highlighted measurement zone.
 * The active band pulses in gold/coral so the client sees exactly where to put the tape.
 */
export function BodyDiagram({ zone }: { zone: Zone }) {
  const active = {
    chest: zone === "chest",
    waist: zone === "waist",
    hips: zone === "hips",
    weight: zone === "weight",
  };

  const bandCls = (on: boolean) =>
    on
      ? "stroke-[url(#bandGrad)] opacity-100"
      : "stroke-warm-gray/25 opacity-60";

  const labelCls = (on: boolean) =>
    on ? "fill-gold" : "fill-warm-gray/50";

  return (
    <div className="relative mx-auto w-full max-w-[180px]">
      <svg
        viewBox="0 0 180 300"
        className="h-auto w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.15 78)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="oklch(0.68 0.21 25)" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.68 0.21 25)" />
            <stop offset="100%" stopColor="oklch(0.82 0.16 78)" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Full-body glow when weighing */}
        {active.weight && (
          <ellipse
            cx="90"
            cy="160"
            rx="60"
            ry="130"
            fill="url(#bodyGrad)"
            opacity="0.6"
          />
        )}

        {/* Silhouette — front-facing female figure */}
        <g
          stroke="oklch(0.78 0.15 78 / 0.55)"
          strokeWidth="1.5"
          fill="oklch(0.22 0.02 60 / 0.65)"
        >
          {/* head */}
          <ellipse cx="90" cy="34" rx="16" ry="19" />
          {/* neck */}
          <path d="M83 51 Q90 58 97 51 L98 62 Q90 66 82 62 Z" />
          {/* torso: shoulders → chest → waist → hips */}
          <path
            d="
              M62 68
              Q90 60 118 68
              L124 92
              Q120 108 116 118
              Q112 132 108 148
              L112 168
              Q118 188 122 208
              Q118 220 110 224
              L104 224
              Q98 220 96 210
              L96 190
              L84 190
              L84 210
              Q82 220 76 224
              L70 224
              Q62 220 58 208
              Q62 188 68 168
              L72 148
              Q68 132 64 118
              Q60 108 56 92 Z
            "
          />
          {/* arms */}
          <path d="M60 74 Q46 100 44 140 Q46 168 52 190 Q56 194 60 190 Q58 168 60 140 Q64 108 68 82 Z" />
          <path d="M120 74 Q134 100 136 140 Q134 168 128 190 Q124 194 120 190 Q122 168 120 140 Q116 108 112 82 Z" />
          {/* legs */}
          <path d="M78 224 Q76 250 74 280 Q78 288 86 288 Q90 260 90 232 Z" />
          <path d="M102 224 Q104 250 106 280 Q102 288 94 288 Q90 260 90 232 Z" />
        </g>

        {/* Chest band */}
        <line
          x1="52"
          y1="92"
          x2="128"
          y2="92"
          strokeWidth={active.chest ? 4 : 2}
          strokeLinecap="round"
          className={bandCls(active.chest)}
          filter={active.chest ? "url(#glow)" : undefined}
        />
        {active.chest && (
          <ellipse cx="90" cy="92" rx="42" ry="10" fill="url(#bandGrad)" opacity="0.15" />
        )}

        {/* Waist band */}
        <line
          x1="60"
          y1="148"
          x2="120"
          y2="148"
          strokeWidth={active.waist ? 4 : 2}
          strokeLinecap="round"
          className={bandCls(active.waist)}
          filter={active.waist ? "url(#glow)" : undefined}
        />
        {active.waist && (
          <ellipse cx="90" cy="148" rx="34" ry="9" fill="url(#bandGrad)" opacity="0.18" />
        )}

        {/* Hips band */}
        <line
          x1="54"
          y1="200"
          x2="126"
          y2="200"
          strokeWidth={active.hips ? 4 : 2}
          strokeLinecap="round"
          className={bandCls(active.hips)}
          filter={active.hips ? "url(#glow)" : undefined}
        />
        {active.hips && (
          <ellipse cx="90" cy="200" rx="40" ry="10" fill="url(#bandGrad)" opacity="0.18" />
        )}

        {/* Labels + arrows on the right side */}
        <g className="font-display" style={{ fontSize: 9, letterSpacing: 1 }}>
          {/* Chest */}
          <line x1="132" y1="92" x2="146" y2="92" stroke="currentColor" className={active.chest ? "text-gold" : "text-warm-gray/40"} strokeWidth="1" />
          <text x="148" y="95" className={labelCls(active.chest)}>ГРУДЬ</text>

          {/* Waist */}
          <line x1="122" y1="148" x2="146" y2="148" stroke="currentColor" className={active.waist ? "text-gold" : "text-warm-gray/40"} strokeWidth="1" />
          <text x="148" y="151" className={labelCls(active.waist)}>ТАЛИЯ</text>

          {/* Hips */}
          <line x1="130" y1="200" x2="146" y2="200" stroke="currentColor" className={active.hips ? "text-gold" : "text-warm-gray/40"} strokeWidth="1" />
          <text x="148" y="203" className={labelCls(active.hips)}>БЁДРА</text>
        </g>

        {/* Weight scale badge */}
        {active.weight && (
          <g>
            <rect x="60" y="292" width="60" height="6" rx="3" fill="url(#bandGrad)" />
            <text x="90" y="288" textAnchor="middle" className="fill-gold" style={{ fontSize: 9, letterSpacing: 1 }}>
              ВЕСЫ
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
