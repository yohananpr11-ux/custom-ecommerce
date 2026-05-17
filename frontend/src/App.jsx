import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './index.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com').replace(/\/$/, '');
const SHIPPING_COST = 29.90;
const FREE_SHIPPING_THRESHOLD = 5;
const BUNDLE_TEE_PRICE = 229; // 3 tees for 229₪
const BUNDLE_TEE_COUNT = 3;

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) {
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

const translations = {
  he: {
    logo: "DRIP STREET",
    announcement: "משלוח חינם בקניית 5 פריטים ומעלה | מארז 3 חולצות ב-229 ₪",
    search_placeholder: "חפש פריטים...",
    cart: "סל קניות",
    hero_title: "ELEVATE YOUR STYLE",
    hero_subtitle: "השילוב המדויק בין נוחות חסרת פשרות לעיצוב נקי. פריטי חובה לכל ארון.",
    add_to_cart: "הוסף לסל",
    all: "הכל",
    new_arrivals: "חדש",
    best_sellers: "הנמכרים ביותר",
    hoodies: "קפוצ'ונים",
    tshirts: "טי-שירטס",
    fabric_fit: "חומר וגזרה",
    care_instructions: "טיפול",
    delivery_info: "משלוח",
    checkout: "קופה",
    checkout_secure: "קופה מאובטחת",
    shipping_details: "פרטי משלוח",
    full_name: "שם מלא",
    email: "דוא'ל",
    address: "כתובת (רחוב, עיר, מיקוד)",
    payment_method: "בחר תשלום",
    payment_card_bit: "כרטיס אשראי / Bit",
    payment_stripe: "PayPal / Stripe",
    order_summary: "סיכום הזמנה",
    subtotal: "סכום",
    bundle_deal: "🎁 3 טי-שירטס",
    shipping: "משלוח",
    free: "חינם",
    vat: "סה'כ",
    total: "לתשלום",
    complete_order: "בצע הזמנה",
    success_title: "🎉 התשלום בוצע!",
    success_desc: "תודה! ההזמנה שלך מעובדת ועל הדרך אליך.",
    return_home: "חזרה לחנות",
    shipping_unlocked: "🎉 משלוח חינם!",
    shipping_hint: "עוד {count} פריטים למשלוח חינם",
    cart_empty: "הסל ריק",
    support_chat: "מני 🤖",
    support_placeholder: "שאלה? מני כאן בשבילך!",
    escalated_msg: "מחובר לנציג - תשובה בדקות"
  },
  en: {
    logo: "DRIP STREET",
    announcement: "Complimentary shipping on 5+ items | 3-Tee Bundle for 229 ₪",
    search_placeholder: "Search items...",
    cart: "Cart",
    hero_title: "ELEVATE YOUR STYLE",
    hero_subtitle: "Uncompromising comfort meets clean design. Essential everyday wear.",
    add_to_cart: "Add to Cart",
    all: "All",
    new_arrivals: "New Arrivals",
    best_sellers: "Best Sellers",
    hoodies: "Hoodies",
    tshirts: "T-Shirts",
    fabric_fit: "Fabric & Fit",
    care_instructions: "Care Instructions",
    delivery_info: "Delivery Info",
    checkout: "Checkout",
    checkout_secure: "Secure Checkout",
    shipping_details: "Shipping Details",
    full_name: "Full Name",
    email: "Email Address",
    address: "Full Address (Street, City, Zip)",
    payment_method: "Payment Method",
    payment_card_bit: "Credit Card / Bit (₪)",
    payment_stripe: "Stripe ($)",
    order_summary: "Order Summary",
    subtotal: "Subtotal",
    bundle_deal: "🎁 Bundle Deal (3 Tees)",
    shipping: "Shipping",
    free: "FREE",
    vat: "VAT (0% - Osek Patur)",
    total: "Total",
    complete_order: "Complete Order",
    success_title: "Payment Successful! 🎉",
    success_desc: "Thank you for your order. We are processing it now.",
    return_home: "Return to Store",
    shipping_unlocked: "🎉 You've unlocked free shipping",
    shipping_hint: "Add {count} more item{plural} for free shipping!",
    cart_empty: "Your cart is empty",
    support_chat: "Chat with Meni 🤖",
    support_placeholder: "Ask Meni about sizes, care, or delivery...",
    escalated_msg: "Escalated to human support. We will reply to your chat shortly."
  }
};

/** Product title translations from Printify defaults to Hebrew */
const productTitleMap = {
  'Unisex Softstyle T-Shirt': 'טי-שירט יוניסקס בייסיק',
  'Unisex Jersey Short Sleeve Tee': 'טי-שירט פרימיום',
  'Unisex Heavy Blend™ Hooded Sweatshirt': 'קפוצ\'ון אוברסייז קלאסי',
  'Gildan 64000': 'טי-שירט Gildan',
  'Bella+Canvas 3001': 'טי-שירט Bella+Canvas',
  'Gildan 18500': 'קפוצ\'ון Gildan',
  'Drum Machine Blueprint': 'טי-שירט Blueprint',
  'Retro Synth': 'טי-שירט Synth ריטרו',
  'Circuit Board': 'טי-שירט Circuit Board',
  'Minimal Grid': 'טי-שירט מינימליסטי',
};

function getProductTitle(title, locale) {
  if (locale === 'he' && productTitleMap[title]) {
    return productTitleMap[title];
  }
  return title;
}

/** Check if a product is a tee (not hoodie) */
function isTeeProduct(product) {
  const t = product.title.toLowerCase();
  return (t.includes('tee') || t.includes('t-shirt') || t.includes('shirt')) && !t.includes('hoodie') && !t.includes('sweatshirt');
}

const BLACK_COLOR_OVERRIDES = {
  '1': {
    black: {
      image: '/shirt-black-design.png',
      hex: '#111111'
    }
  },
  '2': {
    black: {
      image: '/shirt-black-white-logo.png',
      hex: '#111111'
    }
  }
};

function applyProductColorOverrides(productData, productId) {
  if (!productData) return productData;

  const override = BLACK_COLOR_OVERRIDES[String(productId)];
  if (!override) return productData;

  const next = { ...productData };
  const colors = Array.isArray(next.colors) ? [...next.colors] : [];
  const imagesByColor = { ...(next.imagesByColor || {}) };

  Object.entries(override).forEach(([colorName, colorOverride]) => {
    const normalizedColorName = String(colorName).toLowerCase();
    const existingColorIndex = colors.findIndex((c) => String(c.name || '').toLowerCase() === normalizedColorName);

    if (existingColorIndex === -1) {
      colors.push({
        name: colorName,
        hex: colorOverride.hex || '#111111'
      });
    } else {
      colors[existingColorIndex] = {
        ...colors[existingColorIndex],
        hex: colors[existingColorIndex].hex || colorOverride.hex || '#111111'
      };
    }

    imagesByColor[colorName] = [{ src: colorOverride.image, position: 'front' }];
  });

  next.colors = colors;
  next.imagesByColor = imagesByColor;

  return next;
}

function ProductDetailPage({ productId, addToCart, t, currency, curSym, locale }) {
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
        // Build imagesByColor mapping from variants and images
        if (data.variants && data.images) {
          const imagesByColor = {};
          const variantIdToColor = {};
          
          // Map variant IDs to colors
          data.variants.forEach(v => {
            variantIdToColor[v.printifyVariantId] = v.color;
          });
          
          // Group images by variant ID (extracted from URL path)
          const imagesByVariantId = {};
          data.images.forEach(img => {
            const variantMatch = img.src.match(/\/mockup\/[^/]+\/(\d+)\//);
            if (variantMatch) {
              const variantId = variantMatch[1];
              if (!imagesByVariantId[variantId]) imagesByVariantId[variantId] = [];
              imagesByVariantId[variantId].push(img);
            }
          });
          
          // Map images to colors
          Object.entries(imagesByVariantId).forEach(([variantId, images]) => {
            const color = variantIdToColor[variantId];
            if (color && !imagesByColor[color]) {
              imagesByColor[color] = images;
            }
          });
          
          data.imagesByColor = imagesByColor;
        }

        const productWithOverrides = applyProductColorOverrides(data, productId);
        setProduct(productWithOverrides);
        
        // Select first non-black color
        if (productWithOverrides.colors && productWithOverrides.colors.length > 0) {
          const nonBlackColor = productWithOverrides.colors.find(c => c.name.toLowerCase() !== 'black');
          setSelectedColor(nonBlackColor ? nonBlackColor.name : productWithOverrides.colors[0].name);
        }
        if (productWithOverrides.sizes && productWithOverrides.sizes.length > 0) setSelectedSize(productWithOverrides.sizes[0]);
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
    
    const variantTitle = [product.title];
    if (selectedColor) variantTitle.push(selectedColor);
    if (selectedSize) variantTitle.push(selectedSize);
    
    addToCart({
      ...product,
      title: variantTitle.join(' - '),
      cartId: `${product.id}-${selectedColor}-${selectedSize}`,
      selectedColor,
      selectedSize,
      variantId
    });
  };

  const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / 3.75)) : product.price;

  return (
    <>
      <header className="header container">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        <button className="cart-btn" aria-label="Open cart" onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))}>
          🛒 {t('cart')}
        </button>
      </header>
      <div className="container pdp-container">
        <div className="pdp-images">
          {product.imagesByColor && product.imagesByColor[selectedColor] && product.imagesByColor[selectedColor].length > 0 ? (
            product.imagesByColor[selectedColor].map((img, i) => (
              <img key={i} src={img.src || img} alt={`${product.title} view ${i}`} className="pdp-image" />
            ))
          ) : product.images && product.images.length > 0 ? (
            product.images.map((img, i) => (
              <img key={i} src={img.src || img} alt={`${product.title} view ${i}`} className="pdp-image" />
            ))
          ) : (
            <img src={product.imageUrl} alt={product.title} className="pdp-image" />
          )}
        </div>
        
        <div className="pdp-info-wrapper">
          <div className="pdp-info">
            <h1>{getProductTitle(product.title, locale)}</h1>
            <div className="pdp-price">{curSym}{displayPrice.toFixed(2)}</div>
            
            {product.colors && product.colors.length > 0 && (
              <div className="pdp-section">
                <h3>צבע</h3>
                <div className="pdp-options">
                  {product.colors.map(c => (
                    <button 
                      key={c.name}
                      className={`color-btn ${selectedColor === c.name ? 'active' : ''}`}
                      style={{ backgroundColor: c.hex }}
                      onClick={() => setSelectedColor(c.name)}
                      aria-label={`Select color ${c.name}`}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            )}

            {product.sizes && product.sizes.length > 1 && (
              <div className="pdp-section">
                <h3>גודל</h3>
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
              {t('add_to_cart')}
            </button>

            <div className="pdp-accordion">
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'description' ? '' : 'description')}>
                  תיאור המוצר <span>{activeTab === 'description' ? '−' : '+'}</span>
                </button>
                {activeTab === 'description' && <div className="accordion-content">{product.description}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'fabric' ? '' : 'fabric')}>
                  {t('fabric_fit')} <span>{activeTab === 'fabric' ? '−' : '+'}</span>
                </button>
                {activeTab === 'fabric' && <div className="accordion-content">{product.fabric || 'Premium materials.'}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'care' ? '' : 'care')}>
                  {t('care_instructions')} <span>{activeTab === 'care' ? '−' : '+'}</span>
                </button>
                {activeTab === 'care' && <div className="accordion-content">{product.careInstructions || 'Machine wash cold.'}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'delivery' ? '' : 'delivery')}>
                  {t('delivery_info')} <span>{activeTab === 'delivery' ? '−' : '+'}</span>
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
    } catch {
      return [];
    }
  })
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('payplus')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeCoupon, setActiveCoupon] = useState(null)

  const [locale, setLocale] = useState('he')
  const [currency, setCurrency] = useState('ILS')
  const [exchangeRate, setExchangeRate] = useState(3.75)

  const [isWidgetChatOpen, setIsWidgetChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatSessionId] = useState(() => {
    let sid = localStorage.getItem('drip_street_chat_session');
    if (!sid) {
      sid = 'session_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('drip_street_chat_session', sid);
    }
    return sid;
  });
  const [chatInput, setChatInput] = useState('');
  const [chatStatus, setChatStatus] = useState('bot'); // bot or escalated

  useEffect(() => {
    // Geolocation detection
    fetch(`${API_BASE}/api/geolocation`)
      .then(res => res.json())
      .then(data => {
        setLocale(data.locale);
        setCurrency(data.currency);
        setExchangeRate(data.exchangeRate || 3.75);
        if (data.currency === 'USD') {
          setPaymentMethod('stripe');
        }

        const visitKey = 'drip_street_visit_notified';
        if (!sessionStorage.getItem(visitKey)) {
          fetch(`${API_BASE}/api/analytics/visit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: chatSessionId,
              path: window.location.pathname,
              locale: data.locale,
              currency: data.currency,
              source: 'storefront'
            })
          }).catch(() => null);
          sessionStorage.setItem(visitKey, '1');
        }
      })
      .catch(err => console.warn("Geolocation fallback applied:", err));

    fetch(`${API_BASE}/api/products`)
      .then(res => res.json())
      .then(data => { setProducts(data); setIsLoading(false); })
      .catch(err => { console.error(err); setIsLoading(false); })
      
    fetch(`${API_BASE}/api/coupons/active`)
      .then(res => res.json())
      .then(data => { if(data.coupon) setActiveCoupon(data.coupon) })
      .catch(console.error)

    // Load Chat History
    fetch(`${API_BASE}/api/chat/history/${chatSessionId}`)
      .then(res => res.json())
      .then(data => {
        setChatHistory(data.history || []);
        setChatStatus(data.status || 'bot');
      })
      .catch(console.error);

    // Listen for global open cart events (e.g. from PDP)
    const handleOpenCart = () => setIsCartOpen(true);
    window.addEventListener('open-cart', handleOpenCart);
    return () => window.removeEventListener('open-cart', handleOpenCart);
  }, [chatSessionId])

  const t = (key, replaces = {}) => {
    let text = translations[locale]?.[key] || translations['en']?.[key] || key;
    Object.keys(replaces).forEach(k => {
      text = text.replace(`{${k}}`, replaces[k]);
    });
    return text;
  };

  const curSym = currency === 'USD' ? '$' : '₪';
  const displayVal = (nisValue) => (currency === 'USD' ? (nisValue / exchangeRate) : nisValue);

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

  const sendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = chatInput;
    setChatInput('');

    // Optimistically insert user message
    setChatHistory(prev => [...prev, { sender: 'user', text: userMsg, timestamp: new Date().toISOString() }]);

    fetch(`${API_BASE}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: chatSessionId,
        message: userMsg,
        customerName: 'Guest'
      })
    })
      .then(res => res.json())
      .then(data => {
        setChatHistory(data.history || []);
        setChatStatus(data.status || 'bot');
      })
      .catch(err => {
        console.error("Failed to send chat message:", err);
      });
  };

  const addToCart = (product) => {
    const cartId = product.cartId || `${product.id}`;
    const existing = cart.find(item => (item.cartId || `${item.id}`) === cartId)
    if (existing) {
      setCart(cart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: item.quantity + 1 } : item)))
    } else {
      setCart([...cart, { ...product, cartId, quantity: 1 }])
    }
    setIsCartOpen(true)
  }

  const removeFromCart = (cartId) => {
    setCart(cart.filter(item => (item.cartId || `${item.id}`) !== cartId))
  }

  const updateQuantity = (cartId, newQty) => {
    if (newQty <= 0) return removeFromCart(cartId);
    setCart(cart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: newQty } : item)))
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
        window.location.assign(data.paymentUrl);
      } else {
        alert('Checkout initialization failed.');
      }
    } catch {
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
          style={{ fontSize: '48px', marginBottom: '24px' }}>{t('success_title')}</motion.h1>
        <p style={{ fontSize: '20px', color: '#888', marginBottom: '32px' }}>
          {t('success_desc')}
        </p>
        <button className="checkout-btn" style={{ maxWidth: '250px' }} onClick={() => window.location.href = '/'}>
          {t('return_home')}
        </button>
      </div>
    );
  }

  // ============ ROUTE: CHECKOUT ============
  if (currentPath === '/checkout') {
    return (
      <div className="container checkout-page">
        <h1 style={{ marginTop: '40px' }}>{t('checkout_secure')}</h1>
        <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', marginTop: '32px' }}>
          <form className="contact-form" onSubmit={submitCheckout} style={{ flex: '1', minWidth: '300px' }}>
            <h3>{t('shipping_details')}</h3>
            <input name="customerName" type="text" placeholder={t('full_name')} required />
            <input name="customerEmail" type="email" placeholder={t('email')} required />
            <input name="address" type="text" placeholder={t('address')} required />
            
            <h3 style={{ marginTop: '24px' }}>{t('payment_method')}</h3>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="payplus" checked={paymentMethod === 'payplus'} onChange={() => setPaymentMethod('payplus')} />
                {t('payment_card_bit')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} />
                {t('payment_stripe')}
              </label>
            </div>
            <button type="submit" className="checkout-btn">{t('complete_order')} – {curSym}{displayVal(cartTotal).toFixed(2)}</button>
          </form>
          
          <div style={{ flex: '1', minWidth: '300px', backgroundColor: '#111', padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
            <h3>{t('order_summary')}</h3>
            {cart.map(item => {
              const itemPrice = currency === 'USD' ? (item.priceUSD || (item.price / exchangeRate)) : item.price;
              return (
                <div key={item.cartId || item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span>{item.quantity}x {item.title}</span>
                  <span>{curSym}{(itemPrice * item.quantity).toFixed(2)}</span>
                </div>
              );
            })}
            <hr style={{ borderColor: '#333', margin: '16px 0' }} />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#aaa' }}>
              <span>{t('subtotal')}</span>
              <span>{curSym}{displayVal(baseSubtotal).toFixed(2)}</span>
            </div>

            {bundleDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#4caf50' }}>
                <span>{t('bundle_deal', { sets: bundleSets })}</span>
                <span>-{curSym}{displayVal(bundleDiscount).toFixed(2)}</span>
              </div>
            )}

            {couponDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#4caf50' }}>
                <span>Coupon ({activeCoupon.code})</span>
                <span>-{curSym}{displayVal(couponDiscount).toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: isFreeShipping ? '#4caf50' : '#aaa' }}>
              <span>{t('shipping')} {isFreeShipping && '🎉'}</span>
              <span>{isFreeShipping ? t('free') : `${curSym}${displayVal(shippingCost).toFixed(2)}`}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '10px', color: '#666' }}>
              <span>{t('vat')}</span>
              <span>{curSym}0.00</span>
            </div>

            <hr style={{ borderColor: '#333', margin: '16px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '20px' }}>
              <span>{t('total')}</span>
              <span>{curSym}{displayVal(cartTotal).toFixed(2)}</span>
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

  // ============ ROUTE: PRODUCT DETAIL PAGE ============
  if (currentPath.startsWith('/product/')) {
    const productId = currentPath.split('/')[2];
    return <ProductDetailPage productId={productId} addToCart={addToCart} t={t} currency={currency} curSym={curSym} locale={locale} />;
  }

  // ============ ROUTE: 404 ============
  if (currentPath !== '/' && currentPath !== '/cart') {
    return <div className="container legal-page" style={{textAlign: 'center'}}><h1>404 Not Found</h1><button className="checkout-btn" style={{ maxWidth: '200px' }} onClick={() => window.location.href = '/'}>Return Home</button></div>;
  }

  return (
    <>
      <div className="announcement-bar">
        {t('announcement')}
      </div>

      <header className="header container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        <div className="search-bar">
          <input 
            type="text" 
            placeholder={t('search_placeholder')} 
            value={searchQuery}
            aria-label="Search products"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="cart-btn" aria-label="Open cart" onClick={() => setIsCartOpen(true)}>
            🛒 {t('cart')} ({totalItems})
          </button>
        </div>
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
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{t('hero_title')}</motion.h1>
          <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
            {t('hero_subtitle')}
          </motion.p>
        </div>
      </section>

      <main className="container">
        <div className="categories-nav">
          {categories.map(cat => {
            const catKeys = {
              'All': 'all',
              'New Arrivals': 'new_arrivals',
              'Best Sellers': 'best_sellers',
              'Hoodies': 'hoodies',
              'T-Shirts': 'tshirts'
            };
            return (
              <button 
                key={cat} 
                className={`cat-btn ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {t(catKeys[cat] || cat)}
              </button>
            );
          })}
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
              filteredProducts.map(product => {
                const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / exchangeRate)) : product.price;
                const dealBadgeText = currency === 'USD' ? '3 for $61.90' : '3 ב-229₪';
                
                return (
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
                        <span className="deal-badge">{dealBadgeText}</span>
                      )}
                    </div>
                    <div className="product-info">
                      <h3 
                        className="product-title" 
                        onClick={() => { window.history.pushState({}, '', `/product/${product.id}`); window.dispatchEvent(new Event('popstate')); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {getProductTitle(product.title, locale)}
                      </h3>
                      <span className="product-price">{curSym}{displayPrice.toFixed(2)}</span>
                    </div>
                    <button className="add-to-cart" aria-label={`Add ${product.title} to cart`} onClick={() => addToCart(product)}>
                      {t('add_to_cart')}
                    </button>
                  </motion.div>
                );
              })
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
          <h2>{t('cart')} ({totalItems})</h2>
          <button className="close-cart" aria-label="Close cart" onClick={() => setIsCartOpen(false)}>×</button>
        </div>

        {/* Free Shipping Progress Bar */}
        {totalItems > 0 && (
          <div className="shipping-progress">
            {isFreeShipping ? (
              <p className="shipping-unlocked">{t('shipping_unlocked')}</p>
            ) : (
              <>
                <p className="shipping-hint">{t('shipping_hint', { count: itemsToFreeShipping, plural: itemsToFreeShipping > 1 ? 's' : '' })}</p>
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
          {cart.map(item => {
            const itemPrice = currency === 'USD' ? (item.priceUSD || (item.price / exchangeRate)) : item.price;
            const itemDealBadgeText = currency === 'USD' ? '3 for $61.90' : '3 ב-229₪';
            
            return (
              <div key={item.cartId || item.id} className="cart-item">
                <div style={{ flex: 1 }}>
                  <strong>{item.title}</strong>
                  {isTeeProduct(item) && <span className="cart-deal-hint">{itemDealBadgeText}</span>}
                  <div className="cart-qty-controls">
                    <button onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity - 1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity + 1)}>+</button>
                    <button className="remove-btn" onClick={() => removeFromCart(item.cartId || `${item.id}`)}>🗑</button>
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>{curSym}{(itemPrice * item.quantity).toFixed(2)}</div>
              </div>
            );
          })}
          {cart.length === 0 && <p style={{color: '#666', textAlign: 'center', marginTop: '40px'}}>{t('cart_empty')}.</p>}
        </div>

        <div className="cart-footer">
          {bundleDiscount > 0 && (
            <div className="cart-savings-line">
              <span>{t('bundle_deal', { sets: bundleSets })}</span>
              <span style={{ color: '#4caf50' }}>-{curSym}{displayVal(bundleDiscount).toFixed(2)}</span>
            </div>
          )}

          {couponDiscount > 0 && (
            <div className="cart-savings-line">
              <span>Coupon ({activeCoupon.code})</span>
              <span style={{ color: '#4caf50' }}>-{curSym}{displayVal(couponDiscount).toFixed(2)}</span>
            </div>
          )}

          <div className="cart-savings-line">
            <span>{t('shipping')}</span>
            <span style={{ color: isFreeShipping ? '#4caf50' : '#aaa' }}>{isFreeShipping ? t('free') : `${curSym}${displayVal(shippingCost).toFixed(2)}`}</span>
          </div>

          <div className="cart-total">
            <span>{t('total')}</span>
            <span>{curSym}{displayVal(cartTotal).toFixed(2)}</span>
          </div>

          <button className="checkout-btn" onClick={proceedToCheckout} disabled={cart.length === 0} style={{ opacity: cart.length === 0 ? 0.5 : 1 }}>
            {t('checkout')}
          </button>
        </div>
      </div>

      {/* Floating Chat Widget */}
      <div className="chat-widget">
        <button 
          className="chat-bubble"
          onClick={() => setIsWidgetChatOpen(!isWidgetChatOpen)}
          aria-label="Toggle chat support"
        >
          💬
        </button>

        <AnimatePresence>
          {isWidgetChatOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className="chat-window"
            >
              <div className="chat-window-header">
                <h3>{t('support_chat')}</h3>
                <button onClick={() => setIsWidgetChatOpen(false)}>×</button>
              </div>

              {chatStatus === 'escalated' && (
                <div className="chat-escalated-banner">
                  {t('escalated_msg')}
                </div>
              )}

              <div className="chat-messages-container">
                {chatHistory.length === 0 && (
                  <div className="chat-message bot">
                    <div className="chat-message-bubble">
                      {t('support_placeholder')}
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`chat-message ${msg.sender}`}>
                    <div className="chat-message-bubble">
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              <form className="chat-input-form" onSubmit={sendChatMessage}>
                <input 
                  type="text" 
                  placeholder={t('support_placeholder')} 
                  value={chatInput} 
                  onChange={(e) => setChatInput(e.target.value)} 
                />
                <button type="submit">➔</button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
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
