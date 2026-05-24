import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

export default function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookieConsent');
    if (!consent) {
      // Delay slightly for better UX
      const timer = setTimeout(() => {
        setShowBanner(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('cookieConsent', 'accepted');
    setShowBanner(false);
  };

  const handleDecline = () => {
    localStorage.setItem('cookieConsent', 'declined');
    setShowBanner(false);
  };

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          className="cookie-consent-banner"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '24px',
            right: '24px',
            maxWidth: '480px',
            backgroundColor: 'rgba(18, 18, 18, 0.95)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(12px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div className="cookie-consent-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--color-white)', textTransform: 'uppercase' }}>
              🍪 Cookie Settings
            </h4>
            <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: 'var(--color-text-tertiary-gray)' }}>
              We use cookies to improve your shopping experience, analyze site usage, and personalize content. Feel free to manage your choice.
            </p>
            <Link 
              to="/privacy" 
              onClick={() => setShowBanner(false)}
              style={{ fontSize: '12px', color: 'var(--color-white)', textDecoration: 'underline', width: 'fit-content' }}
            >
              Read our full Privacy Policy
            </Link>
          </div>
          
          <div className="cookie-consent-actions" style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={handleDecline} 
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--color-white)',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background 0.2s',
                minHeight: '44px' // mobile touch target size
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Decline
            </button>
            <button 
              onClick={handleAccept} 
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--color-white)',
                color: 'var(--color-black-500)',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'opacity 0.2s',
                minHeight: '44px' // mobile touch target size
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              Accept All
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
