/**
 * JonoLogo — cursive signature wordmark + bird mark, adapted from the
 * approved JOAKIM brand assets (integration/joakim-phase-1) with the
 * name changed to Jono. No image file dependency; renders consistently
 * in all environments.
 */
const SIZES = {
  large:     { fontSize: '52px', gap: '10px', birdSize: 18 },
  medium:    { fontSize: '38px', gap: '8px', birdSize: 14 },
  small:     { fontSize: '28px', gap: '6px', birdSize: 11 },
  watermark: { fontSize: '20px', gap: '5px', birdSize: 9, opacity: 0.08 },
};

export function BirdMark({ size, color }) {
  // viewBox is ~1.6:1 (wide, flat wingspan) — keep that ratio so the
  // shape doesn't squash into an illegible squiggle at small sizes.
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 64 40" fill="none" aria-hidden="true">
      <path
        d="M2 16C12 6 20 6 26 15C32 6 40 6 50 16C41 13 34 14 27 22C20 14 13 13 2 16Z"
        fill={color}
      />
    </svg>
  );
}

export default function JonoLogo({ size = 'large', style = {}, className = '' }) {
  const base = SIZES[size] || SIZES.large;
  const color = style.color || '#f5f0e8';
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: base.gap,
        userSelect: 'none',
        lineHeight: '1',
        opacity: base.opacity,
        ...style,
      }}
      aria-label="Jono"
    >
      <BirdMark size={base.birdSize} color={color} />
      <span
        style={{
          fontFamily: '"Pinyon Script", cursive',
          fontWeight: 400,
          fontSize: base.fontSize,
          color,
        }}
      >
        Jono
      </span>
    </span>
  );
}
