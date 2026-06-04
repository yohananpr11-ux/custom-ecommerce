import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const POLICY_CONTENT = {
  shipping: {
    title: 'Shipping Policy',
    blocks: [
      { heading: 'Processing Window', copy: 'Every order is prepared and quality-checked before dispatch. Most orders leave production within 2-5 business days.' },
      { heading: 'Transit Estimates', copy: 'Express shipping times depend on destination and customs flow. Typical delivery ranges from 6-20 business days.' },
      { heading: 'Tracking & Support', copy: 'A tracking link is sent once the carrier scans your parcel. If tracking stalls for more than 72 hours, contact support for a fast follow-up.' },
    ],
  },
  refund: {
    title: 'Refund Policy',
    blocks: [
      { heading: 'Quality Guarantee', copy: 'If an item arrives damaged, misprinted, or defective, we replace it or refund it after validation.' },
      { heading: 'Claim Window', copy: 'Submit your request within 30 days of delivery with your order number and clear photos of the issue.' },
      { heading: 'Non-Returnable Cases', copy: 'Because products are made on demand, we cannot process refunds for wrong-size selections or buyer remorse after production starts.' },
    ],
  },
  terms: {
    title: 'Terms of Service',
    blocks: [
      { heading: 'Order Agreement', copy: 'By placing an order you agree to our production and fulfillment workflow, pricing, and shipping terms.' },
      { heading: 'Product Representation', copy: 'We optimize product imagery for consistency, but minor color differences can occur across screens and print batches.' },
      { heading: 'Liability Scope', copy: 'Our liability is limited to the item value paid, excluding external carrier or customs delays outside our control.' },
    ],
  },
};

function PolicyModal({ policy, locale, onClose }) {
  const base = POLICY_CONTENT[policy];
  if (!base) return null;

  const localized = locale === 'he'
    ? {
        shipping: {
          title: 'מדיניות משלוחים',
          blocks: [
            { heading: 'זמן הכנה', copy: 'כל הזמנה עוברת הכנה ובקרת איכות לפני יציאה. ברוב המקרים המשלוח יוצא תוך 2-5 ימי עסקים.' },
            { heading: 'טווחי הגעה', copy: 'זמני הגעה תלויים ביעד ובתהליכי מכס. לרוב ההגעה נעה בין 6-20 ימי עסקים.' },
            { heading: 'מעקב ותמיכה', copy: 'לינק מעקב נשלח מיד לאחר סריקה של חברת השילוח. אם אין התקדמות יותר מ-72 שעות, שירות הלקוחות מטפל מיידית.' },
          ],
        },
        refund: {
          title: 'מדיניות החזרים',
          blocks: [
            { heading: 'אחריות איכות', copy: 'אם פריט הגיע פגום או עם הדפס לא תקין, נציע החלפה או החזר מלא לאחר בדיקה.' },
            { heading: 'חלון פתיחת פנייה', copy: 'אפשר לפתוח פנייה עד 30 יום ממועד המסירה עם מספר הזמנה ותמונות ברורות.' },
            { heading: 'מקרים ללא החזר', copy: 'מאחר והפריטים מיוצרים לפי הזמנה, לא ניתן לבצע החזר על בחירת מידה שגויה או שינוי דעת לאחר תחילת ייצור.' },
          ],
        },
        terms: {
          title: 'תנאי שימוש',
          blocks: [
            { heading: 'הסכמת הזמנה', copy: 'ביצוע הזמנה מהווה הסכמה לתהליך הייצור, התנאים המסחריים ומדיניות המשלוחים.' },
            { heading: 'דיוק תצוגת מוצרים', copy: 'אנחנו שומרים על אחידות גבוהה, אך ייתכנו הבדלים קלים בגוון בין מסכים ובין אצוות הדפסה.' },
            { heading: 'הגבלת אחריות', copy: 'האחריות שלנו מוגבלת לערך הפריט ששולם, ואינה כוללת עיכובים של גורמי שילוח או מכס.' },
          ],
        },
      }[policy]
    : base;

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

  const copy = useMemo(() => {
    if (locale === 'he') {
      return {
        newsletterTitle: 'מועדון DRIP STREET',
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
          {/* Phase 11.5: badge styling matches the navbar — same border + shadow
              recipe, scaled up for footer presence. Larger radius (16px) on
              the larger 64px badge keeps the corner ratio consistent and
              feels more premium at this size. */}
          <img
            src="/logo-new.png"
            alt="Drip Street Logo"
            style={{
              height: '64px',
              width: '64px',
              objectFit: 'cover',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
              alignSelf: 'flex-start',
            }}
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
        </div>

      </div>

      <div className="container" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
        <p style={{ fontSize: '13px', opacity: 0.5, margin: 0 }}>
          &copy; 2026 Drip Street. All rights reserved.
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
