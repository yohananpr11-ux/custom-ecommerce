import React from 'react';
import LegalPageLayout from '../components/LegalPageLayout';

export default function TermsOfService() {
  return (
    <LegalPageLayout title="Terms of Service" breadcrumb="Terms of Service">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. Agreement to Terms
          </h2>
          <p style={{ margin: 0 }}>
            By accessing or using the Drip Street website, storefront, and transaction systems, you agree to be bound by these Terms of Service and all policies referenced herein. If you do not agree with any part of these terms, you are prohibited from using the platform.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. Intellectual Property Rights
          </h2>
          <p style={{ margin: 0 }}>
            All intellectual property, website design code, SVGs, high-resolution logos, brand artwork, visual layout structure, product graphics, and typography systems are the exclusive property of Drip Street. You are prohibited from copying, distributing, republishing, or mimicking any visual brand assets without our written consent.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. Accuracy of Store & Product Data
          </h2>
          <p style={{ margin: 0 }}>
            We attempt to present our catalog with the highest accuracy. However, colors, textures, and prints can appear slightly different depending on your mobile screen or display specifications. Size specifications are subject to international garment tolerances (&plusmn;1 inch). We reserve the right to modify prices or adjust active product configurations without prior notification.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. Printify Print-on-Demand Fulfillment
          </h2>
          <p style={{ margin: 0 }}>
            Drip Street designs are custom printed on demand using Printify's global fulfillment networks. By placing an order, you acknowledge that manufacturing begins immediately. Consequently, shipping address modifications or size alterations cannot be processed once the manufacturing facility accepts the order.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. Payment, Taxes & Currency
          </h2>
          <p style={{ margin: 0 }}>
            All catalog values are denominated in USD. Payments are securely processed. VAT charges are calculated in accordance with the regulatory status of the business (currently Osek Patur - 0% VAT).
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            6. Limitation of Liability
          </h2>
          <p style={{ margin: 0 }}>
            Drip Street, its owners, and partners will not be liable for any direct, indirect, incidental, or consequential damages resulting from the use of our products, manufacturing delays by logistics carriers, or temporary website outages.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            7. Governing Law
          </h2>
          <p style={{ margin: 0 }}>
            These terms are governed by and construed in accordance with the laws applicable in the region of operation. Any dispute arising from these terms will be settled exclusively by local arbitration.
          </p>
        </section>

        <section style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px', marginTop: '16px' }}>
          <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
            If you have questions regarding these Terms, contact our support team at <a href="mailto:support@dripstreet.shop" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreet.shop</a>.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
