import { Link } from 'react-router-dom';

export default function Footer() {
  const handleNewsletterSubmit = (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input')?.value;
    if (email) {
      alert(`Thank you for subscribing, ${email}! Welcome to the club.`);
      e.target.reset();
    }
  };

  return (
    <footer className="site-footer" style={{ borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--color-black-500)', color: 'var(--color-white)', padding: '60px 20px 40px 20px', marginTop: 'auto' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '40px', marginBottom: '40px' }}>
        
        {/* Brand Column */}
        <div className="footer-brand-col" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <img src="/logo-horizontal.svg" alt="Drip Street Logo" style={{ height: '24px', alignSelf: 'flex-start', filter: 'invert(1)' }} />
          <p style={{ fontSize: '14px', lineHeight: '1.6', opacity: 0.6, margin: 0 }}>
            Minimalist streetwear designed for ultimate confidence, superior fit, and premium everyday aesthetics. Built with high-grade materials.
          </p>
          <div className="payment-icons" style={{ display: 'flex', gap: '8px', opacity: 0.7, marginTop: '8px' }}>
            <span style={{ fontSize: '12px', border: '1px solid #444', padding: '4px 8px', borderRadius: '4px', background: '#222' }}>VISA</span>
            <span style={{ fontSize: '12px', border: '1px solid #444', padding: '4px 8px', borderRadius: '4px', background: '#222' }}>MC</span>
            <span style={{ fontSize: '12px', border: '1px solid #444', padding: '4px 8px', borderRadius: '4px', background: '#222' }}>PAYPAL</span>
            <span style={{ fontSize: '12px', border: '1px solid #444', padding: '4px 8px', borderRadius: '4px', background: '#222' }}>APPLE PAY</span>
          </div>
        </div>

        {/* Column 1: Shop */}
        <div className="footer-links-col">
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px' }}>Shop</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li><Link to="/" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px', transition: 'color 0.2s' }}>All Products</Link></li>
            <li><Link to="/" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Hoodies</Link></li>
            <li><Link to="/" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>T-Shirts</Link></li>
            <li><Link to="/" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Accessories</Link></li>
          </ul>
        </div>

        {/* Column 2: Customer Service */}
        <div className="footer-links-col">
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px' }}>Support</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li><Link to="/contact" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Contact Us</Link></li>
            <li><Link to="/shipping" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Shipping Policy</Link></li>
            <li><Link to="/refund" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Returns & Refunds</Link></li>
            <li><Link to="/about" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Our Story</Link></li>
          </ul>
        </div>

        {/* Column 3: Legal */}
        <div className="footer-links-col">
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px' }}>Legal</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li><Link to="/privacy" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Privacy Policy</Link></li>
            <li><Link to="/terms" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Terms of Service</Link></li>
            <li><Link to="/refund" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Refund Policy</Link></li>
            <li><Link to="/shipping" style={{ color: 'var(--color-text-tertiary-gray)', textDecoration: 'none', fontSize: '14px' }}>Shipping Policy</Link></li>
          </ul>
        </div>

        {/* Column 4: Newsletter */}
        <div className="footer-newsletter-col" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Join the Club</h3>
          <p style={{ fontSize: '13px', opacity: 0.6, margin: 0 }}>Subscribe for exclusive releases, early access, and 10% off your first order.</p>
          <form onSubmit={handleNewsletterSubmit} style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="email" 
              placeholder="Your email address" 
              required 
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--color-black-300)',
                color: 'var(--color-white)',
                fontSize: '13px',
                outline: 'none'
              }} 
            />
            <button 
              type="submit" 
              style={{
                padding: '10px 24px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--color-white)',
                color: 'var(--color-black-500)',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap'
              }}
            >
              Join
            </button>
          </form>
        </div>

      </div>

      <div className="container" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
        <p style={{ fontSize: '13px', opacity: 0.5, margin: 0 }}>
          &copy; 2026 Drip Street. All rights reserved.
        </p>
        <div className="footer-socials" style={{ display: 'flex', gap: '16px' }}>
          <a href="https://instagram.com/dripstreet" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>Instagram</a>
          <a href="https://tiktok.com/@dripstreet" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>TikTok</a>
          <a href="https://twitter.com/dripstreet" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>Twitter</a>
        </div>
      </div>
    </footer>
  );
}
