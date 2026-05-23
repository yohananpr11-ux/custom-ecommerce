import LegalPageLayout from '../components/LegalPageLayout';

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy" breadcrumb="Privacy Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. Introduction
          </h2>
          <p style={{ margin: 0 }}>
            At Drip Street, we respect your privacy and are committed to protecting your personal data. This Privacy Policy describes how Drip Street Shop ("we", "us", or "our") collects, uses, processes, and shares your personal information when you visit, use our services, or make a purchase from our site.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. Personal Data We Collect
          </h2>
          <p style={{ marginBottom: '16px' }}>
            We collect personal information to provide a tailored streetwear shopping experience. The categories of information we collect include:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li><strong>Identity & Contact Information:</strong> Your full name, email address, shipping address, billing address, and telephone number.</li>
            <li><strong>Payment Details:</strong> Encrypted payment tokenization data (processed entirely by certified gateways like Stripe or PayPal; we do not store raw credit card details).</li>
            <li><strong>Order History:</strong> Record of products purchased, size configurations, transaction values, and promo code usage.</li>
            <li><strong>Technical & Usage Information:</strong> IP address, device specifications, browser type, operating system, geolocation markers, and browsing logs.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. How We Use Your Data
          </h2>
          <p style={{ marginBottom: '16px' }}>
            We process your information based on legitimate commercial interests, contractual fulfillment, and legal compliance:
          </p>
          <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li>To process, pack, and fulfill your orders through our production and shipping partners.</li>
            <li>To secure payments and detect/prevent fraudulent transactions.</li>
            <li>To provide customer support (including our AI support chatbot and live messaging system).</li>
            <li>To notify you about changes to order updates, shipping statuses, and store announcements.</li>
            <li>To analyze user behavior and traffic to optimize our design system and inventory selection.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. Cookies & Automated Tracking
          </h2>
          <p style={{ margin: 0 }}>
            We use cookie tokens, pixels, and local storage configurations to store your shopping cart items, recognize your preferred currency, and evaluate marketing campaign performance. You can disable cookies directly through your individual web browser settings, although some core eCommerce features like checkout persistence may be disabled.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. Sharing with Third Parties
          </h2>
          <p style={{ marginBottom: '16px' }}>
            We never sell your personal information. We partner with reliable, secure third-party service providers to handle specialized operations:
          </p>
          <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li><strong>Fulfillment Services:</strong> Printify API integration to manufacture and dispatch bespoke products.</li>
            <li><strong>Payment Gateways:</strong> PayPal and Stripe for encrypted, safe transaction processing.</li>
            <li><strong>Communication Platforms:</strong> Transactional email dispatchers and Telegram Webhook integration for instant error reports and support alerts.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            6. GDPR & CCPA Compliance Rights
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Depending on your legal jurisdiction (specifically residents of the EU/UK under GDPR and California under CCPA), you hold legal rights regarding your personal details, including:
          </p>
          <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li>The right to request a full copy of the personal details we hold.</li>
            <li>The right to request immediate correction or updates of incorrect data.</li>
            <li>The right to request complete deletion of your files ("right to be forgotten").</li>
            <li>The right to object to automatic processing or opt out of specific marketing communications.</li>
          </ul>
        </section>

        <section style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px', marginTop: '16px' }}>
          <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
            For privacy inquiries, data deletion requests, or information correction, please contact our Compliance Officer at <a href="mailto:privacy@dripstreet.shop" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>privacy@dripstreet.shop</a>.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
