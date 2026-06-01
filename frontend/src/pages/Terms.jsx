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
          <h2 style={headingStyle}>Terms Placeholder</h2>
          <p style={{ margin: 0 }}>This page is a launch scaffold and requires final legal approval text.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. Order Agreement</h3>
          <p style={{ margin: 0 }}>TODO: Insert finalized purchase terms, eligibility, and account responsibilities.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. Product Representation</h3>
          <p style={{ margin: 0 }}>TODO: Add media accuracy language, color variation clause, and availability notices.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. Liability And Disputes</h3>
          <p style={{ margin: 0 }}>TODO: Add liability cap, dispute jurisdiction, and policy change process.</p>
        </section>

        <p style={noteStyle}>Last updated: pending legal review.</p>
      </div>
    </LegalPageLayout>
  );
}
