import LegalPageLayout from '../components/LegalPageLayout';

export default function ShippingPolicy() {
  return (
    <LegalPageLayout title="Shipping Policy" breadcrumb="Shipping Policy">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            1. Print-On-Demand Operations
          </h2>
          <p style={{ margin: 0 }}>
            Every product in Drip Street is made-to-order. Instead of storing massive inventories of cheap pre-manufactured garments, we design each piece and manufacture it only when you order. This minimizes waste and carbon footprint while guaranteeing high prints and fresh garments.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            2. Production & Shipping Windows
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Your delivery cycle is split into two phases:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '16px' }}>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', margin: '0 0 10px 0' }}>
                ⚙️ Phase 1: Production
              </h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
                <strong>2 - 5 Business Days</strong><br/>
                We print your unique designs, carry out manual inspections, and package the apparel at our partner facility.
              </p>
            </div>
            <div style={{ border: '1px solid var(--border-color)', padding: '20px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.01)' }}>
              <h3 style={{ color: 'var(--color-white)', fontSize: '15px', fontWeight: '700', textTransform: 'uppercase', margin: '0 0 10px 0' }}>
                📦 Phase 2: Shipping
              </h3>
              <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
                <strong>Varies by destination</strong><br/>
                Logistics carriers (DHL, FedEx, UPS, USPS, local post) process and transport the parcel. Transit time depends on your country.
              </p>
            </div>
          </div>
          <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '13px' }}>Typical total delivery (production + shipping):</p>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', opacity: 0.85, lineHeight: 1.8 }}>
              <li><strong>United States:</strong> 6 – 14 business days</li>
              <li><strong>European Union & UK:</strong> 8 – 17 business days</li>
              <li><strong>Canada, Australia, New Zealand:</strong> 8 – 20 business days</li>
              <li><strong>Israel, Middle East:</strong> 12 – 30 business days</li>
              <li><strong>Asia, Latin America, Africa, Rest of World:</strong> 14 – 35 business days</li>
            </ul>
            <p style={{ margin: '12px 0 0 0', fontSize: '13px', opacity: 0.7 }}>
              These are realistic estimates from our print partner. Customs clearance for international orders can occasionally extend transit by a few additional business days.
            </p>
          </div>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. Shipping Rates & Discounts
          </h2>
          <p style={{ margin: 0 }}>
            Shipping is calculated at checkout based on your destination and order value. We provide <strong>FREE SHIPPING</strong> on orders with a cart subtotal of $249 or more.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            4. Real-time Tracking & Dispatch Notes
          </h2>
          <p style={{ margin: 0 }}>
            Once the manufacturing cycle is complete and the carrier registers the package, you will receive an automated email notification containing a tracking number and portal link. Please allow up to 48 hours for the carrier system to refresh tracking coordinates.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            5. Customs, Taxes & Imports
          </h2>
          <p style={{ margin: 0 }}>
            Depending on your local region, packages may be subject to customs duties, import handling costs, or local VAT/Taxes. Drip Street has no control over these external regulatory fees; they are the sole responsibility of the customer.
          </p>
        </section>
      </div>
    </LegalPageLayout>
  );
}
