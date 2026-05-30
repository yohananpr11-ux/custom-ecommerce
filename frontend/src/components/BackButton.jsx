import { useNavigate } from 'react-router-dom';

/**
 * Reusable Back button. Goes back in history if there is one, else falls back to home.
 * Designed to read as "← BACK" with the same minimalist streetwear feel as the rest of the site.
 */
export default function BackButton({ label = 'Back', fallback = '/', style = {} }) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 14px',
        marginBottom: '20px',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '999px',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '14px', lineHeight: 1 }}>←</span>
      <span>{label}</span>
    </button>
  );
}
