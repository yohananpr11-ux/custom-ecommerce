import React, { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './index.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com').replace(/\/$/, '');
const SHIPPING_COST = 29.90;
const FREE_SHIPPING_THRESHOLD = 5;
const BUNDLE_ITEM_PRICE = 229;
const BUNDLE_ITEM_COUNT = 3;

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) {
    console.error("React Error:", error);
    window.dispatchEvent(new CustomEvent('app:error-toast', { detail: { message: GLOBAL_ERROR_TOAST_HE } }));
    fetch(`${API_BASE}/api/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'System', email: 'error@system', message: `Frontend Crash: ${error.message}` })
    }).catch(() => {});
  }
  render() {
    if (this.state.hasError) return <div className="container" style={{padding: '100px 20px', textAlign: 'center'}}><h1>אירעה שגיאה זמנית</h1><p>אנא רענן את העמוד ונסה שוב.</p></div>;
    return this.props.children;
  }
}

const translations = {
  he: {
    logo: "DRIP STREET",
    announcement: "משלוח חינם בקנייה של 5 פריטים ומעלה | 3 חולצות ב-229 ₪",
    search_placeholder: "חפש פריטים...",
    cart: "סל קניות",
    hero_title: "ELEVATE YOUR STYLE",
    hero_subtitle: "Precision streetwear. High comfort, flattering fit, and clean design for every day.",
    add_to_cart: "הוסף לסל",
    buy_now: "קנה עכשיו",
    all: "הכל",
    new_arrivals: "חדש",
    best_sellers: "הנמכרים ביותר",
    hoodies: "קפוצ'ונים",
    tshirts: "חולצות",
    fabric_fit: "חומר וגזרה",
    care_instructions: "טיפול",
    delivery_info: "משלוח",
    product_description: "תיאור",
    color: "צבע",
    size: "מידה",
    low_stock: "נשארו יחידות אחרונות במידה זו",
    select_available_variant: "בחר צבע ומידה זמינים כדי להוסיף לסל",
    empty_cart_toast: "הסל ריק, הוסף פריטים כדי להמשיך",
    variant_error_toast: "נמצאה שגיאה בוריאנט. רענן את העמוד ובחר מחדש",
    checkout: "קופה",
    checkout_secure: "קופה מאובטחת",
    shipping_details: "פרטי משלוח",
    full_name: "שם מלא",
    email: "אימייל",
    address: "כתובת (רחוב, עיר, מיקוד)",
    payment_method: "בחר תשלום",
    payment_card_bit: "כרטיס אשראי / ביט",
    payment_stripe: "כרטיס בינלאומי (Stripe)",
    order_summary: "סיכום הזמנה",
    subtotal: "סכום ביניים",
    bundle_deal: "🎁 מבצע 3 חולצות",
    bundle_active: "🎉 מבצע 3 חולצות הופעל!",
    bundle_hint: "הוסף חולצה נוספת לקבלת מחיר המבצע",
    shipping: "משלוח",
    free: "חינם",
    vat: "מע״מ",
    total: "לתשלום",
    complete_order: "בצע הזמנה",
    success_title: "🎉 התשלום בוצע!",
    success_desc: "תודה! ההזמנה שלך מעובדת ועל הדרך אליך.",
    return_home: "חזרה לחנות",
    shipping_unlocked: "🎉 משלוח חינם!",
    shipping_hint: "עוד {count} פריטים למשלוח חינם",
    cart_empty: "הסל ריק",
    support_chat: "מני 🤖",
    support_placeholder: "שאלה קצרה? אני כאן לעזור",
    escalated_msg: "חיברנו אותך לנציג, תשובה תישלח בקרוב",
    flash_sale: "מבצע לזמן קצר: קוד {code} נותן {discount}% הנחה",
    coupon_label: "קופון",
    contact_title: "צור קשר",
    contact_name_placeholder: "איך קוראים לך?",
    contact_email_placeholder: "האימייל שלך",
    contact_message_placeholder: "איך אפשר לעזור?",
    contact_send: "שליחה",
    legal_privacy: "מדיניות פרטיות",
    legal_terms: "תנאי שימוש",
    legal_refund: "מדיניות החזרות",
    legal_contact: "שירות לקוחות",
    legal_back: "חזרה לחנות",
    legal_intro: "אנחנו שומרים על פרטיות, שקיפות ושירות הוגן בכל הזמנה.",
    legal_info_collect_title: "איזה מידע אנחנו אוספים",
    legal_info_collect_text: "אנחנו אוספים רק פרטים שנדרשים לביצוע הזמנה ושירות לקוחות.",
    legal_payments_title: "אבטחת תשלומים",
    legal_payments_text: "התשלום מעובד בצורה מאובטחת דרך ספקי סליקה חיצוניים.",
    legal_refunds_title: "החלפות והחזרות",
    legal_refunds_text: "ניתן לפנות לשירות הלקוחות תוך 14 יום מקבלת המשלוח בהתאם למדיניות.",
    not_found_title: "העמוד לא נמצא",
    search_aria: "חיפוש מוצרים",
    open_cart_aria: "פתיחת סל קניות",
    close_cart_aria: "סגירת סל קניות",
    toggle_chat_aria: "פתיחת צ׳אט תמיכה",
    loading: "טוען...",
    product_not_found: "המוצר לא נמצא",
    shop_rights: "© 2026 Drip Street. כל הזכויות שמורות."
  },
  en: {
    logo: "DRIP STREET",
    announcement: "Complimentary shipping on 5+ items | 3-item bundle for 229 ₪",
    search_placeholder: "Search items...",
    cart: "Cart",
    hero_title: "ELEVATE YOUR STYLE",
    hero_subtitle: "Uncompromising comfort meets clean design. Essential everyday wear.",
    add_to_cart: "Add to Cart",
    buy_now: "Buy Now",
    all: "All",
    new_arrivals: "New Arrivals",
    best_sellers: "Best Sellers",
    hoodies: "Hoodies",
    tshirts: "T-Shirts",
    fabric_fit: "Fabric & Fit",
    care_instructions: "Care Instructions",
    delivery_info: "Delivery Info",
    product_description: "Description",
    color: "Color",
    size: "Size",
    low_stock: "Only a few units left in this size",
    select_available_variant: "Please select an available color and size",
    empty_cart_toast: "Your cart is empty, add items to continue",
    variant_error_toast: "Variant mismatch detected, refresh and select again",
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
    bundle_deal: "🎁 3-item bundle",
    bundle_active: "🎉 3-item bundle applied successfully!",
    bundle_hint: "Add one more item to unlock the bundle price!",
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
    escalated_msg: "Escalated to human support. We will reply to your chat shortly.",
    flash_sale: "Limited offer: Use code {code} for {discount}% off",
    coupon_label: "Coupon",
    contact_title: "Contact Us",
    contact_name_placeholder: "Your Name",
    contact_email_placeholder: "Your Email",
    contact_message_placeholder: "How can we help?",
    contact_send: "Send Message",
    legal_privacy: "Privacy Policy",
    legal_terms: "Terms of Service",
    legal_refund: "Refund Policy",
    legal_contact: "Contact Support",
    legal_back: "Back to Store",
    legal_intro: "We are committed to privacy, transparency, and fair service.",
    legal_info_collect_title: "Information We Collect",
    legal_info_collect_text: "We collect only the information needed to process your order and support requests.",
    legal_payments_title: "Payment Security",
    legal_payments_text: "Payments are securely processed by external payment providers.",
    legal_refunds_title: "Returns & Refunds",
    legal_refunds_text: "You may contact support within 14 days of delivery according to policy terms.",
    not_found_title: "404 Not Found",
    search_aria: "Search products",
    open_cart_aria: "Open cart",
    close_cart_aria: "Close cart",
    toggle_chat_aria: "Toggle chat support",
    loading: "Loading...",
    product_not_found: "Product not found",
    shop_rights: "© 2026 Drip Street. All rights reserved."
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

const hebrewProductTitleRules = [
  { test: (s) => s.includes('drum machine'), title: 'טי-שירט דראם משין' },
  { test: (s) => s.includes('retro palm'), title: 'טי-שירט דקלים רטרו' },
  { test: (s) => s.includes('urban frequency'), title: 'טי-שירט אורבן פריקוונסי' },
  { test: (s) => s.includes('ramen shop'), title: 'טי-שירט ראמן שופ' },
  { test: (s) => s.includes('minimal botanical'), title: 'טי-שירט בוטני מינימליסטי' },
  { test: (s) => s.includes('sunset road'), title: 'טי-שירט סאנסט רואד' },
  { test: (s) => s.includes('eiffel tower') || s.includes('paris'), title: 'טי-שירט פריז אייפל' },
  { test: (s) => s.includes('samurai'), title: 'טי-שירט סמוראי' },
  { test: (s) => s.includes('tank'), title: 'גופיית קיץ מינימליסטית' },
  { test: (s) => s.includes('hoodie') || s.includes('sweatshirt'), title: 'קפוצ׳ון אוברסייז קלאסי' },
  { test: (s) => s.includes('tee') || s.includes('t-shirt') || s.includes('shirt'), title: 'טי-שירט יוניסקס פרימיום' },
];

const hebrewColorMap = {
  black: 'שחור',
  white: 'לבן',
  sportgrey: 'אפור',
  sportgreyheather: 'אפור',
  heather: 'אפור',
  red: 'אדום',
  navy: 'כחול כהה',
  blue: 'כחול',
  green: 'ירוק',
  sand: 'חול',
  natural: 'שמנת',
  tan: 'בז׳',
  autumn: 'כתום',
  mauve: 'ורוד מעושן',
  vintagewhite: 'לבן וינטג׳',
  canvasred: 'אדום',
};

function localizeColorName(color, locale) {
  if (locale !== 'he') return color;
  const normalized = String(color || '').toLowerCase().replace(/[^a-z]/g, '');
  return hebrewColorMap[normalized] || color;
}

function getProductTitle(title, locale) {
  if (locale === 'he') {
    if (productTitleMap[title]) return productTitleMap[title];
    const normalized = String(title || '').toLowerCase();
    const rule = hebrewProductTitleRules.find((entry) => entry.test(normalized));
    if (rule) return rule.title;
  }
  return title;
}

function getCartDisplayTitle(rawTitle, locale) {
  const text = String(rawTitle || '');
  if (locale !== 'he') return text;
  const parts = text.split(' - ');
  const base = getProductTitle(parts[0] || '', locale);
  const rest = parts.slice(1).map((part, idx) => (idx === 0 ? localizeColorName(part, locale) : part));
  return [base, ...rest].join(' - ');
}

function getLocalizedProductDescription(product, locale) {
  if (locale !== 'he') return product.description || 'Premium quality, clean fit, everyday comfort.';
  if (isTeeProduct(product)) return 'חולצה איכותית מבד נעים, גזרה מחמיאה ונוחות מקסימלית לשימוש יומיומי.';
  if (String(product.title || '').toLowerCase().includes('tank')) return 'גופייה קלילה לקיץ, נוחה ונעימה עם מראה נקי ומדויק.';
  return 'קפוצ׳ון איכותי עם בד נעים, ישיבה טובה ונוחות גבוהה לכל היום.';
}

function getLocalizedFabric(product, locale) {
  if (locale !== 'he') return product.fabric || 'Premium cotton blend';
  if (String(product.title || '').toLowerCase().includes('tank')) return 'בד קליל ונושם שמתאים במיוחד לעונות חמות.';
  return 'בד איכותי, נעים למגע, עם גזרה מחמיאה ונוחה.';
}

function getLocalizedCare(product, locale) {
  if (locale !== 'he') return product.careInstructions || 'Machine wash cold.';
  return 'כביסה עדינה במים קרים, להפוך את הפריט לפני כביסה, ללא גיהוץ ישיר על ההדפס.';
}

function getLocalizedDelivery(product, locale) {
  if (locale !== 'he') return product.deliveryInfo || 'Standard delivery.';
  return 'זמן משלוח משוער: 7-14 ימי עסקים (כולל מספר מעקב לכל הזמנה).';
}

/** Check if a product is a tee (not hoodie or tank) */
function isTeeProduct(product) {
  if (!product || !product.title) return false;
  const t = product.title.toLowerCase();
  // Exclude hoodies, sweatshirts, and tank tops - they don't qualify for bundle
  if (t.includes('hoodie') || t.includes('sweatshirt') || t.includes('tank')) {
    return false;
  }
  // Include only actual t-shirts/tees
  return (t.includes('tee') || t.includes('t-shirt') || t.includes('shirt'));
}

const getCartUnitPrice = (item, currency, exchangeRate) => {
  if (currency === 'USD') {
    return Number(item.priceUSD || (item.price / exchangeRate) || 0);
  }
  return Number(item.price || 0);
};

const expandCartUnits = (cart) => {
  const units = [];
  cart.forEach((item) => {
    if (!isTeeProduct(item)) return;
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.price || 0);
    for (let index = 0; index < quantity; index += 1) {
      units.push({
        title: item.title,
        unitPrice,
        cartId: item.cartId || `${item.id}`,
      });
    }
  });

  return units.sort((a, b) => b.unitPrice - a.unitPrice);
};

const calculateBundlePricing = (cart) => {
  const teeUnits = expandCartUnits(cart);
  const teeCount = teeUnits.length;
  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const bundleSets = Math.floor(teeCount / BUNDLE_ITEM_COUNT);
  const bundleUnitsCount = bundleSets * BUNDLE_ITEM_COUNT;

  const teeSubtotal = teeUnits.reduce((sum, unit) => sum + unit.unitPrice, 0);
  const nonTeeSubtotal = cart.filter(item => !isTeeProduct(item)).reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const baseSubtotal = teeSubtotal + nonTeeSubtotal;
  const remainderTeeSubtotal = teeUnits.slice(bundleUnitsCount).reduce((sum, unit) => sum + unit.unitPrice, 0);
  const subtotalAfterDiscounts = (bundleSets * BUNDLE_ITEM_PRICE) + remainderTeeSubtotal + nonTeeSubtotal;
  const bundleDiscount = Math.max(0, baseSubtotal - subtotalAfterDiscounts);

  return {
    totalQuantity,
    bundleSets,
    bundleDiscount,
    baseSubtotal,
    subtotalAfterDiscounts,
  };
};

const GLOBAL_IMAGE_FALLBACK = '/shirt-black-design.png';
const GLOBAL_ERROR_TOAST_HE = 'אירעה שגיאה זמנית, אנא נסה שוב';

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const findMatchingVariant = (variants, selectedColor, selectedSize) => {
  if (!Array.isArray(variants) || variants.length === 0) return null;

  const normalizedColor = normalizeValue(selectedColor);
  const normalizedSize = normalizeValue(selectedSize);

  return variants.find((variant) => (
    normalizeValue(variant.color) === normalizedColor
    && normalizeValue(variant.size) === normalizedSize
    && Number(variant.isEnabled) !== 0
    && Number(variant.isAvailable) !== 0
  )) || null;
};

function setImageFallback(event, fallbackSrc = GLOBAL_IMAGE_FALLBACK) {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === '1') return;
  img.dataset.fallbackApplied = '1';
  img.src = fallbackSrc;
}

function GuardedProductImage({ src, alt, className, fallbackSrc = GLOBAL_IMAGE_FALLBACK, loading = 'lazy', fetchPriority = 'auto' }) {
  const [currentSrc, setCurrentSrc] = useState(src || fallbackSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src || fallbackSrc);
    setFailed(false);
  }, [src, fallbackSrc]);

  const handleError = () => {
    if (currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      return;
    }

    setFailed(true);
  };

  if (failed) {
    return (
      <div className={`${className} image-fallback-card`} role="img" aria-label={alt}>
        <div className="skeleton image-fallback-skeleton" />
        <span className="image-fallback-label">DRIP STREET</span>
      </div>
    );
  }

  return <img loading={loading} fetchPriority={fetchPriority} src={currentSrc} alt={alt} className={className} onError={handleError} />;
}

function ProductDetailPage({ productId, addToCart, goToCheckout, showToast, t, currency, curSym, locale }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [activeTab, setActiveTab] = useState('');
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const mainCtaRef = useRef(null);

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

        setProduct(data);
        
        // Select first non-black color
        if (data.colors && data.colors.length > 0) {
          const nonBlackColor = data.colors.find(c => c.name.toLowerCase() !== 'black');
          setSelectedColor(nonBlackColor ? nonBlackColor.name : data.colors[0].name);
        }
        if (data.sizes && data.sizes.length > 0) setSelectedSize(data.sizes[0]);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Product fetch failed:', err);
        showToast(GLOBAL_ERROR_TOAST_HE);
        setLoading(false);
      });
  }, [productId]);

  const productVariants = product && Array.isArray(product.variants) ? product.variants : [];
  const productSizes = product && Array.isArray(product.sizes) ? product.sizes : [];

  const selectedVariant = useMemo(() => (
    findMatchingVariant(productVariants, selectedColor, selectedSize)
  ), [productVariants, selectedColor, selectedSize]);

  const availableSizesForColor = useMemo(() => {
    const normalizedColor = normalizeValue(selectedColor);
    const sizes = new Set();
    productVariants.forEach((variant) => {
      if (
        normalizeValue(variant.color) === normalizedColor
        && Number(variant.isEnabled) !== 0
        && Number(variant.isAvailable) !== 0
      ) {
        sizes.add(variant.size);
      }
    });
    return sizes;
  }, [productVariants, selectedColor]);

  useEffect(() => {
    if (!selectedColor || productSizes.length === 0) return;
    if (availableSizesForColor.size === 0) return;

    if (!availableSizesForColor.has(selectedSize)) {
      const fallbackSize = productSizes.find((size) => availableSizesForColor.has(size));
      if (fallbackSize) setSelectedSize(fallbackSize);
    }
  }, [selectedColor, selectedSize, availableSizesForColor, productSizes]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

    syncViewport();
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', syncViewport);
    else mediaQuery.addListener(syncViewport);

    return () => {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', syncViewport);
      else mediaQuery.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!mainCtaRef.current || !isMobileViewport) {
      setShowStickyCta(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setShowStickyCta(!entry.isIntersecting);
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    observer.observe(mainCtaRef.current);
    return () => observer.disconnect();
  }, [isMobileViewport]);

  const selectedVariantStock = selectedVariant && Number.isFinite(Number(selectedVariant.stockQty))
    ? Number(selectedVariant.stockQty)
    : null;
  const isLowStock = selectedVariantStock !== null && selectedVariantStock > 0 && selectedVariantStock < 5;

  if (loading) return <div className="container" style={{padding: '100px 0', textAlign: 'center'}}>{t('loading')}</div>;
  if (!product) return <div className="container" style={{padding: '100px 0', textAlign: 'center'}}>{t('product_not_found')}</div>;

  const handleAdd = (mode = 'cart') => {
    let variantId = null;
    if (product.variants && product.variants.length > 0) {
      const matchedVariant = findMatchingVariant(product.variants, selectedColor, selectedSize);
      if (!matchedVariant || !matchedVariant.id) {
        showToast(t('select_available_variant'));
        return false;
      }
      variantId = matchedVariant.id;
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
    }, { openCart: mode !== 'buy', onAdded: mode === 'buy' ? () => goToCheckout() : null });

    return true;
  };

  const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / 3.75)) : product.price;

  return (
    <>
      <header className="header container">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        <button className="cart-btn" aria-label={t('open_cart_aria')} onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))}>
          🛒 {t('cart')}
        </button>
      </header>
      <div className="container pdp-container">
        <div className="pdp-images">
          {product.imagesByColor && product.imagesByColor[selectedColor] && product.imagesByColor[selectedColor].length > 0 ? (
            product.imagesByColor[selectedColor].map((img, i) => (
              <GuardedProductImage
                key={`${selectedColor}-${i}-${img.src || img}`}
                src={img.src || img}
                alt={`${product.title} view ${i}`}
                className="pdp-image"
                loading={i === 0 ? 'eager' : 'lazy'}
                fetchPriority={i === 0 ? 'high' : 'auto'}
              />
            ))
          ) : product.images && product.images.length > 0 ? (
            product.images.map((img, i) => (
              <GuardedProductImage
                key={`fallback-${selectedColor}-${i}-${img.src || img}`}
                src={img.src || img}
                alt={`${product.title} view ${i}`}
                className="pdp-image"
                loading={i === 0 ? 'eager' : 'lazy'}
                fetchPriority={i === 0 ? 'high' : 'auto'}
              />
            ))
          ) : (
            <GuardedProductImage src={product.imageUrl} alt={product.title} className="pdp-image" loading="eager" fetchPriority="high" />
          )}
        </div>
        
        <div className="pdp-info-wrapper">
          <div className="pdp-info">
            <h1>{getProductTitle(product.title, locale)}</h1>
            <div className="pdp-price">{curSym}{displayPrice.toFixed(2)}</div>
            
            {product.colors && product.colors.length > 0 && (
              <div className="pdp-section">
                <h3>{t('color')}</h3>
                <div className="pdp-options">
                  {product.colors.map(c => (
                    <button 
                      key={c.name}
                      className={`color-btn ${selectedColor === c.name ? 'active' : ''}`}
                      style={{ backgroundColor: c.hex }}
                      onClick={() => setSelectedColor(c.name)}
                      aria-label={`${t('color')} ${localizeColorName(c.name, locale)}`}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            )}

            {product.sizes && product.sizes.length > 1 && (
              <div className="pdp-section">
                <h3>{t('size')}</h3>
                {isLowStock && (
                  <div className="low-stock-badge">{t('low_stock')}</div>
                )}
                <div className="pdp-options">
                  {product.sizes.map(s => (
                    <button 
                      key={s}
                      className={`size-btn ${selectedSize === s ? 'active' : ''}`}
                      disabled={availableSizesForColor.size > 0 && !availableSizesForColor.has(s)}
                      onClick={() => setSelectedSize(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button ref={mainCtaRef} className="checkout-btn add-to-cart-large" onClick={() => handleAdd('cart')}>
              {t('add_to_cart')}
            </button>
            <button className="buy-now-inline" onClick={() => handleAdd('buy')}>
              {t('buy_now')}
            </button>

            <div className="pdp-accordion">
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'description' ? '' : 'description')}>
                  {t('product_description')} <span>{activeTab === 'description' ? '−' : '+'}</span>
                </button>
                {activeTab === 'description' && <div className="accordion-content">{getLocalizedProductDescription(product, locale)}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'fabric' ? '' : 'fabric')}>
                  {t('fabric_fit')} <span>{activeTab === 'fabric' ? '−' : '+'}</span>
                </button>
                {activeTab === 'fabric' && <div className="accordion-content">{getLocalizedFabric(product, locale)}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'care' ? '' : 'care')}>
                  {t('care_instructions')} <span>{activeTab === 'care' ? '−' : '+'}</span>
                </button>
                {activeTab === 'care' && <div className="accordion-content">{getLocalizedCare(product, locale)}</div>}
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'delivery' ? '' : 'delivery')}>
                  {t('delivery_info')} <span>{activeTab === 'delivery' ? '−' : '+'}</span>
                </button>
                {activeTab === 'delivery' && <div className="accordion-content">{getLocalizedDelivery(product, locale)}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showStickyCta && (
        <div className="sticky-buy-bar">
          <button className="sticky-buy-btn secondary" onClick={() => handleAdd('cart')}>
            {t('add_to_cart')}
          </button>
          <button className="sticky-buy-btn" onClick={() => handleAdd('buy')}>
            {t('buy_now')}
          </button>
        </div>
      )}
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
  const [toast, setToast] = useState({ visible: false, message: '' });

  const showToast = (message) => {
    if (!message) return;
    setToast({ visible: true, message });
  };

  useEffect(() => {
    if (!toast.visible) return;
    const timer = setTimeout(() => setToast({ visible: false, message: '' }), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      showToast(GLOBAL_ERROR_TOAST_HE);
    };

    const handleWindowError = (event) => {
      console.error('Unhandled runtime error:', event.error || event.message);
      showToast(GLOBAL_ERROR_TOAST_HE);
    };

    const handleBoundaryToast = (event) => {
      showToast(event.detail && event.detail.message ? event.detail.message : GLOBAL_ERROR_TOAST_HE);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleWindowError);
    window.addEventListener('app:error-toast', handleBoundaryToast);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('app:error-toast', handleBoundaryToast);
    };
  }, []);

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
      .catch(err => {
        console.error(err);
        showToast(GLOBAL_ERROR_TOAST_HE);
        setIsLoading(false);
      })
      
    fetch(`${API_BASE}/api/coupons/active`)
      .then(res => res.json())
      .then(data => { if(data.coupon) setActiveCoupon(data.coupon) })
      .catch((err) => {
        console.error(err);
      })

    // Load Chat History
    fetch(`${API_BASE}/api/chat/history/${chatSessionId}`)
      .then(res => res.json())
      .then(data => {
        setChatHistory(data.history || []);
        setChatStatus(data.status || 'bot');
      })
      .catch((err) => {
        console.error(err);
      });

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

  useEffect(() => {
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

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
        showToast(GLOBAL_ERROR_TOAST_HE);
      });
  };

  const goToCheckoutNow = () => {
    setIsCartOpen(false);
    window.history.pushState({}, '', '/checkout');
    window.dispatchEvent(new Event('popstate'));
  };

  const addToCart = (product, options = {}) => {
    const { openCart = true, onAdded } = options;
    const cartId = product.cartId || `${product.id}`;
    setCart((prevCart) => {
      const existing = prevCart.find(item => (item.cartId || `${item.id}`) === cartId);
      const nextCart = existing
        ? prevCart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: item.quantity + 1 } : item))
        : [...prevCart, { ...product, cartId, quantity: 1 }];

      if (typeof onAdded === 'function') {
        setTimeout(() => onAdded(nextCart), 0);
      }

      return nextCart;
    });
    if (openCart) setIsCartOpen(true)
  }

  const removeFromCart = (cartId) => {
    setCart(cart.filter(item => (item.cartId || `${item.id}`) !== cartId))
  }

  const updateQuantity = (cartId, newQty) => {
    if (newQty <= 0) return removeFromCart(cartId);
    setCart(cart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: newQty } : item)))
  }

  // ============ PRICING LOGIC ============
  
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const bundlePricing = calculateBundlePricing(cart);
  const baseSubtotal = bundlePricing.baseSubtotal;
  const bundleSets = bundlePricing.bundleSets;
  const bundleDiscount = bundlePricing.bundleDiscount;
  const bundleActive = bundleSets > 0;
  
  const couponDiscount = activeCoupon ? (baseSubtotal - bundleDiscount) * (activeCoupon.discount_pct / 100) : 0;
  
  const isFreeShipping = totalItems >= FREE_SHIPPING_THRESHOLD;
  const shippingCost = isFreeShipping ? 0 : (totalItems > 0 ? SHIPPING_COST : 0);
  const itemsToFreeShipping = FREE_SHIPPING_THRESHOLD - totalItems;
  const subtotalAfterDiscounts = Math.max(0, bundlePricing.subtotalAfterDiscounts - couponDiscount);
  const cartTotal = subtotalAfterDiscounts + shippingCost;

  // ============ NAVIGATION ============

  const proceedToCheckout = () => {
    if (cart.length === 0) {
      showToast(t('empty_cart_toast'));
      return;
    }
    setIsCartOpen(false);
    window.history.pushState({}, '', '/checkout');
    window.dispatchEvent(new Event('popstate'));
  }

  const submitCheckout = async (e) => {
    e.preventDefault();

    const hasInvalidVariant = cart.some((item) => (
      item.selectedColor
      && item.selectedSize
      && (!item.variantId || Number.isNaN(Number(item.variantId)))
    ));

    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      return;
    }

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
          bundleCount: BUNDLE_ITEM_COUNT,
          bundlePrice: BUNDLE_ITEM_PRICE,
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
        showToast(GLOBAL_ERROR_TOAST_HE);
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      showToast(GLOBAL_ERROR_TOAST_HE);
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
                  <span>{item.quantity}x {getCartDisplayTitle(item.title, locale)}</span>
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
                <span>{t('coupon_label')} ({activeCoupon.code})</span>
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
        <h1>{t('contact_title')}</h1>
        <form className="contact-form" onSubmit={(e) => {
          e.preventDefault();
          fetch(`${API_BASE}/api/contact`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: e.target.name.value, email: e.target.email.value, message: e.target.message.value })
          }).then(() => {
            showToast('ההודעה נשלחה בהצלחה');
            window.location.href='/';
          }).catch((err) => {
            console.error('Contact submit failed:', err);
            showToast(GLOBAL_ERROR_TOAST_HE);
          })
        }}>
          <input name="name" type="text" placeholder={t('contact_name_placeholder')} required />
          <input name="email" type="email" placeholder={t('contact_email_placeholder')} required />
          <textarea name="message" placeholder={t('contact_message_placeholder')} required></textarea>
          <button type="submit" className="checkout-btn">{t('contact_send')}</button>
        </form>
      </div>
    );
  }

  // ============ ROUTE: LEGAL PAGES ============
  if (currentPath === '/privacy' || currentPath === '/terms' || currentPath === '/refund') {
    const pageTitleByPath = {
      '/privacy': t('legal_privacy'),
      '/terms': t('legal_terms'),
      '/refund': t('legal_refund'),
    };
    const title = pageTitleByPath[currentPath] || t('legal_privacy');
    return (
      <div className="container legal-page" style={{ maxWidth: '800px', marginTop: '40px' }}>
        <h1>{title}</h1>
        <p style={{ lineHeight: '1.8', color: '#ccc' }}>
          {t('legal_intro')}
          <br/><br/>
          <strong>1. {t('legal_info_collect_title')}</strong><br/>
          {t('legal_info_collect_text')}
          <br/><br/>
          <strong>2. {t('legal_payments_title')}</strong><br/>
          {t('legal_payments_text')}
          <br/><br/>
          <strong>3. {t('legal_refunds_title')}</strong><br/>
          {t('legal_refunds_text')}
        </p>
        <button className="checkout-btn" style={{ maxWidth: '200px', marginTop: '40px' }} onClick={() => window.location.href = '/'}>{t('legal_back')}</button>
      </div>
    );
  }

  // ============ ROUTE: PRODUCT DETAIL PAGE ============
  if (currentPath.startsWith('/product/')) {
    const productId = currentPath.split('/')[2];
    return <ProductDetailPage productId={productId} addToCart={addToCart} goToCheckout={goToCheckoutNow} showToast={showToast} t={t} currency={currency} curSym={curSym} locale={locale} />;
  }

  // ============ ROUTE: 404 ============
  if (currentPath !== '/' && currentPath !== '/cart') {
    return <div className="container legal-page" style={{textAlign: 'center'}}><h1>{t('not_found_title')}</h1><button className="checkout-btn" style={{ maxWidth: '200px' }} onClick={() => window.location.href = '/'}>{t('return_home')}</button></div>;
  }

  return (
    <>
      <div className="announcement-bar">
        {t('announcement')}
      </div>
      <script>{`document.documentElement.dir = '${locale === 'he' ? 'rtl' : 'ltr'}'; document.documentElement.lang = '${locale}';`}</script>

      <header className="header container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        <div className="search-bar">
          <input 
            type="text"
            dir={locale === 'he' ? 'rtl' : 'ltr'}
            placeholder={t('search_placeholder')} 
            value={searchQuery}
            aria-label={t('search_aria')}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="cart-btn" aria-label={t('open_cart_aria')} onClick={() => setIsCartOpen(true)}>
            🛒 {t('cart')} ({totalItems})
          </button>
        </div>
      </header>

      {activeCoupon && (
        <motion.div 
          initial={{ y: -50 }} animate={{ y: 0 }} 
          className="promo-banner"
        >
          {t('flash_sale', { code: activeCoupon.code, discount: activeCoupon.discount_pct })}
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
                const dealBadgeText = currency === 'USD'
                  ? `${curSym}${displayVal(BUNDLE_ITEM_PRICE).toFixed(2)} for 3 items`
                  : '3 פריטים ב-229₪';
                
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
                      <img loading="lazy" src={product.imageUrl} alt={product.title} className="product-image front-img" onError={(e) => setImageFallback(e)} />
                      {product.backImageUrl && (
                        <img loading="lazy" src={product.backImageUrl} alt={`${product.title} back`} className="product-image back-img" onError={(e) => setImageFallback(e, product.imageUrl || GLOBAL_IMAGE_FALLBACK)} />
                      )}
                      {isTeeProduct(product) && <span className="deal-badge">{dealBadgeText}</span>}
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
                    <button className="add-to-cart" aria-label={`${t('add_to_cart')} ${getProductTitle(product.title, locale)}`} onClick={() => addToCart(product)}>
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
          <a href="/privacy">{t('legal_privacy')}</a>
          <a href="/terms">{t('legal_terms')}</a>
          <a href="/refund">{t('legal_refund')}</a>
          <a href="/contact">{t('legal_contact')}</a>
        </div>
        <p>{t('shop_rights')}</p>
      </footer>

      {/* Cart Drawer */}
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2>{t('cart')} ({totalItems})</h2>
          <button className="close-cart" aria-label={t('close_cart_aria')} onClick={() => setIsCartOpen(false)}>×</button>
        </div>

        {bundleActive ? (
          <div className="bundle-banner active">{t('bundle_active')}</div>
        ) : totalItems === 2 ? (
          <div className="bundle-banner hint">{t('bundle_hint')}</div>
        ) : null}

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
            const itemPrice = getCartUnitPrice(item, currency, exchangeRate);
            
            return (
              <div key={item.cartId || item.id} className="cart-item">
                <div style={{ flex: 1 }}>
                  <strong>{getCartDisplayTitle(item.title, locale)}</strong>
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
              <span>{t('coupon_label')} ({activeCoupon.code})</span>
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
          aria-label={t('toggle_chat_aria')}
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

      <AnimatePresence>
        {toast.visible && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className="global-toast"
            role="status"
            aria-live="polite"
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
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
