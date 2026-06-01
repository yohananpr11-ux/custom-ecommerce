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

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy" breadcrumb="Privacy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>Privacy Policy Placeholder</h2>
          <p style={{ margin: 0 }}>
            This page is intentionally scaffolded for launch and awaits approved legal copy.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. Data Collection</h3>
          <p style={{ margin: 0 }}>TODO: Define collected data categories and lawful basis.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. Data Usage</h3>
          <p style={{ margin: 0 }}>TODO: Describe order processing, analytics, and communication use cases.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. Data Sharing And Retention</h3>
          <p style={{ margin: 0 }}>TODO: Document processors, storage duration, and transfer controls.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>4. User Rights</h3>
          <p style={{ margin: 0 }}>TODO: Add access, deletion, correction, and opt-out request process.</p>
        </section>

        <p style={noteStyle}>Last updated: pending legal review.</p>
      </div>
    </LegalPageLayout>
  );
}
