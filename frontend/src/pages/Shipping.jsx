import LegalPageLayout from '../components/LegalPageLayout';

const noteStyle = { margin: 0, color: 'var(--color-text-tertiary-gray)', fontSize: '14px' };

export default function Shipping() {
  return (
    <LegalPageLayout title="Shipping Policy" breadcrumb="Shipping">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

        <section style={{ lineHeight: 1.9 }}>
          <h2 style={{ color: 'var(--color-white)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>מדיניות משלוחים</h2>
          <p dir="rtl" style={{ margin: 0 }}>
            ב-Drip Street אנו עובדים עם שני ספקי הגשמה שונים — כל אחד עם זמני עיבוד ומשלוח משלו.
          </p>
        </section>

        {/* ── PRINTIFY ── */}
        <section style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', lineHeight: 1.9 }}>
          <h3 style={{ color: 'var(--color-white)', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 12px 0' }}>
            א. ביגוד — Printify (הדפסה לפי הזמנה)
          </h3>
          <ul dir="rtl" style={{ margin: '0 0 8px 0', paddingLeft: '20px' }}>
            <li><strong>ייצור:</strong> 2–5 ימי עסקים</li>
            <li><strong>משלוח:</strong> 5–25 ימי עסקים בהתאם ליעד</li>
            <li><strong>ישראל / מזרח תיכון:</strong> בדרך כלל 12–30 ימי עסקים (ייצור + משלוח)</li>
          </ul>
          <p dir="rtl" style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
            כל פריט ביגוד מיוצר לאחר ההזמנה — הדפסה, בדיקה ואריזה במתקן Printify.
          </p>
        </section>

        {/* ── CJ ── */}
        <section style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', lineHeight: 1.9 }}>
          <h3 style={{ color: 'var(--color-white)', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 12px 0' }}>
            ב. תכשיטים ואביזרים — CJ Dropshipping
          </h3>
          <ul dir="rtl" style={{ margin: '0 0 8px 0', paddingLeft: '20px' }}>
            <li><strong>עיבוד ומשלוח:</strong> 1–3 ימי עסקים מהמחסן</li>
            <li><strong>משלוח:</strong> 7–20 ימי עסקים</li>
            <li><strong>ישראל:</strong> בדרך כלל 10–20 ימי עסקים סה"כ</li>
          </ul>
          <p dir="rtl" style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
            הפריטים מוכנים מראש במחסן CJ ומשוגרים לאחר בדיקת איכות קצרה.
          </p>
        </section>

        {/* ── Tracking ── */}
        <section style={{ lineHeight: 1.9 }}>
          <h3 style={{ color: 'var(--color-white)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>מעקב</h3>
          <p dir="rtl" style={{ margin: 0 }}>
            לאחר מסירת החבילה לחברת השילוח, יישלח קישור מעקב למייל. אם לא מופיע עדכון במשך יותר מ-72 שעות — פנו אלינו ב-<a href="mailto:support@dripstreetshop.com" style={{ color: 'var(--color-white)' }}>support@dripstreetshop.com</a>.
          </p>
        </section>

        <p dir="rtl" style={noteStyle}>עודכן לאחרונה: יוני 2026</p>
      </div>
    </LegalPageLayout>
  );
}
