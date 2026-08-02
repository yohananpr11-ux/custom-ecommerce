import LegalPageLayout from '../components/LegalPageLayout';

export default function RefundPolicy() {
  return (
    <LegalPageLayout title="Refund Policy" breadcrumb="Refund Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* ── Summary ── */}
        <section style={{ background: 'rgba(255,255,255,0.02)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: 'var(--color-white)', margin: '0 0 12px 0', fontSize: '16px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            סיכום קצר
          </h3>
          <p dir="rtl" style={{ margin: 0, fontSize: '14px', lineHeight: 1.8 }}>
            לכל קטגוריית מוצרים מדיניות נפרדת:<br />
            <strong>ביגוד (Printify):</strong> אחריות ייצור 30 יום — פגמי הדפסה, תפירה ואריגה.<br />
            <strong>תכשיטים ואביזרים (CJ Dropshipping):</strong> חלון החזרה 15 יום לבעיות איכות בלבד — נדרשות תמונות.
          </p>
        </section>

        {/* ── PRINTIFY APPAREL ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            א. ביגוד — Printify (הדפסה לפי הזמנה)
          </h2>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>1. אחריות ייצור — 30 יום</h3>
          <p dir="rtl" style={{ margin: '0 0 16px 0', lineHeight: 1.9 }}>
            אם המוצר הגיע עם פגם ייצור כגון הדפס לא מיושר, כתמי דיו, בד קרוע או בעיית תפירה — יש לפנות אלינו בתוך 30 יום ממועד המסירה. לאחר בדיקה, נטפל בהחלפה ללא עלות או בהחזר כספי מלא.
          </p>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>2. שינויי מידה וסגנון</h3>
          <p dir="rtl" style={{ margin: '0 0 16px 0', lineHeight: 1.9 }}>
            מאחר וההזמנות נכנסות לייצור לפי דרישה, לא ניתן להחליף מידה, צבע או דגם לאחר אישור ההזמנה. מומלץ לבדוק את טבלאות המידות לפני הרכישה.
          </p>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>3. ביטול הזמנה</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>
            ניתן לבטל הזמנה בתוך שעתיים מרגע ביצועה. לאחר מכן, ההזמנה עשויה להיכנס לייצור ולא תתאפשר ביטול.
          </p>
        </section>

        {/* ── CJ DROPSHIPPING ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            ב. תכשיטים ואביזרים — CJ Dropshipping
          </h2>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>1. חלון החזרה — 15 יום</h3>
          <p dir="rtl" style={{ margin: '0 0 16px 0', lineHeight: 1.9 }}>
            ניתן לפנות להחזרה בתוך 15 יום מיום קבלת המוצר, אך ורק במקרים הבאים: פגם ייצור, נזק שנגרם במשלוח, או פריט שגוי. לא מתקבלות החזרות בגלל "שינוי דעת" או אי-התאמת מידה.
          </p>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>2. תהליך הפנייה</h3>
          <ol dir="rtl" style={{ paddingLeft: '20px', margin: '0 0 16px 0', lineHeight: 1.9 }}>
            <li>שלחו מייל ל-<a href="mailto:support@dripstreetshop.com" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreetshop.com</a> בתוך 15 יום מהאספקה.</li>
            <li>ציינו מספר הזמנה ותיאור הבעיה.</li>
            <li>צרפו תמונות חדות של הפגם / הנזק.</li>
            <li>לאחר אישור, נתאם עם הספק החלפה או זיכוי לחנות.</li>
          </ol>

          <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>3. עלות משלוח החזרה</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>
            במקרה של פגם ייצור, עלות המשלוח חזרה מכוסה. במקרים אחרים — עלות המשלוח חזרה על חשבון הלקוח.
          </p>
        </section>

        {/* ── Shared process ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            ג. עיתוי טיפול בהחזרים
          </h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>
            לאחר אישור הפנייה, ההחזר מועבר לאמצעי התשלום המקורי. ברוב המקרים יידרשו 5–10 ימי עסקים עד להופעת הזיכוי בחשבון.
          </p>
        </section>

      </div>
    </LegalPageLayout>
  );
}
