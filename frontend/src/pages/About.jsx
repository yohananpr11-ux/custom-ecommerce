import { motion } from 'framer-motion';
import LegalPageLayout from '../components/LegalPageLayout';

const vision = 'בדריפסטריט אנחנו מאמינים שסטייל אמיתי לא צריך להתאמץ. החזון שלנו פשוט: לייצר ולאצור פריטי סטריטוור מינימליסטיים, נקיים וממכרים שיושבים בול מהרגע הראשון. בלי לוגואים מוגזמים או טרנדים חולפים – רק גזרות מדויקות, חומרים איכותיים ואסתטיקה שמשתלבת בטבעיות בחיים האורבניים, מבוקר עד לילה. אנחנו כאן בשביל אלה שמבינים שפשטות היא התחכום האולטימטיבי, ושבגדים טובים נועדו לתת לך את הביטחון להיות בדיוק מי שאתה.';

const pillarCards = [
  {
    title: 'Precision First',
    copy: 'Every silhouette is tuned for the body, the movement, and the everyday rhythm of the city.',
  },
  {
    title: 'Quiet Premium',
    copy: 'We keep the language restrained so the fit, fabric, and finishing details do the talking.',
  },
  {
    title: 'Built For Rotation',
    copy: 'Pieces are designed to be worn repeatedly, styled easily, and remembered immediately.',
  },
];

export default function About() {
  return (
    <LegalPageLayout title="About Us" breadcrumb="About">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
        <section style={{
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '24px',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
          boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          padding: '32px',
        }}>
          <div style={{ position: 'absolute', inset: '-40% auto auto -20%', width: '320px', height: '320px', borderRadius: '999px', background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 65%)', filter: 'blur(8px)' }} />
          <div style={{ position: 'relative', display: 'grid', gap: '18px' }}>
            <span style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.04)', fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-white)' }}>
              Our Story
            </span>
            <motion.h2
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              style={{ margin: 0, fontSize: 'clamp(30px, 5vw, 56px)', lineHeight: 1, letterSpacing: '-0.04em', textTransform: 'uppercase', color: 'var(--color-white)' }}
            >
              Minimal streetwear, tuned with intent.
            </motion.h2>
            <p style={{ margin: 0, maxWidth: '720px', fontSize: '18px', lineHeight: 1.85, color: 'rgba(255,255,255,0.84)' }}>
              Drip Street exists to make premium dressing feel clean, grounded, and easy to wear every day.
            </p>
          </div>
        </section>

        <section style={{
          borderRadius: '24px',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
          padding: '28px',
          backdropFilter: 'blur(20px)',
        }}>
          <h3 style={{ margin: '0 0 14px', color: 'var(--color-white)', fontSize: '16px', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Brand Vision
          </h3>
          <p dir="rtl" style={{ margin: 0, fontSize: '18px', lineHeight: 2, color: 'rgba(255,255,255,0.9)' }}>
            {vision}
          </p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
          {pillarCards.map((card) => (
            <article key={card.title} style={{
              padding: '24px',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
            }}>
              <h4 style={{ margin: '0 0 10px', color: 'var(--color-white)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{card.title}</h4>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.72)', lineHeight: 1.8 }}>{card.copy}</p>
            </article>
          ))}
        </section>
      </div>
    </LegalPageLayout>
  );
}