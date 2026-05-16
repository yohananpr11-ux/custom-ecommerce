import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, errorInfo) {
    console.error("React Error:", error);
    fetch('https://custom-ecommerce-qp30.onrender.com/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'System', email: 'error@system', message: `Frontend Crash: ${error.message}` })
    }).catch(() => {});
  }
  render() {
    if (this.state.hasError) return <div className="container" style={{padding: '100px 20px', textAlign: 'center'}}><h1>Oops! Something broke.</h1><p>Our team has been notified.</p></div>;
    return this.props.children;
  }
}

function MainApp() {
  const [products, setProducts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('drip_street_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  })
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('payplus')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeCoupon, setActiveCoupon] = useState(null)

  useEffect(() => {
    fetch('https://custom-ecommerce-qp30.onrender.com/api/products')
      .then(res => res.json())
      .then(data => { setProducts(data); setIsLoading(false); })
      .catch(err => { console.error(err); setIsLoading(false); })
      
    // Listen for coupon updates
    fetch('https://custom-ecommerce-qp30.onrender.com/api/coupons/active')
      .then(res => res.json())
      .then(data => { if(data.coupon) setActiveCoupon(data.coupon) })
      .catch(console.error)
  }, [])

  // Sync cart to local storage
  useEffect(() => {
    try {
      localStorage.setItem('drip_street_cart', JSON.stringify(cart))
    } catch (e) {
      console.error('Failed to save cart:', e)
    }
  }, [cart])

  const categories = ['All', 'New Arrivals', 'Best Sellers', 'Hoodies', 'T-Shirts']

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory = activeCategory === 'All' 
        || (activeCategory === 'Hoodies' && p.title.toLowerCase().includes('hoodie'))
        || (activeCategory === 'T-Shirts' && p.title.toLowerCase().includes('tee'))
        || (activeCategory === 'Best Sellers' && p.type === 'local')
      return matchesSearch && matchesCategory
    })
  }, [products, searchQuery, activeCategory])

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id)
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
    } else {
      setCart([...cart, { ...product, quantity: 1 }])
    }
    setIsCartOpen(true)
  }

  const baseCartTotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0)
  const discount = activeCoupon ? baseCartTotal * (activeCoupon.discount_pct / 100) : 0
  const cartTotal = baseCartTotal - discount

  const proceedToCheckout = () => {
    setIsCartOpen(false);
    window.history.pushState({}, '', '/checkout');
    // We use a custom event or just a state if we had a router, but since we rely on window.location.pathname:
    window.dispatchEvent(new Event('popstate'));
  }

  const submitCheckout = async (e) => {
    e.preventDefault();
    try {
      const endpoint = paymentMethod === 'stripe' ? '/api/checkout/stripe' : '/api/checkout/payplus';
      const response = await fetch(`https://custom-ecommerce-qp30.onrender.com${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: e.target.customerName.value,
          customerEmail: e.target.customerEmail.value,
          address: e.target.address.value,
          items: cart,
          totalAmount: cartTotal,
          couponCode: activeCoupon ? activeCoupon.code : null
        })
      });
      const data = await response.json();
      if (data.success && data.paymentUrl) {
        localStorage.removeItem('drip_street_cart'); // clear cart on success
        window.location.href = data.paymentUrl;
      } else {
        alert('Checkout initialization failed.');
      }
    } catch (error) {
      alert('Checkout failed due to a network error.');
    }
  }

  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  useEffect(() => {
    const handleLocationChange = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  if (currentPath === '/success') {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '100px 20px' }}>
        <motion.h1 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ fontSize: '48px', marginBottom: '24px' }}>Payment Successful! 🎉</motion.h1>
        <p style={{ fontSize: '20px', color: '#888', marginBottom: '32px' }}>
          Thank you for your order. We're processing it now.
        </p>
        <button className="checkout-btn" style={{ maxWidth: '250px' }} onClick={() => window.location.href = '/'}>
          Return to Store
        </button>
      </div>
    );
  }

  if (currentPath === '/checkout') {
    return (
      <div className="container checkout-page">
        <h1 style={{ marginTop: '40px' }}>Secure Checkout</h1>
        <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', marginTop: '32px' }}>
          <form className="contact-form" onSubmit={submitCheckout} style={{ flex: '1', minWidth: '300px' }}>
            <h3>Shipping Details</h3>
            <input name="customerName" type="text" placeholder="Full Name" required />
            <input name="customerEmail" type="email" placeholder="Email Address" required />
            <input name="address" type="text" placeholder="Full Address (Street, City, Zip)" required />
            
            <h3 style={{ marginTop: '24px' }}>Payment Method</h3>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="payplus" checked={paymentMethod === 'payplus'} onChange={() => setPaymentMethod('payplus')} />
                Credit Card / Bit (₪)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} />
                Stripe ($)
              </label>
            </div>
            <button type="submit" className="checkout-btn">Complete Order</button>
          </form>
          
          <div style={{ flex: '1', minWidth: '300px', backgroundColor: '#111', padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
            <h3>Order Summary</h3>
            {cart.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span>{item.quantity}x {item.title}</span>
                <span>₪{(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
            <hr style={{ borderColor: '#333', margin: '16px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '18px' }}>
              <span>Total</span>
              <span>₪{cartTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentPath === '/contact') {
    return (
      <div className="container legal-page">
        <h1>Contact Us</h1>
        <form className="contact-form" onSubmit={(e) => {
          e.preventDefault();
          fetch('https://custom-ecommerce-qp30.onrender.com/api/contact', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: e.target.name.value, email: e.target.email.value, message: e.target.message.value })
          }).then(() => { alert('Message sent to support.'); window.location.href='/'; })
        }}>
          <input name="name" type="text" placeholder="Your Name" required />
          <input name="email" type="email" placeholder="Your Email" required />
          <textarea name="message" placeholder="How can we help?" required></textarea>
          <button type="submit" className="checkout-btn">Send Message</button>
        </form>
      </div>
    );
  }

  if (currentPath === '/privacy' || currentPath === '/terms' || currentPath === '/refund') {
    const title = currentPath.substring(1).replace(/^\w/, c => c.toUpperCase()) + " Policy";
    return (
      <div className="container legal-page" style={{ maxWidth: '800px', marginTop: '40px' }}>
        <h1>{title}</h1>
        <p style={{ lineHeight: '1.8', color: '#ccc' }}>
          This is a legally binding document generated for Drip Street. By using this service, you agree to our policies.
          <br/><br/>
          <strong>1. Information We Collect</strong><br/>
          We collect information you provide directly to us when you make a purchase.
          <br/><br/>
          <strong>2. Processing Payments</strong><br/>
          Payments are processed securely via Stripe and PayPlus. We do not store your credit card information.
          <br/><br/>
          <strong>3. Returns & Refunds</strong><br/>
          Due to the nature of our products, returns are accepted within 14 days of delivery if the item is unworn.
        </p>
        <button className="checkout-btn" style={{ maxWidth: '200px', marginTop: '40px' }} onClick={() => window.location.href = '/'}>Back</button>
      </div>
    );
  }

  if (currentPath !== '/' && currentPath !== '/cart') {
    return <div className="container legal-page" style={{textAlign: 'center'}}><h1>404 Not Found</h1><button className="checkout-btn" style={{ maxWidth: '200px' }} onClick={() => window.location.href = '/'}>Return Home</button></div>;
  }

  return (
    <>
      <header className="header container">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}><h1 className="logo">DRIP STREET</h1></a>
        <div className="search-bar">
          <input 
            type="text" 
            placeholder="Search premium apparel..." 
            value={searchQuery}
            aria-label="Search products"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="cart-btn" aria-label="Open cart" onClick={() => setIsCartOpen(true)}>
          CART ({cart.length})
        </button>
      </header>

      {activeCoupon && (
        <motion.div 
          initial={{ y: -50 }} animate={{ y: 0 }} 
          className="promo-banner"
        >
          Flash Sale! Use code <b>{activeCoupon.code}</b> for {activeCoupon.discount_pct}% off. Ends soon.
        </motion.div>
      )}

      <section className="hero">
        <div className="container">
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>ELEVATE YOUR STYLE</motion.h1>
          <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
            Premium streetwear crafted for the modern individual. Designed locally, made to last.
          </motion.p>
        </div>
      </section>

      <main className="container">
        <div className="categories-nav">
          {categories.map(cat => (
            <button 
              key={cat} 
              className={`cat-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <motion.div layout className="products-grid">
          <AnimatePresence>
            {isLoading ? (
              Array.from({length: 4}).map((_, i) => (
                <div key={`skel-${i}`} className="product-card skeleton-card">
                  <div className="skeleton skeleton-image"></div>
                  <div style={{ marginTop: '16px' }}>
                    <div className="skeleton skeleton-text"></div>
                    <div className="skeleton skeleton-text" style={{ width: '40%' }}></div>
                  </div>
                </div>
              ))
            ) : (
              filteredProducts.map(product => (
                <motion.div 
                  key={product.id} 
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                  className="product-card"
                >
                  <img loading="lazy" src={product.imageUrl} alt={product.title} className="product-image" />
                  <div className="product-info">
                    <h3 className="product-title">{product.title}</h3>
                    <span className="product-price">₪{product.price.toFixed(2)}</span>
                  </div>
                  <p className="product-desc">{product.description}</p>
                  <button className="add-to-cart" aria-label={`Add ${product.title} to cart`} onClick={() => addToCart(product)}>
                    Add to Cart
                  </button>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      <footer className="footer container">
        <div className="payment-logos">
          <span>VISA</span> • <span>MASTERCARD</span> • <span>BIT</span>
        </div>
        <div className="footer-links">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/refund">Refund Policy</a>
          <a href="/contact">Contact Support</a>
        </div>
        <p>© 2026 Drip Street. All rights reserved.</p>
      </footer>

      {/* Cart Drawer */}
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>Your Cart</h2>
          <button className="close-cart" aria-label="Close cart" onClick={() => setIsCartOpen(false)}>×</button>
        </div>
        <div className="cart-items">
          {cart.map(item => (
            <div key={item.id} className="cart-item">
              <div>
                <strong>{item.title}</strong>
                <div>Qty: {item.quantity}</div>
              </div>
              <div>₪{(item.price * item.quantity).toFixed(2)}</div>
            </div>
          ))}
          {cart.length === 0 && <p style={{color: '#666'}}>Your cart is empty.</p>}
        </div>
        <div className="cart-footer">
          {activeCoupon && (
            <div className="cart-discount">
              <span>Discount ({activeCoupon.code})</span>
              <span style={{ color: '#4caf50' }}>-₪{discount.toFixed(2)}</span>
            </div>
          )}
          <div className="cart-total">
            <span>Total</span>
            <span>₪{cartTotal.toFixed(2)} {paymentMethod === 'stripe' && `(~$${(cartTotal / 3.7).toFixed(2)})`}</span>
          </div>
          
          <div style={{ marginTop: '16px', marginBottom: '16px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#888' }}>Pay with:</p>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="payplus" checked={paymentMethod === 'payplus'} onChange={() => setPaymentMethod('payplus')} />
                Credit Card / Bit (₪)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} />
                Stripe ($)
              </label>
            </div>
          </div>

          <button className="checkout-btn" onClick={proceedToCheckout} disabled={cart.length === 0} style={{ opacity: cart.length === 0 ? 0.5 : 1 }}>
            Proceed to Checkout
          </button>
        </div>
      </div>
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  )
}
