import { useState } from 'react';
import LegalPageLayout from '../components/LegalPageLayout';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com').replace(/\/$/, '');

export default function ContactUs() {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      setStatus('error');
      setFeedbackMsg('Please fill in all required fields.');
      return;
    }

    setStatus('loading');
    setFeedbackMsg('');

    try {
      const response = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          message: formData.message
        })
      });

      if (response.ok) {
        setStatus('success');
        setFormData({ name: '', email: '', message: '' });
        setFeedbackMsg('Thank you! Your message was sent successfully. We will reply to your email shortly.');
      } else {
        throw new Error('Server error');
      }
    } catch {
      setStatus('error');
      setFeedbackMsg('We couldn\'t send your message. Please try again or contact support@dripstreetshop.com directly.');
    }
  };

  return (
    <LegalPageLayout title="Contact Us" breadcrumb="Contact Us">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '50px' }}>
        
        {/* Info Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ color: 'var(--color-white)', fontSize: '20px', fontWeight: '700', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>
            Get In Touch
          </h2>
          <p style={{ margin: 0 }}>
            Have a question about order delivery, sizing fit, or custom configurations? Drop us a line. Our support crew or Meni (our helpful assistant) is available 24/7.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
            <div>
              <h4 style={{ color: 'var(--color-white)', margin: '0 0 4px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Support</h4>
              <p style={{ margin: 0 }}><a href="mailto:support@dripstreetshop.com" style={{ color: 'inherit', textDecoration: 'underline' }}>support@dripstreetshop.com</a></p>
            </div>
            <div>
              <h4 style={{ color: 'var(--color-white)', margin: '0 0 4px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fulfillment Center</h4>
              <p style={{ margin: 0 }}>Printify Partner Network, USA & Europe</p>
            </div>
            <div>
              <h4 style={{ color: 'var(--color-white)', margin: '0 0 4px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Response Time</h4>
              <p style={{ margin: 0 }}>Usually within 12 - 24 hours.</p>
            </div>
          </div>
        </div>

        {/* Form Column */}
        <div>
          <form className="contact-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="name" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-white)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                required
                placeholder="Enter your name"
                value={formData.name}
                onChange={handleChange}
                disabled={status === 'loading'}
                style={{
                  padding: '12px 16px',
                  background: 'var(--color-black-300)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--color-white)',
                  borderRadius: '6px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  minHeight: '44px'
                }}
                onFocus={(e) => e.target.style.borderColor = '#fff'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="email" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-white)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Address *</label>
              <input
                type="email"
                id="email"
                name="email"
                required
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                disabled={status === 'loading'}
                style={{
                  padding: '12px 16px',
                  background: 'var(--color-black-300)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--color-white)',
                  borderRadius: '6px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  minHeight: '44px'
                }}
                onFocus={(e) => e.target.style.borderColor = '#fff'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label htmlFor="message" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--color-white)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Message *</label>
              <textarea
                id="message"
                name="message"
                required
                placeholder="Type your message here..."
                value={formData.message}
                onChange={handleChange}
                disabled={status === 'loading'}
                style={{
                  padding: '12px 16px',
                  background: 'var(--color-black-300)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--color-white)',
                  borderRadius: '6px',
                  outline: 'none',
                  minHeight: '150px',
                  resize: 'vertical',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#fff'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {feedbackMsg && (
              <div 
                style={{
                  padding: '14px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  backgroundColor: status === 'success' ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)',
                  border: `1px solid ${status === 'success' ? '#4caf50' : '#f44336'}`,
                  color: status === 'success' ? '#81c784' : '#e57373'
                }}
              >
                {feedbackMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              style={{
                padding: '14px 28px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--color-white)',
                color: 'var(--color-black-500)',
                fontSize: '14px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                opacity: status === 'loading' ? 0.6 : 1,
                transition: 'opacity 0.2s',
                minHeight: '44px'
              }}
              onMouseEnter={(e) => { if(status !== 'loading') e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={(e) => { if(status !== 'loading') e.currentTarget.style.opacity = '1'; }}
            >
              {status === 'loading' ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>

      </div>
    </LegalPageLayout>
  );
}
