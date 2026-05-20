import React from 'react';
import LegalPageLayout from '../components/LegalPageLayout';

export default function RefundPolicy() {
  return (
    <LegalPageLayout title="Refund Policy" breadcrumb="Refund Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        
        <section style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ color: 'var(--color-white)', margin: '0 0 12px 0', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            ⚡ TL;DR Summary
          </h3>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
            Because Drip Street products are custom printed on demand upon receipt of your order, we do not accept returns or exchanges for incorrect sizes or changed minds. However, we offer a **14-day replacement/refund warranty** for any manufacturing defects, print blemishes, or items damaged during transit.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. 14-Day Manufacturing Warranty
          </h2>
          <p style={{ margin: 0 }}>
            If your garment arrives with a defect (such as misaligned prints, ink stains, torn fabric, or stitching issues), please notify us within **14 days** of the delivery date. We will coordinate a free replacement or complete refund immediately. You do not need to ship the defective item back to us.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. How to File a Claim
          </h2>
          <p style={{ marginBottom: '16px' }}>
            To report a damaged, defective, or misprinted item, please follow these steps:
          </p>
          <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <li>Send an email to <a href="mailto:support@dripstreet.shop" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreet.shop</a>.</li>
            <li>Include your full name, email address used during purchase, and order number.</li>
            <li>Attach high-resolution photos showing the garment defect alongside a picture of the shipping label on the package.</li>
          </ol>
          <p style={{ marginTop: '16px', marginBottom: 0 }}>
            Once our customer service team evaluates the submission, we will arrange a replacement print or dispatch the refund.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. Size Exchanges & Selection Changes
          </h2>
          <p style={{ margin: 0 }}>
            Our garments are cataloged with custom sizing guides. Please review the sizing specs carefully before completing the payment checkout. Since Printify schedules manufacturing dynamically on bespoke blank materials, we cannot exchange sizes, styles, or colors once orders enter the production phase.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. Order Cancellations
          </h2>
          <p style={{ margin: 0 }}>
            If you wish to cancel an order, you must contact us at <a href="mailto:support@dripstreet.shop" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreet.shop</a> within **2 hours** of placement. After this timeframe, your order will be automatically synced with the Printify manufacturing APIs and cannot be recalled.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. Processing Timelines
          </h2>
          <p style={{ margin: 0 }}>
            Approved refunds are dispatched immediately to your original payment provider (PayPal, Visa, Mastercard, Apple Pay). It typically takes 3 to 7 business days for banking institutions to credit the transaction back to your account statement.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
