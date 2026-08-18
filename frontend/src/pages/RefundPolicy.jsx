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

export default function RefundPolicy() {
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('jono_locale');
      if (stored === 'he') setLocale('he');
    } catch { /* noop */ }
  }, []);

  if (locale === 'he') {
    return (
      <LegalPageLayout title="Refund Policy" breadcrumb="Refund Policy">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ color: 'var(--color-white)', margin: '0 0 12px 0', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              סיכום קצר
            </h3>
            <p dir="rtl" style={{ margin: 0, fontSize: '14px', lineHeight: '1.8', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              מוצרי JONO מיוצרים לפי הזמנה, ולכן לא ניתן להחזיר או להחליף פריטים בגלל בחירת מידה שגויה או שינוי דעת. עם זאת, אנחנו מעניקים אחריות של 30 יום במקרה של פגם ייצור, הדפסה לא תקינה או נזק שנגרם במשלוח.
            </p>
          </section>

          <section>
            <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
              1. אחריות ייצור ל-30 יום
            </h2>
            <p dir="rtl" style={{ margin: 0, lineHeight: '1.9', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              אם המוצר הגיע עם פגם כמו הדפס לא מיושר, כתמי דיו, בד קרוע או בעיית תפירה, יש לפנות אלינו בתוך 30 יום ממועד המסירה. לאחר בדיקה, נדאג להחלפה ללא עלות או להחזר מלא בהתאם למקרה.
            </p>
          </section>

          <section>
            <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
              2. איך מגישים פנייה
            </h2>
            <ol dir="rtl" style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              <li>פנו אלינו דרך <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>עמוד יצירת קשר</Link>.</li>
              <li>ציינו שם מלא, כתובת האימייל שבה בוצעה ההזמנה ומספר הזמנה.</li>
              <li>צרפו תמונות חדות של התקלה ושל תווית המשלוח.</li>
            </ol>
            <p dir="rtl" style={{ marginTop: '16px', marginBottom: 0, lineHeight: '1.9', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              לאחר בדיקה, נעדכן אתכם לגבי ההמשך. במקרים מאושרים, ההחזר יועבר לאמצעי התשלום המקורי תוך 3-7 ימי עסקים.
            </p>
          </section>

          <section>
            <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
              3. ביטול הזמנה
            </h2>
            <p dir="rtl" style={{ margin: 0, lineHeight: '1.9', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              לביטול הזמנה יש לפנות אלינו בתוך שעתיים מרגע ביצוע ההזמנה דרך <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>עמוד יצירת קשר</Link>. לאחר מכן, ההזמנה נכנסת לייצור ולא ניתן יהיה לבטלה.
            </p>
          </section>

          <section>
            <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
              4. עיתוי טיפול בהחזרים
            </h2>
            <p dir="rtl" style={{ margin: 0, lineHeight: '1.9', color: 'var(--color-text-secondary, #b3b3b3)' }}>
              לאחר אישור הפנייה, ההחזר מבוצע מידית מול ספק התשלום. ברוב המקרים יידרשו 3-7 ימי עסקים עד להופעת הזיכוי בחשבון.
            </p>
          </section>
        </div>
      </LegalPageLayout>
    );
  }

  return (
    <LegalPageLayout title="Refund Policy" breadcrumb="Refund Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', lineHeight: 1.7 }}>
        <section style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: 'var(--color-white)', margin: '0 0 12px 0', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Summary
          </h3>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.8', color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Because JONO apparel is custom printed-on-demand, we cannot accept returns or exchanges for sizing errors or change of mind. However, we stand behind our quality with a 30-day guarantee for manufacturing defects, misprints, or shipping damage.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>1. 30-Day Quality Guarantee</h2>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            If your item arrives defective, misprinted, or damaged in transit, please contact us within 30 days of delivery. Upon verification, we will promptly arrange a free replacement or issue a full refund.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>2. How to Submit a Claim</h2>
          <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-secondary, #b3b3b3)' }}>
            <li>Visit our <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>Contact Us</Link> page.</li>
            <li>Provide your full name, order email address, and order ID.</li>
            <li>Include clear photos showing the defect and the packaging/shipping label.</li>
          </ol>
          <p style={{ margin: '8px 0 0 0', color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Approved refunds are credited back to your original payment method within 3–7 business days.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>3. Order Cancellations</h2>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Because orders are automatically queued for production, cancellation requests must be submitted within 2 hours of placing the order via our <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>Contact Us</Link> page. Once printing has begun, orders cannot be cancelled.
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={headingStyle}>4. Refund Processing Timing</h2>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Once approved, the refund is processed immediately through the payment processor. In most cases, it takes 3–7 business days to reflect on your statement depending on your financial institution.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}