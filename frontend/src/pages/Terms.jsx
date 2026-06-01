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
  return (
    <LegalPageLayout title="Terms Of Service" breadcrumb="Terms">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>תנאי שימוש</h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>פרטי העסק: Drip Street | דוא"ל: support@dripstreetshop.com</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. ביצוע הזמנה</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>ביצוע הזמנה באתר מהווה אישור לכך שקראת והבנת את תנאי השימוש, את מדיניות המשלוחים ואת מדיניות ההחזרות של Drip Street. אנו שומרים לעצמנו את הזכות לעדכן מלאי, מחירים, זמני אספקה ותיאורי מוצרים לפי הצורך.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. תיאור מוצרים ותמונות</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>אנו פועלים להציג את המוצרים באופן מדויק ככל האפשר, אך ייתכנו הבדלים קלים בגוון, בגזרה או במרקם בין התצוגה במסך לבין המוצר בפועל. תמונות המוצר מיועדות להמחשה בלבד.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. אחריות והגבלות</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>האחריות של Drip Street מוגבלת לערך הרכישה ששולם בפועל. איננו אחראים לעיכובים הנובעים מגורמי שילוח חיצוניים, עיכובי מכס, שימוש לא נכון במוצר או נזק שנגרם לאחר המסירה.</p>
        </section>

        <p dir="rtl" style={noteStyle}>עודכן לאחרונה: 1 ביוני 2026</p>
      </div>
    </LegalPageLayout>
  );
}
