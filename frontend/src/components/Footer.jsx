import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import POLICIES from '../config/supplierPolicies.js';

const POLICY_CONTENT = {
  shipping: {
    en: {
      title: 'Shipping Policy',
      blocks: [
        {
          heading: 'Clothing — Production & Dispatch',
          copy: `${POLICIES.printify.en.cartDelivery}. Orders are prepared and quality-checked before dispatch.`,
        },
        {
          heading: 'Jewelry — Dispatch & Delivery',
          copy: `${POLICIES.dropship.en.cartDelivery}. Jewelry ships internationally from our fulfillment partner.`,
        },
        {
          heading: 'Tracking & Support',
          copy: 'A tracking link is sent once the carrier scans your parcel. If tracking stalls for more than 72 hours, contact support for a fast follow-up.',
        },
      ],
    },
    he: {
      title: 'מדיניות משלוחים',
      blocks: [
        {
          heading: 'ביגוד — ייצור ומשלוח',
          copy: `${POLICIES.printify.he.cartDelivery}. כל הזמנה עוברת הכנה ובקרת איכות לפני יציאה.`,
        },
        {
          heading: 'תכשיטים — שליחה והגעה',
          copy: `${POLICIES.dropship.he.cartDelivery}. תכשיטים נשלחים בינלאומי משותף הלוגיסטיקה שלנו.`,
        },
        {
          heading: 'מעקב ותמיכה',
          copy: 'לינק מעקב נשלח מיד לאחר סריקה של חברת השילוח. אם אין התקדמות יותר מ-72 שעות, שירות הלקוחות מטפל מיידית.',
        },
      ],
    },
  },
  refund: {
    en: {
      title: 'Quality Guarantee',
      blocks: [
        {
          heading: 'Clothing — 30-Day Guarantee',
          copy: POLICIES.printify.en.returnIntro,
        },
        {
          heading: 'Jewelry — 14-Day Guarantee',
          copy: POLICIES.dropship.en.returnIntro,
        },
        {
          heading: 'How to Submit a Claim',
          copy: 'Contact us at support with your order number, a description of the issue, and clear photos. We review all claims within 1–2 business days.',
        },
      ],
    },
    he: {
      title: 'אחריות איכות',
      blocks: [
        {
          heading: 'ביגוד — אחריות 30 יום',
          copy: POLICIES.printify.he.returnIntro,
        },
        {
          heading: 'תכשיטים — אחריות 14 יום',
          copy: POLICIES.dropship.he.returnIntro,
        },
        {
          heading: 'כיצד לפתוח פנייה',
          copy: 'צרו קשר עם שירות הלקוחות עם מספר הזמנה, תיאור הבעיה ותמונות ברורות. אנחנו בודקים כל פנייה תוך 1–2 ימי עסקים.',
        },
      ],
    },
  },
  terms: {
    en: {
      title: 'Terms of Service',
      blocks: [
        { heading: 'Order Agreement', copy: 'By placing an order you agree to our production and fulfillment workflow, pricing, and shipping terms.' },
        { heading: 'Product Representation', copy: 'We optimize product imagery for consistency, but minor color differences can occur across screens and production batches.' },
        { heading: 'Liability Scope', copy: 'Our liability is limited to the item value paid, excluding external carrier or customs delays outside our control.' },
      ],
    },
    he: {
      title: 'תנאי שימוש',
      blocks: [
        { heading: 'הסכמת הזמנה', copy: 'ביצוע הזמנה מהווה הסכמה לתהליך הייצור, התנאים המסחריים ומדיניות המשלוחים.' },
        { heading: 'דיוק תצוגת מוצרים', copy: 'אנחנו שומרים על אחידות גבוהה, אך ייתכנו הבדלים קלים בגוון בין מסכים ובין אצוות ייצור.' },
        { heading: 'הגבלת אחריות', copy: 'האחריות שלנו מוגבלת לערך הפריט ששולם, ואינה כוללת עיכובים של גורמי שילוח או מכס.' },
      ],
    },
  },
};

function PolicyModal({ policy, locale, onClose }) {
  const policyData = POLICY_CONTENT[policy];
  if (!policyData) return null;
  const lang      = locale === 'he' ? 'he' : 'en';
  const localized = policyData[lang];

  return (
    <div className="footer-policy-overlay" onClick={onClose}>
      <div className="footer-policy-modal" onClick={(event) => event.stopPropagation()} dir={locale === 'he' ? 'rtl' : 'ltr'}>
        <button type="button" className="footer-policy-close" onClick={onClose} aria-label={locale === 'he' ? 'סגור' : 'Close'}>×</button>
        <span className="footer-policy-chip">{locale === 'he' ? 'מדיניות' : 'Policy'}</span>
        <h3>{localized.title}</h3>
        <div className="footer-policy-grid">
          {localized.blocks.map((block) => (
            <article key={block.heading} className="footer-policy-card">
              <h4>{block.heading}</h4>
              <p>{block.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Footer({ locale = 'en' }) {
  const [activePolicy, setActivePolicy] = useState(null);
  const [newsletterSubmitted, setNewsletterSubmitted] = useState(false);

  const copy = useMemo(() => {
    if (locale === 'he') {
      return {
        newsletterTitle: 'מועדון JØAKIM',
        newsletterSubtitle: 'הצטרפו לעדכונים, דרופים מוקדמים וקוד הטבה להזמנה הראשונה.',
        newsletterPlaceholder: 'כתובת האימייל שלך',
        newsletterCta: 'הצטרף',
      };
    }

    return {
      newsletterTitle: 'Join the Club',
      newsletterSubtitle: 'Subscribe for exclusive releases, early access, and 10% off your first order.',
      newsletterPlaceholder: 'Your email address',
      newsletterCta: 'Join',
    };
  }, [locale]);

  const handleNewsletterSubmit = (e) => {
    e.preventDefault();
    if (e.target.querySelector('input')?.value) {
      setNewsletterSubmitted(true);
    }
  };

  return (
    <footer className="site-footer" style={{ borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--color-black-500)', color: 'var(--color-white)', padding: '60px 20px 40px 20px', marginTop: 'auto' }}>
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '40px', marginBottom: '40px' }}>
        
        {/* Brand Column */}
        <div className="footer-brand-col" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <img
            src="/joakim-approved-full-logo.png?v=2"
            alt="Jøakim"
            style={{ height: '100px', width: 'auto', objectFit: 'contain', display: 'block', opacity: 0.90 }}
          />
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
            <li><button type="button" onClick={() => setActivePolicy('terms')} className="footer-legal-trigger">Terms of Service</button></li>
            <li><button type="button" onClick={() => setActivePolicy('refund')} className="footer-legal-trigger">Refund Policy</button></li>
            <li><button type="button" onClick={() => setActivePolicy('shipping')} className="footer-legal-trigger">Shipping Policy</button></li>
          </ul>
        </div>

        {/* Column 4: Newsletter */}
        <div className="footer-newsletter-col" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px', textAlign: locale === 'he' ? 'right' : 'left' }}>{copy.newsletterTitle}</h3>
          {newsletterSubmitted ? (
            <p style={{ fontSize: '13px', color: '#C8B89A', margin: 0, textAlign: locale === 'he' ? 'right' : 'left' }}>
              {locale === 'he' ? 'תודה. נהיה בקשר.' : 'You\'re in. We\'ll be in touch.'}
            </p>
          ) : (
            <>
              <p style={{ fontSize: '13px', opacity: 0.6, margin: 0, textAlign: locale === 'he' ? 'right' : 'left' }}>{copy.newsletterSubtitle}</p>
              <form onSubmit={handleNewsletterSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="email"
                  placeholder={copy.newsletterPlaceholder}
                  required
                  dir={locale === 'he' ? 'rtl' : 'ltr'}
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
                  data-track="newsletter_submit"
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
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                >
                  {copy.newsletterCta}
                </button>
              </form>
            </>
          )}
        </div>

      </div>

      <div className="container" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
        <p style={{ fontSize: '13px', opacity: 0.5, margin: 0 }}>
          &copy; 2026 JØAKIM™. All rights reserved.
        </p>
        <div className="footer-socials" style={{ display: 'flex', gap: '16px' }}>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>Instagram</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>TikTok</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none', fontSize: '13px', opacity: 0.5 }}>Twitter</a>
        </div>
      </div>

      {activePolicy && <PolicyModal policy={activePolicy} locale={locale} onClose={() => setActivePolicy(null)} />}
    </footer>
  );
}
