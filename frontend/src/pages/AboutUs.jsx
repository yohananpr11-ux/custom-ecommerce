import React from 'react';
import LegalPageLayout from '../components/LegalPageLayout';

export default function AboutUs() {
  return (
    <LegalPageLayout title="About Us" breadcrumb="Our Story">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
        
        {/* Brand Philosophy */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 style={{ color: 'var(--color-white)', fontSize: '24px', fontWeight: '800', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>
            Built For Confidence
          </h2>
          <p style={{ margin: 0, fontSize: '18px', lineHeight: '1.7', color: 'var(--color-white)', opacity: 0.95 }}>
            Drip Street is a minimalist streetwear label born out of the desire to combine high-end aesthetic tailoring with maximum daily comfort. We believe that confidence starts with how you feel in what you wear.
          </p>
          <p style={{ margin: 0 }}>
            Every silhouette is carefully drafted, every hem measured, and every print executed with absolute precision. Our aesthetic represents the intersection of urban underground cultures and clean, high-fashion architectural design.
          </p>
        </section>

        {/* Visual Callout or Pillars */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '24px' }}>
          <div style={{ border: '1px solid var(--border-color)', padding: '30px 24px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>✏️</span>
            <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Minimalist Design</h3>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7, lineHeight: '1.6' }}>We strip away the noise. No heavy branding, no obnoxious taglines. Clean typography and subtle silhouettes that amplify your presence.</p>
          </div>
          <div style={{ border: '1px solid var(--border-color)', padding: '30px 24px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>🧵</span>
            <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Tailored Fitting</h3>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7, lineHeight: '1.6' }}>Standard fits aren't enough. Our hoodies feature drop shoulders and structured hoods. Our tees sit perfectly with double-needle hems.</p>
          </div>
          <div style={{ border: '1px solid var(--border-color)', padding: '30px 24px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>🌱</span>
            <h3 style={{ color: 'var(--color-white)', fontSize: '16px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Zero-Waste Printing</h3>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7, lineHeight: '1.6' }}>We refuse to print unsold stock that ends up in landfills. By producing on demand, we save thousands of gallons of water and textile waste.</p>
          </div>
        </section>

        {/* Narrative / Production Story */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '40px' }}>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>
            Our Production Cycle
          </h2>
          <p style={{ margin: 0 }}>
            Our garments are crafted from premium cotton blends, ethically sourced and manufactured. Designs are permanently printed using industrial-grade, eco-friendly inks that sink directly into the fibers rather than sitting on top, ensuring your prints remain crisp and fade-free wash after wash.
          </p>
          <p style={{ margin: 0 }}>
            By working with specialized print centers worldwide, we manage local fulfillment directly from sites closest to you, guaranteeing faster logistics tracking and a reduced carbon footprint.
          </p>
        </section>

        {/* Closing / CTA */}
        <section style={{ textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '40px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          <h3 style={{ color: 'var(--color-white)', fontSize: '18px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>
            Join the Street Movement
          </h3>
          <p style={{ margin: 0, maxWidth: '500px', fontSize: '14px', opacity: 0.8 }}>
            Explore our curated collections of premium hoodies, drop-shoulder tees, and comfort tank tops. Sign up for our newsletter below to be the first in line for our seasonal collections.
          </p>
        </section>

      </div>
    </LegalPageLayout>
  );
}
