/**
 * JonoLogo — text-based JONO brand mark using Bebas Neue (loaded in index.html).
 * No image file dependency; renders consistently in all environments.
 */
const SIZES = {
  large:   { fontSize: '32px', letterSpacing: '0.12em' },
  medium:  { fontSize: '24px', letterSpacing: '0.12em' },
  small:   { fontSize: '18px', letterSpacing: '0.10em' },
  watermark: { fontSize: '13px', letterSpacing: '0.10em', opacity: 0.08 },
};

export default function JonoLogo({ size = 'large', style = {}, className = '' }) {
  const base = SIZES[size] || SIZES.large;
  return (
    <span
      className={className}
      style={{
        fontFamily: '"Bebas Neue", sans-serif',
        fontWeight: '400',
        color: '#f3f4f6',
        lineHeight: '1',
        userSelect: 'none',
        display: 'inline-block',
        ...base,
        ...style,
      }}
      aria-label="JONO"
    >
      JONO
    </span>
  );
}
