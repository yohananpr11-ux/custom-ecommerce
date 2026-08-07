/**
 * JonoLogo — JONO brand mark.
 * Uses the real JONO logo image (/jono-logo-transparent.png, extracted from JOAKIM branch).
 * Falls back to Bebas Neue text if image fails to load.
 */
const SIZE_MAP = {
  large:     { height: '52px' },
  medium:    { height: '36px' },
  small:     { height: '24px' },
  watermark: { height: '18px', opacity: 0.08 },
};

export default function JonoLogo({ size = 'large', style = {}, className = '' }) {
  const dims = SIZE_MAP[size] || SIZE_MAP.large;
  return (
    <img
      src="/jono-logo-transparent.png"
      alt="JONO"
      className={className}
      draggable="false"
      style={{
        height: dims.height,
        width: 'auto',
        objectFit: 'contain',
        display: 'inline-block',
        opacity: dims.opacity ?? 1,
        ...style,
      }}
      onError={(e) => {
        // Fallback: replace broken image with text logo
        const span = document.createElement('span');
        span.style.cssText = `font-family:"Bebas Neue",sans-serif;font-size:32px;letter-spacing:0.12em;color:#f3f4f6;line-height:1;display:inline-block`;
        span.textContent = 'JONO';
        e.target.replaceWith(span);
      }}
    />
  );
}
