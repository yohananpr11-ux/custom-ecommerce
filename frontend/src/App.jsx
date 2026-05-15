import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './index.css'

function App() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('payplus')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeCoupon, setActiveCoupon] = useState(null)

  useEffect(() => {
    fetch('https://custom-ecommerce-qp30.onrender.com/api/products')
      .then(res => res.json())
      .then(data => setProducts(data))
      .catch(err => console.error("Failed to load products", err))
      
    // Listen for coupon updates
    fetch('https://custom-ecommerce-qp30.onrender.com/api/coupons/active')
      .then(res => res.json())
      .then(data => { if(data.coupon) setActiveCoupon(data.coupon) })
      .catch(console.error)
  }, [])

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

  const checkout = async () => {
    try {
      const endpoint = paymentMethod === 'stripe' ? '/api/checkout/stripe' : '/api/checkout/payplus';
      const response = await fetch(`https://custom-ecommerce-qp30.onrender.com${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Yohanan Premium',
          customerEmail: 'yohanan@example.com',
          address: 'Dizengoff 99, Tel Aviv',
          items: cart,
          totalAmount: cartTotal,
          couponCode: activeCoupon ? activeCoupon.code : null
        })
      });
      const data = await response.json();
      if (data.success && data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        alert('Checkout initialization failed.');
      }
    } catch (error) {
      alert('Checkout failed due to a network error.');
    }
  }

  const path = window.location.pathname;

  if (path === '/success') {
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

  return (
    <>
      <header className="header container">
        <h1 className="logo">DRIP STREET</h1>
        <div className="search-bar">
          <input 
            type="text" 
            placeholder="Search premium apparel..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="cart-btn" onClick={() => setIsCartOpen(true)}>
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
            {filteredProducts.map(product => (
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
                <button className="add-to-cart" onClick={() => addToCart(product)}>
                  Add to Cart
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </main>

      {/* Cart Drawer */}
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>Your Cart</h2>
          <button className="close-cart" onClick={() => setIsCartOpen(false)}>×</button>
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

          <button className="checkout-btn" onClick={checkout} disabled={cart.length === 0} style={{ opacity: cart.length === 0 ? 0.5 : 1 }}>
            Checkout with {paymentMethod === 'stripe' ? 'Stripe' : 'PayPlus'}
          </button>
        </div>
      </div>
    </>
  )
}

export default App
