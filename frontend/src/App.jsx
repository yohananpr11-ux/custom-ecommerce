import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './index.css'

const API_BASE = 'https://custom-ecommerce-qp30.onrender.com';
const SHIPPING_COST = 29.90;
const FREE_SHIPPING_THRESHOLD = 5;
const BUNDLE_TEE_PRICE = 229; // 3 tees for 229₪
const BUNDLE_TEE_COUNT = 3;

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, errorInfo) {
    console.error("React Error:", error);
    fetch(`${API_BASE}/api/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'System', email: 'error@system', message: `Frontend Crash: ${error.message}` })
    }).catch(() => {});
  }
  render() {
    if (this.state.hasError) return <div className="container" style={{padding: '100px 20px', textAlign: 'center'}}><h1>Oops! Something broke.</h1><p>Our team has been notified.</p></div>;
    return this.props.children;
  }
}

/** Check if a product is a tee (not hoodie) */
function isTeeProduct(product) {
  const t = product.title.toLowerCase();
  return (t.includes('tee') || t.includes('t-shirt') || t.includes('shirt')) && !t.includes('hoodie') && !t.includes('sweatshirt');
}

function ProductDetailPage({ productId, addToCart }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [activeTab, setActiveTab] = useState('');

  useEffect(() => {
    window.scrollTo(0, 0);
    fetch(`${API_BASE}/api/products/${productId}`)
      .then(res => res.json())
      .then(data => {
        setProduct(data);
        if (data.colors && data.colors.length > 0) setSelectedColor(data.colors[0].name);
        if (data.sizes && data.sizes.length > 0) setSelectedSize(data.sizes[0]);
        setLoading(false);
      })
      .catch(console.error);
  }, [productId]);

  if (loading) return <div className="container" style={{padding: '100px 0', textAlign: 'center'}}>Loading...</div>;
  if (!product) return <div className="container" style={{padding: '100px 0', textAlign: 'center'}}>Product not found</div>;

  const handleAdd = () => {
    let variantId = null;
    if (product.variants && product.variants.length > 0) {
      const v = product.variants.find(v => v.color === selectedColor && v.size === selectedSize);
      if (v) variantId = v.id;
    }
    
    // We modify the product title to include variant info in cart
    const variantTitle = [product.title];
    if (selectedColor) variantTitle.push(selectedColor);
    if (selectedSize) variantTitle.push(selectedSize);
    
    addToCart({
      ...product,
      title: variantTitle.join(' - '),
      cartId: `${product.id}-${selectedColor}-${selectedSize}`, // Unique ID for cart grouping
      selectedColor,
      selectedSize,
      variantId
    });
  };

  return (
    <>
      <header className="header container">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">DRIP STREET</h1></a>
        <button className="cart-btn" aria-label="Open cart" onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))}>
          🛒 CART
        </button>
      </header>
      <div className="container pdp-container">
        <div className="pdp-images">
          {product.images && product.images.length > 0 ? (
            product.images.map((img, i) => (
              <img key={i} src={img.src || img} alt={`${product.title} view ${i}`} className="pdp-image" />
            ))
          ) : (
            <img src={product.imageUrl} alt={product.title} className="pdp-image" />
          )}
        </div>
        
        <div className="pdp-info-wrapper">
          <div className="pdp-info">
            <h1>{product.title}</h1>
            <div className="pdp-price">₪{product.price.toFixed(2)}</div>
            
            {product.colors && product.colors.length > 0 && (
              <div className="pdp-section">
                <h3>Color: <span style={{fontWeight:'normal', color:'#aaa'}}>{selectedColor}</span></h3>
                <div className="pdp-options">
                  {product.colors.map(c => (
                    <button 
                      key={c.name}
                      className={`color-btn ${selectedColor === c.name ? 'active' : ''}`}
                      style={{ backgroundColor: c.hex }}
                      onClick={() => setSelectedColor(c.name)}
                      aria-label={`Select color ${c.name}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {product.sizes && product.sizes.length > 0 && (
              <div className="pdp-section">
                <h3>Size: <span style={{fontWeight:'normal', color:'#aaa'}}>{selectedSize}</span></h3>
                <div className="pdp-options">
                  {product.sizes.map(s => (
                    <button 
                      key={s}
                      className={`size-btn ${selectedSize === s ? 'active' : ''}`}
                      onClick={() => setSelectedSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button className="checkout-btn add-to-cart-large" onClick={handleAdd}>
              ADD TO CART
            </button>

            <p className="pdp-desc">{product.description}</p>

            <div className="pdp-accordion">
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'fabric' ? '' : 'fabric')}>
                  Fabric & Fit <span>{activeTab === 'fabric' ? '−' : '+'}</span>
                </button>
                {activeTab === 'fabric' && <div className="accordion-content">{product.fabric || 'Premium materials.'}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'care' ? '' : 'care')}>
                  Care Instructions <span>{activeTab === 'care' ? '−' : '+'}</span>
                </button>
                {activeTab === 'care' && <div className="accordion-content">{product.careInstructions || 'Machine wash cold.'}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'delivery' ? '' : 'delivery')}>
                  Delivery Info <span>{activeTab === 'delivery' ? '−' : '+'}</span>
                </button>
                {activeTab === 'delivery' && <div className="accordion-content">{product.deliveryInfo || 'Standard delivery.'}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
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
    fetch(`${API_BASE}/api/products`)
      .then(res => res.json())
      .then(data => { setProducts(data); setIsLoading(false); })
      .catch(err => { console.error(err); setIsLoading(false); })
      
    fetch(`${API_BASE}/api/coupons/active`)
      .then(res => res.json())
      .then(data => { if(data.coupon) setActiveCoupon(data.coupon) })
      .catch(console.error)
  }, [])

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
        || (activeCategory === 'Hoodies' && (p.title.toLowerCase().includes('hoodie') || p.title.toLowerCase().includes('sweatshirt')))
        || (activeCategory === 'T-Shirts' && isTeeProduct(p))
        || (activeCategory === 'Best Sellers' && p.type === 'local')
        || (activeCategory === 'New Arrivals' && p.type === 'printify')
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

  const removeFromCart = (productId) => {
    setCart(cart.filter(item => item.id !== productId))
  }

  const updateQuantity = (productId, newQty) => {
    if (newQty <= 0) return removeFromCart(productId);
    setCart(cart.map(item => item.id === productId ? { ...item, quantity: newQty } : item))
  }

  // ============ PRICING LOGIC ============
  
  // Count total items in cart
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  // Count tee items for bundle deal
  const teeItemsCount = cart
    .filter(item => isTeeProduct(item))
    .reduce((sum, item) => sum + item.quantity, 0);
  
  // Calculate base subtotal (before promotions)
  const baseSubtotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  
  // Calculate bundle discount: "3 tees for 229₪"
  const bundleSets = Math.floor(teeItemsCount / BUNDLE_TEE_COUNT);
  let bundleDiscount = 0;
  if (bundleSets > 0) {
    // Get tee items sorted by price descending (discount the most expensive ones first)
    const teeItems = cart.filter(item => isTeeProduct(item));
    const teePrices = [];
    teeItems.forEach(item => {
      for (let i = 0; i < item.quantity; i++) teePrices.push(item.price);
    });
    teePrices.sort((a, b) => b - a);
    
    const teesInBundle = bundleSets * BUNDLE_TEE_COUNT;
    const originalBundleTotal = teePrices.slice(0, teesInBundle).reduce((s, p) => s + p, 0);
    bundleDiscount = originalBundleTotal - (bundleSets * BUNDLE_TEE_PRICE);
    if (bundleDiscount < 0) bundleDiscount = 0;
  }
  
  // Coupon discount
  const couponDiscount = activeCoupon ? (baseSubtotal - bundleDiscount) * (activeCoupon.discount_pct / 100) : 0;
  
  // Shipping
  const isFreeShipping = totalItems >= FREE_SHIPPING_THRESHOLD;
  const shippingCost = isFreeShipping ? 0 : (totalItems > 0 ? SHIPPING_COST : 0);
  const itemsToFreeShipping = FREE_SHIPPING_THRESHOLD - totalItems;
  
  // Final total
  const subtotalAfterDiscounts = baseSubtotal - bundleDiscount - couponDiscount;
  const cartTotal = subtotalAfterDiscounts + shippingCost;

  // ============ NAVIGATION ============

  const proceedToCheckout = () => {
    setIsCartOpen(false);
    window.history.pushState({}, '', '/checkout');
    window.dispatchEvent(new Event('popstate'));
  }

  const submitCheckout = async (e) => {
    e.preventDefault();
    try {
      const endpoint = paymentMethod === 'stripe' ? '/api/checkout/stripe' : '/api/checkout/payplus';
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: e.target.customerName.value,
          customerEmail: e.target.customerEmail.value,
          address: e.target.address.value,
          items: cart,
          totalAmount: cartTotal,
          shippingCost: shippingCost,
          bundleDiscount: bundleDiscount,
          couponCode: activeCoupon ? activeCoupon.code : null
        })
      });
      const data = await response.json();
      if (data.success && data.paymentUrl) {
        localStorage.removeItem('drip_street_cart');
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

  // ============ ROUTE: SUCCESS ============
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

  // ============ ROUTE: CHECKOUT ============
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
            <button type="submit" className="checkout-btn">Complete Order – ₪{cartTotal.toFixed(2)}</button>
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
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#aaa' }}>
              <span>Subtotal</span>
              <span>₪{baseSubtotal.toFixed(2)}</span>
            </div>

            {bundleDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#4caf50' }}>
                <span>🎁 Bundle Deal ({bundleSets}x3 Tees)</span>
                <span>-₪{bundleDiscount.toFixed(2)}</span>
              </div>
            )}

            {couponDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#4caf50' }}>
                <span>Coupon ({activeCoupon.code})</span>
                <span>-₪{couponDiscount.toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: isFreeShipping ? '#4caf50' : '#aaa' }}>
              <span>Shipping {isFreeShipping && '🎉'}</span>
              <span>{isFreeShipping ? 'FREE' : `₪${shippingCost.toFixed(2)}`}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '10px', color: '#666' }}>
              <span>VAT (Osek Patur)</span>
              <span>₪0.00</span>
            </div>

            <hr style={{ borderColor: '#333', margin: '16px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '20px' }}>
              <span>Total</span>
              <span>₪{cartTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ ROUTE: CONTACT ============
  if (currentPath === '/contact') {
    return (
      <div className="container legal-page">
        <h1>Contact Us</h1>
        <form className="contact-form" onSubmit={(e) => {
          e.preventDefault();
          fetch(`${API_BASE}/api/contact`, {
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

  // ============ ROUTE: LEGAL PAGES ============
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

  // ============ ROUTE: 404 ============
  if (currentPath !== '/' && currentPath !== '/cart') {
    return <div className="container legal-page" style={{textAlign: 'center'}}><h1>404 Not Found</h1><button className="checkout-btn" style={{ maxWidth: '200px' }} onClick={() => window.location.href = '/'}>Return Home</button></div>;
  }

  // ============ ROUTE: PRODUCT DETAIL PAGE ============
  if (currentPath.startsWith('/product/')) {
    const productId = currentPath.split('/')[2];
    return <ProductDetailPage productId={productId} addToCart={addToCart} />;
  }

  // ============ MAIN STORE PAGE ============
  return (
    <>
      {/* Announcement Bar */}
      <div className="announcement-bar">
        🔥 משלוח חינם בקניית 5 פריטים ומעלה! &nbsp;|&nbsp; 3 טי-שירטס ב-229₪ בלבד
      </div>

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
          🛒 CART ({totalItems})
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
                  <div 
                    className="product-image-wrapper" 
                    onClick={() => { window.history.pushState({}, '', `/product/${product.id}`); window.dispatchEvent(new Event('popstate')); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <img loading="lazy" src={product.imageUrl} alt={product.title} className="product-image front-img" />
                    {product.backImageUrl && (
                      <img loading="lazy" src={product.backImageUrl} alt={`${product.title} back`} className="product-image back-img" />
                    )}
                    {isTeeProduct(product) && (
                      <span className="deal-badge">3 ב-229₪</span>
                    )}
                  </div>
                  <div className="product-info">
                    <h3 
                      className="product-title" 
                      onClick={() => { window.history.pushState({}, '', `/product/${product.id}`); window.dispatchEvent(new Event('popstate')); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {product.title}
                    </h3>
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
          <h2>Your Cart ({totalItems})</h2>
          <button className="close-cart" aria-label="Close cart" onClick={() => setIsCartOpen(false)}>×</button>
        </div>

        {/* Free Shipping Progress Bar */}
        {totalItems > 0 && (
          <div className="shipping-progress">
            {isFreeShipping ? (
              <p className="shipping-unlocked">🎉 משלוח חינם! You've unlocked free shipping</p>
            ) : (
              <>
                <p className="shipping-hint">הוסף עוד {itemsToFreeShipping} פריט{itemsToFreeShipping > 1 ? 'ים' : ''} למשלוח חינם!</p>
                <div className="progress-bar-bg">
                  <motion.div 
                    className="progress-bar-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${(totalItems / FREE_SHIPPING_THRESHOLD) * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="cart-items">
          {cart.map(item => (
            <div key={item.id} className="cart-item">
              <div style={{ flex: 1 }}>
                <strong>{item.title}</strong>
                {isTeeProduct(item) && <span className="cart-deal-hint">3 ב-229₪</span>}
                <div className="cart-qty-controls">
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)}>−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
                  <button className="remove-btn" onClick={() => removeFromCart(item.id)}>🗑</button>
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>₪{(item.price * item.quantity).toFixed(2)}</div>
            </div>
          ))}
          {cart.length === 0 && <p style={{color: '#666', textAlign: 'center', marginTop: '40px'}}>Your cart is empty.</p>}
        </div>

        <div className="cart-footer">
          {bundleDiscount > 0 && (
            <div className="cart-savings-line">
              <span>🎁 Bundle Deal ({bundleSets}x3 Tees)</span>
              <span style={{ color: '#4caf50' }}>-₪{bundleDiscount.toFixed(2)}</span>
            </div>
          )}

          {couponDiscount > 0 && (
            <div className="cart-savings-line">
              <span>Coupon ({activeCoupon.code})</span>
              <span style={{ color: '#4caf50' }}>-₪{couponDiscount.toFixed(2)}</span>
            </div>
          )}

          <div className="cart-savings-line">
            <span>Shipping</span>
            <span style={{ color: isFreeShipping ? '#4caf50' : '#aaa' }}>{isFreeShipping ? 'FREE' : `₪${shippingCost.toFixed(2)}`}</span>
          </div>

          <div className="cart-total">
            <span>Total</span>
            <span>₪{cartTotal.toFixed(2)}</span>
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
