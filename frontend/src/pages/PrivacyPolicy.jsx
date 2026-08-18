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

const noteStyle = {
  margin: 0,
  color: 'var(--color-text-tertiary-gray)',
  fontSize: '14px',
};

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy" breadcrumb="Privacy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', lineHeight: 1.7 }}>
        <section style={sectionStyle}>
          <h2 style={headingStyle}>Privacy Commitment</h2>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            At JONO, we value your privacy and are committed to protecting the personal information you share with us. This policy outlines what data we collect, how it is handled, and how your privacy rights are respected.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>1. Information We Collect</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            We only collect information necessary to process your orders and provide a seamless shopping experience:
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--color-text-secondary, #b3b3b3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li><strong>Order & Contact Details:</strong> Name, email address, shipping address, and phone number provided during checkout.</li>
            <li><strong>Transactional Records:</strong> Order item details, pricing, fulfillment timestamps, and delivery tracking references.</li>
            <li><strong>Browsing & Session Data:</strong> Technical identifiers (such as device type and session state) used for cart persistence and site performance.</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>2. Payment Processing Security</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            Payment transactions are processed directly through certified, PCI-DSS compliant payment gateways (such as PayPal). JONO never stores, processes, or has access to your full credit card numbers or banking credentials.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>3. How We Use Your Information</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            We use your personal data strictly for operational purposes:
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--color-text-secondary, #b3b3b3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li>Routing and manufacturing your print-on-demand orders with our fulfillment partners.</li>
            <li>Sending transactional emails (order confirmations, delivery tracking updates, and critical service notifications).</li>
            <li>Providing responsive customer support and addressing inquiries.</li>
            <li>Delivering voluntary newsletter updates when you actively subscribe.</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>4. Data Sharing & Third-Party Processors</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            We do not sell, rent, or trade your personal data. Data is shared solely with trusted service providers necessary for store operations: fulfillment partners (for printing and shipping), transactional email services, and payment processors.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>5. Storage, Analytics & Cookies</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            JONO currently utilizes essential browser storage (such as local storage for your shopping cart and language preferences) and first-party session analytics to maintain store functionality and performance. While our platform is technically capable of integrating third-party analytics or marketing tools (such as Google Analytics or advertising pixels) to support future growth, these integrations are currently unconfigured in production. Should third-party analytics or advertising cookies be enabled, this policy will be updated accordingly.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>6. Your Rights & Contact</h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #b3b3b3)' }}>
            You have the right to request access to the personal data we hold about you or request its deletion. For any privacy-related questions or data requests, please reach out through our <Link to="/contact" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>Contact Us</Link> page.
          </p>
        </section>

        <p style={noteStyle}>Last updated: August 2026</p>
      </div>
    </LegalPageLayout>
  );
}
