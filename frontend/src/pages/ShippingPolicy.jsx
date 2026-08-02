import LegalPageLayout from '../components/LegalPageLayout';

export default function ShippingPolicy() {
  return (
    <LegalPageLayout title="Shipping Policy" breadcrumb="Shipping Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

        {/* ── PRINTIFY APPAREL ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. Apparel — Printify Print-on-Demand
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Drip Street apparel is made-to-order through Printify's global fulfillment network. Each garment is printed, inspected, and packaged only when you place your order — eliminating dead stock and ensuring a fresh item every time.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '16px' }}>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px 0' }}>⚙️ Phase 1: Production</h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.85 }}>
                <strong>2 – 5 Business Days</strong><br />
                Printing, inspection, and packaging at the Printify partner facility.
              </p>
            </div>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px 0' }}>📦 Phase 2: Shipping</h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.85 }}>
                <strong>Varies by destination</strong><br />
                DHL, FedEx, UPS, USPS, or local post. Transit depends on your country.
              </p>
            </div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '13px' }}>Typical total delivery (production + shipping):</p>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', opacity: 0.85, lineHeight: 1.8 }}>
              <li><strong>United States:</strong> 6 – 14 business days</li>
              <li><strong>European Union &amp; UK:</strong> 8 – 17 business days</li>
              <li><strong>Canada, Australia, New Zealand:</strong> 8 – 20 business days</li>
              <li><strong>Israel, Middle East:</strong> 12 – 30 business days</li>
              <li><strong>Asia, Latin America, Africa, Rest of World:</strong> 14 – 35 business days</li>
            </ul>
            <p style={{ margin: '12px 0 0 0', fontSize: '13px', opacity: 0.7 }}>
              Customs clearance can occasionally extend transit by a few additional business days.
            </p>
          </div>
        </section>

        {/* ── CJ DROPSHIPPING ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. Jewelry &amp; Accessories — CJ Dropshipping
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Chains, bracelets, earrings, and other hardware accessories are sourced from and fulfilled directly by CJ Dropshipping. Items are pre-manufactured and dispatched from the CJ warehouse after a short quality-check window.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '16px' }}>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px 0' }}>🔍 Processing</h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.85 }}>
                <strong>1 – 3 Business Days</strong><br />
                Quality check and dispatch from CJ Dropshipping warehouse.
              </p>
            </div>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px 0' }}>📦 Shipping</h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.85 }}>
                <strong>7 – 20 Business Days</strong><br />
                Economy shipping via CJ logistics network. Tracking number provided at dispatch.
              </p>
            </div>
          </div>
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '13px' }}>Total estimated delivery (processing + shipping):</p>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', opacity: 0.85, lineHeight: 1.8 }}>
              <li><strong>Israel:</strong> 10 – 20 business days</li>
              <li><strong>Europe:</strong> 12 – 22 business days</li>
              <li><strong>United States:</strong> 10 – 20 business days</li>
              <li><strong>Rest of World:</strong> 15 – 30 business days</li>
            </ul>
          </div>
        </section>

        {/* ── Shared sections ── */}
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. Shipping Rates &amp; Free Shipping
          </h2>
          <p style={{ margin: 0 }}>
            Shipping is calculated at checkout based on destination and order value. <strong>Free shipping</strong> applies to all orders with a cart subtotal of $249 or more.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. Tracking &amp; Dispatch Notifications
          </h2>
          <p style={{ margin: 0 }}>
            A tracking number is emailed once your parcel is registered with the carrier. Please allow up to 48 hours for the carrier system to show live updates. If no movement appears after 5 business days, contact us at <a href="mailto:support@dripstreetshop.com" style={{ color: 'var(--color-white)', textDecoration: 'underline' }}>support@dripstreetshop.com</a>.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. Customs, Taxes &amp; Imports
          </h2>
          <p style={{ margin: 0 }}>
            International orders may be subject to customs duties, import handling fees, or local VAT. These charges are outside Drip Street's control and are the sole responsibility of the customer.
          </p>
        </section>

      </div>
    </LegalPageLayout>
  );
}
