import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function LegalPageLayout({ title, children, breadcrumb = 'Legal' }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = `${title} - Drip Street Shop`;
  }, [title]);

  return (
    <div className="container legal-page" style={{ maxWidth: '900px', marginTop: '40px', paddingBottom: '60px' }}>
      <div className="legal-breadcrumb" style={{ fontSize: '13px', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '24px', opacity: 0.6 }}>
        <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>Home</Link>
        <span className="breadcrumb-separator" style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--color-white)' }}>{breadcrumb}</span>
      </div>
      
      <header className="legal-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '40px', fontWeight: '800', letterSpacing: '-0.02em', textTransform: 'uppercase', margin: '0 0 8px 0' }}>{title}</h1>
        <p className="legal-updated" style={{ fontSize: '12px', opacity: 0.5, margin: 0 }}>Last updated: May 20, 2026</p>
      </header>

      <div className="legal-content-body" style={{ color: 'var(--color-text-tertiary-gray)', fontSize: '16px', lineHeight: '1.8' }}>
        {children}
      </div>
    </div>
  );
}
