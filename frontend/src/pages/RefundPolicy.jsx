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
  return (
    <LegalPageLayout title="Refund Policy" breadcrumb="Refund Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: 'var(--color-white)', margin: '0 0 12px 0', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            סיכום קצר
          </h3>
          <p dir="rtl" style={{ margin: 0, fontSize: '14px', lineHeight: '1.8' }}>
            מוצרי Drip Street מיוצרים לפי הזמנה, ולכן לא ניתן להחזיר או להחליף פריטים בגלל בחירת מידה שגויה או שינוי דעת. עם זאת, אנחנו מעניקים אחריות של 30 יום במקרה של פגם ייצור, הדפסה לא תקינה או נזק שנגרם במשלוח.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. אחריות ייצור ל-30 יום
          </h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: '1.9' }}>
            אם המוצר הגיע עם פגם כמו הדפס לא מיושר, כתמי דיו, בד קרוע או בעיית תפירה, יש לפנות אלינו בתוך 30 יום ממועד המסירה. לאחר בדיקה, נדאג להחלפה ללא עלות או להחזר מלא בהתאם למקרה.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. איך מגישים פנייה
          </h2>
          <ol dir="rtl" style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li>שלחו מייל ל-<a href="mailto:support@dripstreetshop.com" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreetshop.com</a>.</li>
            <li>ציינו שם מלא, כתובת האימייל שבה בוצעה ההזמנה ומספר הזמנה.</li>
            <li>צרפו תמונות חדות של התקלה ושל תווית המשלוח.</li>
          </ol>
          <p dir="rtl" style={{ marginTop: '16px', marginBottom: 0, lineHeight: '1.9' }}>
            לאחר בדיקה, נעדכן אתכם במייל לגבי ההמשך. במקרים מאושרים, ההחזר יועבר לאמצעי התשלום המקורי תוך 5-10 ימי עסקים.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. שינויים במידה ובסגנון
          </h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: '1.9' }}>
            מומלץ לבדוק את טבלאות המידות לפני התשלום. מאחר וההזמנות נכנסות לייצור לפי דרישה, לא ניתן להחליף מידה, צבע או דגם לאחר תחילת התהליך.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. ביטול הזמנה
          </h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: '1.9' }}>
            לביטול הזמנה יש לפנות אלינו בתוך שעתיים מרגע ההזמנה ל-<a href="mailto:support@dripstreetshop.com" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreetshop.com</a>. לאחר מכן, ההזמנה עשויה להיכנס לייצור ולא ניתן יהיה לבטלה.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. עיתוי טיפול בהחזרים
          </h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: '1.9' }}>
            לאחר אישור הפנייה, ההחזר מבוצע מידית מול ספק התשלום. ברוב המקרים יידרשו 3-7 ימי עסקים עד להופעת הזיכוי בחשבון.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}