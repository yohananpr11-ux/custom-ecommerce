import React from 'react';
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
                <strong>7 - 14 Business Days</strong><br/>
                Logistics carriers (DHL, FedEx, UPS) process and transport the parcel to your delivery destination.
              </p>
            </div>
          </div>
          <p style={{ margin: 0 }}>
            On average, most streetwear purchases arrive within 9-16 calendar days from the initial transaction window.
          </p>
        </section>

        <section>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
            3. Shipping Rates & Discounts
          </h2>
          <p style={{ margin: 0 }}>
            Standard tracked delivery is flat-rated at **$8.30** (converted dynamically from our operational base cost) for single-item purchases. We provide **FREE SHIPPING** on all orders containing 5 or more items in the shopping cart.
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
