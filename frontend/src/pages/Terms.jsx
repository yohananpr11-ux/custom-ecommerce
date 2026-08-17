import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LegalPageLayout from '../components/LegalPageLayout';

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const headingStyle = {
  color: 'var(--color-white)',
  fontSize: '18px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: 0,
};

const noteStyle = {
  margin: 0,
  color: 'var(--color-text-tertiary-gray)',
  fontSize: '14px',
};

export default function Terms() {
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('jono_locale') || localStorage.getItem('drip_street_locale');
      if (stored === 'he') setLocale('he');
    } catch { /* noop */ }
  }, []);

  if (locale === 'he') {
    return (
      <LegalPageLayout title="Terms Of Service" breadcrumb="Terms">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section style={sectionStyle}>
            <h2 style={headingStyle}>תנאי שימוש</h2>
            <p dir="rtl" style={{ margin: 0, lineHeight: 1.9, color: 'var(--color-text-secondary, #b3b3b3)' }}>
              מותג: JONO | פניות שירות: <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>עמוד יצירת קשר</Link>
            </p>
          </section>

          <section style={sectionStyle}>
            <h3 style={headingStyle}>1. ביצוע הזמנה</h3>
            <p dir="rtl" style={{ margin: 0, lineHeight: 1.9, color: 'var(--color-text-secondary, #b3b3b3)' }}>
              ביצוע הזמנה באתר מהווה אישור לכך שקראת והבנת את תנאי השימוש, את מדיניות המשלוחים ואת מדיניות ההחזרות של JONO. אנו שומרים לעצמנו את הזכות לעדכן מלאי, מחירים, זמני אספקה ותיאורי מוצרים לפי הצורך.
            </p>
          </section>

          <section style={sectionStyle}>
            <h3 style={headingStyle}>2. תיאור מוצרים ותמונות</h3>
            <p dir="rtl" style={{ margin: 0, lineHeight: 1.9, color: 'var(--color-text-secondary, #b3b3b3)' }}>
              אנו פועלים להציג את המוצרים באופן מדויק ככל האפשר, אך ייתכנו הבדלים קלים בגוון, בגזרה או במרקם בין התצוגה במסך לבין המוצר בפועל. תמונות המוצר מיועדות להמחשה בלבד.
            </p>
          </section>

          <section style={sectionStyle}>
            <h3 style={headingStyle}>3. אחריות והגבלות</h3>
            <p dir="rtl" style={{ margin: 0, lineHeight: 1.9, color: 'var(--color-text-secondary, #b3b3b3)' }}>
              האחריות של JONO מוגבלת לערך הרכישה ששולם בפועל. איננו אחראים לעיכובים הנובעים מגורמי שילוח חיצוניים, עיכובי מכס, שימוש לא נכון במוצר או נזק שנגרם לאחר המסירה.
            </p>
          </section>

          <p dir="rtl" style={noteStyle}>עודכן לאחרונה: אוגוסט 2026</p>
        </div>
      </LegalPageLayout>
    );
  }

  return (
    <LegalPageLayout title="Terms Of Service" breadcrumb="Terms">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', lineHeight: 1.7 }}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>General Terms</h2>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Welcome to JONO. By accessing our website and placing an order, you agree to comply with and be bound by the following terms and conditions.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. Order Placement & Production</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            All JONO apparel is custom printed-on-demand upon receipt of your order. Once an order is confirmed, production begins promptly. Please ensure your sizing, shipping address, and order selections are accurate before submitting payment.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. Pricing & Currency</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            All prices are listed in Israeli New Shekels (ILS) with USD equivalents shown for reference where applicable. Prices and product availability are subject to change without prior notice.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. Shipping & Delivery</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Estimated production and shipping times are provided for guidance and may vary depending on destination, customs processing, and local carrier operations. JONO is not liable for carrier delays beyond our reasonable control.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>4. Product Representation</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            We strive to display garment colors, textures, and print placements as accurately as possible. Minor variations between screen displays and physical garments may occur naturally due to monitor calibrations and fabric dye batches.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>5. Customer Support</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            For inquiries regarding orders, products, or service policies, please visit our <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>Contact Us</Link> page.
          </p>
        </section>

        <p style={noteStyle}>Last updated: August 2026</p>
      </div>
    </LegalPageLayout>
  );
}
