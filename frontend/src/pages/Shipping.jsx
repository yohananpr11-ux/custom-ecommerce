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

export default function Shipping() {
  return (
    <LegalPageLayout title="Shipping Policy" breadcrumb="Shipping">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>מדיניות משלוחים</h2>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>ב-Drip Street אנו שואפים לספק חוויית משלוח חלקה, שקופה ואמינה. הזמנות עוברות עיבוד, אריזה ושילוח בהתאם לזמינות המלאי וליעד המסירה.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. זמן עיבוד</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>רוב ההזמנות מטופלות תוך 2-5 ימי עסקים. זמנים עשויים להשתנות בתקופות עומס, חגים או במקרה של חוסר זמני במלאי.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. חלונות אספקה</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>זמני המשלוח תלויים ביעד ובחברת השילוח. בדרך כלל ההגעה מתבצעת בתוך 6-20 ימי עסקים מרגע יציאת ההזמנה לדרך.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. מעקב ועדכונים</h3>
          <p dir="rtl" style={{ margin: 0, lineHeight: 1.9 }}>לאחר מסירת החבילה לחברת השילוח, יישלח קישור מעקב. אם לא מופיע עדכון במשך יותר מ-72 שעות, ניתן לפנות אלינו דרך התמיכה ואנחנו נבצע בדיקה מול הספק.</p>
        </section>

        <p dir="rtl" style={noteStyle}>עודכן לאחרונה: 1 ביוני 2026</p>
      </div>
    </LegalPageLayout>
  );
}
