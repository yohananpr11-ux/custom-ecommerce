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
          <h2 style={headingStyle}>Shipping Policy Placeholder</h2>
          <p style={{ margin: 0 }}>This policy page is intentionally scaffolded for final legal copy input before launch.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. Processing Timeline</h3>
          <p style={{ margin: 0 }}>TODO: Add fulfillment processing SLA and warehouse cut-off times.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. Delivery Windows</h3>
          <p style={{ margin: 0 }}>TODO: Add destination-based shipping ranges and service levels.</p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. Tracking And Exceptions</h3>
          <p style={{ margin: 0 }}>TODO: Add tracking support steps, delay handling, and lost parcel policy.</p>
        </section>

        <p style={noteStyle}>Last updated: pending legal review.</p>
      </div>
    </LegalPageLayout>
  );
}
