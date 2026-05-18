import React, { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
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
    hero_title: "DRIP STREET",
    hero_subtitle: "סטריטוור מינימליסטי ליום יום.",
    shop_now: "קנה עכשיו",
    best_sellers: "הנמכרים ביותר",
    trust_secure: "תשלום מאובטח",
    trust_shipping: "משלוח מהיר",
    trust_returns: "החזרות קלות",
    language_currency: "שפה וערה",
    add_to_cart: "הוסף לסל",
    buy_now: "קנה עכשיו",
    all: "הכל",
    new_arrivals: "חדש",
    best_sellers: "הנמכרים ביותר",
    hoodies: "קפוצ'ונים",
    tshirts: "חולצות",
    tank_tops: "גופיות",
    fabric_fit: "חומר וגזרה",
    care_instructions: "טיפול",
    delivery_info: "משלוח",
    product_description: "תיאור",
    color: "צבע",
    size: "מידה",
    quantity: "כמות",
    configure_product_title: "בחר את ההתאמה המושלמת שלך",
    configure_product_subtitle: "לפני הוספה לסל, בחר צבע, מידה וכמות בדיוק כמו שמתאים לך.",
    choose_color: "בחר צבע",
    choose_size: "בחר מידה",
    choose_quantity: "בחר כמות",
    add_selected_to_cart: "הוסף את הבחירה לסל",
    continue_shopping: "המשך בקנייה",
    cart_customize: "התאם את הפריט שלך",
    review_title: "לפני תשלום — בדיקת בחירה",
    review_subtitle: "אלה הפריטים שבחרת בקפידה. אפשר לעדכן כל פרט לפני ביצוע ההזמנה.",
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
    payment_paypal: "PayPal",
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
    hero_title: "DRIP STREET",
    hero_subtitle: "Minimal streetwear built for confidence.",
    shop_now: "Shop Now",
    best_sellers: "Best Sellers",
    trust_secure: "Secure Payment",
    trust_shipping: "Fast Shipping",
    trust_returns: "Easy Returns",
    language_currency: "Language & Currency",
    add_to_cart: "Add to Cart",
    buy_now: "Buy Now",
    all: "All",
    new_arrivals: "New Arrivals",
    best_sellers: "Best Sellers",
    hoodies: "Hoodies",
    tshirts: "T-Shirts",
    tank_tops: "Tank Tops",
    fabric_fit: "Fabric & Fit",
    care_instructions: "Care Instructions",
    delivery_info: "Delivery Info",
    product_description: "Description",
    color: "Color",
    size: "Size",
    quantity: "Quantity",
    configure_product_title: "Choose Your Perfect Fit",
    configure_product_subtitle: "Before adding to cart, select the color, size, and quantity that suit you best.",
    choose_color: "Choose color",
    choose_size: "Choose size",
    choose_quantity: "Choose quantity",
    add_selected_to_cart: "Add Selection to Cart",
    continue_shopping: "Continue Shopping",
    cart_customize: "Customize Your Item",
    review_title: "Before Payment — Final Selection Review",
    review_subtitle: "These are the exact items you selected. You can refine every detail before completing payment.",
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
    payment_paypal: "PayPal",
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

function splitVariantTitle(rawTitle) {
  const parts = String(rawTitle || '').split(' - ');
  return {
    base: parts[0] || String(rawTitle || ''),
    color: parts[1] || '',
    size: parts[2] || '',
  };
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
  const operational = product && product.operationalNotice ? product.operationalNotice : null;
  if (operational) {
    const [prodMin, prodMax] = operational.productionRangeDays || [2, 5];
    const [shipMin, shipMax] = operational.shippingRangeDays || [7, 14];
    if (locale !== 'he') {
      return `Live fulfillment window: ${prodMin}-${prodMax} business days production + ${shipMin}-${shipMax} business days shipping.`;
    }
    return `נתוני זמינות חיים: ייצור ${prodMin}-${prodMax} ימי עסקים ומשלוח ${shipMin}-${shipMax} ימי עסקים.`;
  }

  if (locale !== 'he') return product.deliveryInfo || 'Standard delivery.';
  return product.deliveryInfo || 'זמני משלוח מתעדכנים לפי זמינות בזמן אמת.';
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
const LOW_STOCK_THRESHOLD = 5;
const MAX_ALLOWED_SIZE_RANK = 6;
const SIZE_ORDER = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZE_RANK = SIZE_ORDER.reduce((acc, size, index) => ({ ...acc, [size]: index + 1 }), {});

const normalizeValue = (value) => String(value || '').trim().toLowerCase();
const normalizeSizeLabel = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const getOrderedDisplaySizes = (sizes = []) => {
  const unique = Array.from(new Set((sizes || []).map((size) => normalizeSizeLabel(size)).filter(Boolean)));
  return unique
    .filter((size) => (SIZE_RANK[size] || Number.MAX_SAFE_INTEGER) <= MAX_ALLOWED_SIZE_RANK)
    .sort((a, b) => {
      const rankA = SIZE_RANK[a] || Number.MAX_SAFE_INTEGER;
      const rankB = SIZE_RANK[b] || Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });
};

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

const findFirstAvailableVariantForColor = (variants, selectedColor) => {
  if (!Array.isArray(variants) || variants.length === 0) return null;

  const normalizedColor = normalizeValue(selectedColor);

  return variants.find((variant) => (
    normalizeValue(variant.color) === normalizedColor
    && Number(variant.isEnabled) !== 0
    && Number(variant.isAvailable) !== 0
  )) || null;
};

const deriveProductCategory = (product = {}) => {
  const title = String(product.title || '').toLowerCase();

  if (title.includes('hoodie') || title.includes('sweatshirt')) return 'Hoodies';
  if (title.includes('tank')) return 'Tank Tops';
  if (isTeeProduct(product)) return 'Shirts';

  return 'New Arrivals';
};

const buildDynamicCategories = (products = []) => {
  const derived = Array.from(new Set((products || []).map((product) => deriveProductCategory(product)).filter(Boolean)));
  return ['All', ...derived];
};

const getRecommendationProducts = (products = [], cart = [], activeProductId = null) => {
  const cartIds = new Set((cart || []).map((item) => Number(item.id)).filter(Number.isFinite));

  return (products || [])
    .filter((product) => Number(product.id) !== Number(activeProductId) && !cartIds.has(Number(product.id)))
    .slice(0, 3);
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setCurrentSrc(src || fallbackSrc);
    setFailed(false);
    setLoaded(false);
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

  return (
    <div className="guarded-image-shell">
      {!loaded && <div className="skeleton guarded-image-skeleton" />}
      <img
        loading={loading}
        fetchPriority={fetchPriority}
        src={currentSrc}
        alt={alt}
        className={className}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
  );
}

function PromoDealBadge({ locale, currency, curSym, displayVal }) {
  if (locale === 'he') {
    return (
      <span className="deal-badge" dir="rtl">
        <bdi className="deal-badge-text deal-badge-text-rtl">
          <span className="deal-badge-token deal-badge-token-count">3</span>
          <span className="deal-badge-token">פריטים</span>
          <span className="deal-badge-token">ב-229₪</span>
        </bdi>
      </span>
    );
  }

  return (
    <span className="deal-badge">
      <span className="deal-badge-text">
        <span className="deal-badge-token">3 items</span>
        <span className="deal-badge-token">for</span>
        <span className="deal-badge-token">{curSym}{displayVal(BUNDLE_ITEM_PRICE).toFixed(2)}</span>
      </span>
    </span>
  );
}

function ProductDetailPage({ productId, addToCart, goToCheckout, showToast, t, currency, curSym, locale, cartCount, onOpenCart }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('');
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const mainCtaRef = useRef(null);
  const mobileCarouselRef = useRef(null);

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
        const orderedSizes = getOrderedDisplaySizes(data.sizes || []);
        if (orderedSizes.length > 0) setSelectedSize(orderedSizes[0]);
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
  const orderedDisplaySizes = useMemo(() => getOrderedDisplaySizes(productSizes), [productSizes]);

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
        && (SIZE_RANK[normalizeSizeLabel(variant.size)] || Number.MAX_SAFE_INTEGER) <= MAX_ALLOWED_SIZE_RANK
      ) {
        sizes.add(normalizeSizeLabel(variant.size));
      }
    });
    return sizes;
  }, [productVariants, selectedColor]);

  useEffect(() => {
    if (!selectedColor || orderedDisplaySizes.length === 0) return;
    if (availableSizesForColor.size === 0) return;

    if (!availableSizesForColor.has(selectedSize)) {
      const fallbackSize = orderedDisplaySizes.find((size) => availableSizesForColor.has(size));
      if (fallbackSize) setSelectedSize(fallbackSize);
    }
  }, [selectedColor, selectedSize, availableSizesForColor, orderedDisplaySizes]);

  const activeImages = useMemo(() => {
    if (!product) return [];
    if (product.imagesByColor && product.imagesByColor[selectedColor] && product.imagesByColor[selectedColor].length > 0) {
      return product.imagesByColor[selectedColor].map((entry) => entry.src || entry);
    }
    if (product.images && product.images.length > 0) {
      return product.images.map((entry) => entry.src || entry);
    }
    return [product.imageUrl || GLOBAL_IMAGE_FALLBACK];
  }, [product, selectedColor]);

  useEffect(() => {
    setActiveImageIndex(0);
    if (mobileCarouselRef.current) mobileCarouselRef.current.scrollLeft = 0;
  }, [selectedColor, productId]);

  const goToImage = (index) => {
    const boundedIndex = Math.max(0, Math.min(index, activeImages.length - 1));
    setActiveImageIndex(boundedIndex);
    if (isMobileViewport && mobileCarouselRef.current) {
      const viewportWidth = mobileCarouselRef.current.clientWidth;
      mobileCarouselRef.current.scrollTo({ left: viewportWidth * boundedIndex, behavior: 'smooth' });
    }
  };

  const handleMobileScroll = () => {
    if (!mobileCarouselRef.current) return;
    const viewportWidth = mobileCarouselRef.current.clientWidth || 1;
    const nextIndex = Math.round(mobileCarouselRef.current.scrollLeft / viewportWidth);
    if (nextIndex !== activeImageIndex) setActiveImageIndex(nextIndex);
  };

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
  const isOutOfStock = selectedVariantStock === 0 || (selectedVariant && Number(selectedVariant.isAvailable) === 0);
  const isLowStock = selectedVariantStock !== null && selectedVariantStock > 0 && selectedVariantStock < LOW_STOCK_THRESHOLD;

  if (loading) {
    return (
      <div className="container pdp-skeleton-layout">
        <div className="skeleton pdp-skeleton-gallery" />
        <div className="pdp-skeleton-meta">
          <div className="skeleton pdp-skeleton-line" />
          <div className="skeleton pdp-skeleton-line short" />
          <div className="skeleton pdp-skeleton-line" />
        </div>
      </div>
    );
  }
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
    }, { openCart: mode !== 'buy', quantity: selectedQty, onAdded: mode === 'buy' ? () => goToCheckout() : null });

    return true;
  };

  const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / 3.75)) : product.price;

  return (
    <>
      <header className="header container">
        <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        <button className="cart-btn cart-btn-pill" aria-label={t('open_cart_aria')} onClick={onOpenCart}>
          <span>🛒 {t('cart')}</span>
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </button>
      </header>
      <div className="container pdp-container">
        <div className="pdp-images">
          {isMobileViewport ? (
            <div className="pdp-mobile-gallery">
              <div className="pdp-mobile-carousel" ref={mobileCarouselRef} onScroll={handleMobileScroll}>
                {activeImages.map((imgSrc, i) => (
                  <div className="pdp-mobile-slide" key={`${selectedColor}-${i}-${imgSrc}`}>
                    <GuardedProductImage
                      src={imgSrc}
                      alt={`${product.title} view ${i + 1}`}
                      className="pdp-image"
                      loading={i === 0 ? 'eager' : 'lazy'}
                      fetchPriority={i === 0 ? 'high' : 'auto'}
                    />
                  </div>
                ))}
              </div>
              <div className="pdp-carousel-dots">
                {activeImages.map((_, i) => (
                  <button
                    key={`dot-${i}`}
                    type="button"
                    className={`pdp-dot ${activeImageIndex === i ? 'active' : ''}`}
                    onClick={() => goToImage(i)}
                    aria-label={`Show image ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="pdp-main-image-frame">
                <GuardedProductImage
                  src={activeImages[activeImageIndex] || product.imageUrl}
                  alt={`${product.title} active view`}
                  className="pdp-image"
                  loading="eager"
                  fetchPriority="high"
                />
              </div>
              <div className="pdp-thumbnail-row">
                {activeImages.map((imgSrc, i) => (
                  <button
                    key={`thumb-${i}-${imgSrc}`}
                    type="button"
                    className={`pdp-thumb-btn ${activeImageIndex === i ? 'active' : ''}`}
                    onClick={() => goToImage(i)}
                  >
                    <GuardedProductImage src={imgSrc} alt={`${product.title} thumbnail ${i + 1}`} className="pdp-thumb-img" />
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="pdp-purchase-panel">
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

            {orderedDisplaySizes.length > 0 && (
              <div className="pdp-section">
                <h3>{t('size')}</h3>
                {isOutOfStock && <div className="low-stock-badge out-of-stock">{locale === 'he' ? 'אזל מהמלאי' : 'Out of stock'}</div>}
                {!isOutOfStock && isLowStock && <div className="low-stock-badge">{t('low_stock')}</div>}
                <div className="pdp-options premium-size-grid">
                  {orderedDisplaySizes.map((sizeOption) => {
                    const unavailable = availableSizesForColor.size > 0 && !availableSizesForColor.has(sizeOption);
                    return (
                      <button
                        key={sizeOption}
                        className={`size-btn ${selectedSize === sizeOption ? 'active' : ''}`}
                        disabled={unavailable}
                        onClick={() => setSelectedSize(sizeOption)}
                      >
                        {sizeOption}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pdp-section">
              <h3>{t('quantity')}</h3>
              <div className="pdp-qty-row">
                <button type="button" onClick={() => setSelectedQty((prev) => Math.max(1, prev - 1))}>−</button>
                <span>{selectedQty}</span>
                <button type="button" onClick={() => setSelectedQty((prev) => Math.min(10, prev + 1))}>+</button>
              </div>
            </div>

            <button ref={mainCtaRef} className="checkout-btn add-to-cart-large" onClick={() => handleAdd('cart')}>
              {t('add_to_cart')}
            </button>
            <button className="buy-now-inline" onClick={() => handleAdd('buy')}>
              {t('buy_now')}
            </button>

            <div className="trust-badges">
              <div className="trust-badge-item">
                <div className="trust-badge-icon">🔒</div>
                <div className="trust-badge-text">{t('trust_secure')}</div>
              </div>
              <div className="trust-badge-item">
                <div className="trust-badge-icon">⚡</div>
                <div className="trust-badge-text">{t('trust_shipping')}</div>
              </div>
              <div className="trust-badge-item">
                <div className="trust-badge-icon">↩️</div>
                <div className="trust-badge-text">{t('trust_returns')}</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="pdp-info-wrapper">
          <div className="pdp-info">
            <h1>{getProductTitle(product.title, locale)}</h1>

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
  const [paymentMethod, setPaymentMethod] = useState('paypal')
  const [paypalClientId, setPaypalClientId] = useState(import.meta.env.VITE_PAYPAL_CLIENT_ID || '')
  const [isPayPalProcessing, setIsPayPalProcessing] = useState(false)
  const [checkoutForm, setCheckoutForm] = useState({
    customerName: '',
    customerEmail: '',
    address: ''
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeCoupon, setActiveCoupon] = useState(null)
  const [quickAddProduct, setQuickAddProduct] = useState(null)
  const [quickAddColor, setQuickAddColor] = useState('')
  const [quickAddSize, setQuickAddSize] = useState('')
  const [quickAddQuantity, setQuickAddQuantity] = useState(1)
  const [isQuickAddLoading, setIsQuickAddLoading] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  const [locale, setLocale] = useState(() => {
    try {
      return localStorage.getItem('drip_street_locale') || 'he';
    } catch {
      return 'he';
    }
  })
  const [currency, setCurrency] = useState(() => {
    try {
      return localStorage.getItem('drip_street_currency') || 'ILS';
    } catch {
      return 'ILS';
    }
  })
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
  const [cartBadgePulse, setCartBadgePulse] = useState(false);

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
        setPaymentMethod('paypal');

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

    fetch(`${API_BASE}/api/paypal/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.clientId) setPaypalClientId(data.clientId);
      })
      .catch((err) => {
        console.warn('PayPal config fallback applied:', err);
      });

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
    const handleOpenCart = () => openCartDrawer();
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

  const openCartDrawer = () => {
    setIsCartOpen(true);
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => setIsCartOpen(true));
    }
  };

  const closeCartDrawer = () => setIsCartOpen(false);
  const openMobileNav = () => setIsMobileNavOpen(true);
  const closeMobileNav = () => setIsMobileNavOpen(false);

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

  const categories = useMemo(() => buildDynamicCategories(products), [products])

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory = activeCategory === 'All' || deriveProductCategory(p) === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [products, searchQuery, activeCategory])

  const cartRecommendations = useMemo(
    () => getRecommendationProducts(products, cart, quickAddProduct?.id || null),
    [products, cart, quickAddProduct]
  )

  const quickAddAvailableSizes = useMemo(() => {
    if (!quickAddProduct || !quickAddColor) return [];
    const variants = Array.isArray(quickAddProduct.variants) ? quickAddProduct.variants : [];
    if (variants.length === 0) {
      return getOrderedDisplaySizes(Array.isArray(quickAddProduct.sizes) ? quickAddProduct.sizes : []);
    }
    const sizes = variants
      .filter((variant) => normalizeValue(variant.color) === normalizeValue(quickAddColor) && variant.size && Number(variant.isEnabled) !== 0 && Number(variant.isAvailable) !== 0)
      .map((variant) => variant.size);
    return getOrderedDisplaySizes(Array.from(new Set(sizes)));
  }, [quickAddProduct, quickAddColor]);

  const quickAddActiveImage = useMemo(() => {
    if (!quickAddProduct) return GLOBAL_IMAGE_FALLBACK;

    const imagesByColor = quickAddProduct.imagesByColor && typeof quickAddProduct.imagesByColor === 'object'
      ? quickAddProduct.imagesByColor
      : null;

    if (imagesByColor) {
      const matchingColorEntry = Object.entries(imagesByColor).find(([colorName]) => (
        normalizeValue(colorName) === normalizeValue(quickAddColor)
      ));

      if (matchingColorEntry && Array.isArray(matchingColorEntry[1]) && matchingColorEntry[1].length > 0) {
        const preferredImage = matchingColorEntry[1][0];
        return preferredImage?.src || preferredImage || quickAddProduct.imageUrl || GLOBAL_IMAGE_FALLBACK;
      }
    }

    const matchedVariant = findMatchingVariant(quickAddProduct.variants, quickAddColor, quickAddSize)
      || findFirstAvailableVariantForColor(quickAddProduct.variants, quickAddColor);

    return matchedVariant?.imageUrl || quickAddProduct.imageUrl || GLOBAL_IMAGE_FALLBACK;
  }, [quickAddColor, quickAddProduct, quickAddSize]);

  useEffect(() => {
    if (!quickAddProduct) return;
    if (!quickAddAvailableSizes.length) return;
    if (!quickAddAvailableSizes.includes(quickAddSize)) {
      setQuickAddSize(quickAddAvailableSizes[0]);
    }
  }, [quickAddProduct, quickAddSize, quickAddAvailableSizes]);

  const closeQuickAdd = () => {
    setQuickAddProduct(null);
    setQuickAddColor('');
    setQuickAddSize('');
    setQuickAddQuantity(1);
    setIsQuickAddLoading(false);
  };

  const openQuickAdd = async (product) => {
    if (!product) return;
    setIsQuickAddLoading(true);
    let resolvedProduct = product;

    const hasDetailedVariants = Array.isArray(product.variants) && product.variants.length > 0;
    if (!hasDetailedVariants) {
      try {
        const response = await fetch(`${API_BASE}/api/products/${product.id}`);
        if (response.ok) {
          const detail = await response.json();
          if (detail && detail.id) resolvedProduct = detail;
        }
      } catch (error) {
        console.error('Failed to fetch product variants for quick add:', error);
      }
    }

    const defaultVariant = Array.isArray(resolvedProduct.variants) && resolvedProduct.variants.length > 0
      ? resolvedProduct.variants.find((variant) => Number(variant.isEnabled) !== 0 && Number(variant.isAvailable) !== 0)
      : null;
    const defaultColor = defaultVariant?.color || resolvedProduct.colors?.[0]?.name || '';
    const variants = Array.isArray(resolvedProduct.variants) ? resolvedProduct.variants : [];
    let defaultSize = getOrderedDisplaySizes(resolvedProduct.sizes || [])[0] || '';

    if (defaultColor && variants.length > 0) {
      const preferred = findFirstAvailableVariantForColor(variants, defaultColor);
      if (preferred?.size) defaultSize = preferred.size;
    }

    setQuickAddProduct(resolvedProduct);
    setQuickAddColor(defaultColor);
    setQuickAddSize(defaultSize);
    setQuickAddQuantity(1);
    setIsQuickAddLoading(false);
  };

  const submitQuickAdd = () => {
    if (!quickAddProduct) return;

    const variants = Array.isArray(quickAddProduct.variants) ? quickAddProduct.variants : [];
    let variantId = null;
    let nextPrice = quickAddProduct.price;

    if (variants.length > 0) {
      const matchedVariant = findMatchingVariant(variants, quickAddColor, quickAddSize);
      if (!matchedVariant || !matchedVariant.id) {
        showToast(t('select_available_variant'));
        return;
      }
      variantId = matchedVariant.id;
      if (Number.isFinite(Number(matchedVariant.price))) {
        nextPrice = Number(matchedVariant.price);
      }
    }

    const variantTitle = [quickAddProduct.title];
    if (quickAddColor) variantTitle.push(quickAddColor);
    if (quickAddSize) variantTitle.push(quickAddSize);

    addToCart({
      ...quickAddProduct,
      price: nextPrice,
      baseTitle: quickAddProduct.title,
      title: variantTitle.join(' - '),
      cartId: `${quickAddProduct.id}-${quickAddColor}-${quickAddSize}`,
      selectedColor: quickAddColor,
      selectedSize: quickAddSize,
      variantId,
    }, { openCart: true, quantity: quickAddQuantity });

    closeQuickAdd();
  };

  const updateCartVariant = (cartId, nextColor, nextSize) => {
    const currentItem = cart.find((item) => (item.cartId || `${item.id}`) === cartId);
    if (!currentItem) return;

    const variants = Array.isArray(currentItem.variants) ? currentItem.variants : [];
    if (variants.length === 0) return;

    const matchedVariant = findMatchingVariant(variants, nextColor, nextSize);
    if (!matchedVariant || !matchedVariant.id) {
      showToast(t('select_available_variant'));
      return;
    }

    const parsed = splitVariantTitle(currentItem.title);
    const baseTitle = currentItem.baseTitle || parsed.base;
    const nextCartId = `${currentItem.id}-${nextColor}-${nextSize}`;
    const nextTitle = [baseTitle, nextColor, nextSize].filter(Boolean).join(' - ');
    const nextPrice = Number.isFinite(Number(matchedVariant.price)) ? Number(matchedVariant.price) : currentItem.price;

    setCart((prevCart) => {
      const currentIndex = prevCart.findIndex((item) => (item.cartId || `${item.id}`) === cartId);
      if (currentIndex < 0) return prevCart;

      const duplicateIndex = prevCart.findIndex((item, idx) => idx !== currentIndex && (item.cartId || `${item.id}`) === nextCartId);
      if (duplicateIndex >= 0) {
        const merged = [...prevCart];
        merged[duplicateIndex] = {
          ...merged[duplicateIndex],
          quantity: (merged[duplicateIndex].quantity || 0) + (merged[currentIndex].quantity || 0),
        };
        merged.splice(currentIndex, 1);
        return merged;
      }

      const nextCart = [...prevCart];
      nextCart[currentIndex] = {
        ...nextCart[currentIndex],
        baseTitle,
        title: nextTitle,
        selectedColor: nextColor,
        selectedSize: nextSize,
        variantId: matchedVariant.id,
        cartId: nextCartId,
        price: nextPrice,
      };
      return nextCart;
    });
  };

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
    closeCartDrawer();
    window.history.pushState({}, '', '/checkout');
    window.dispatchEvent(new Event('popstate'));
  };

  const addToCart = (product, options = {}) => {
    const { openCart = true, onAdded, quantity = 1 } = options;
    const incrementBy = Math.max(1, Number(quantity) || 1);
    const cartId = product.cartId || `${product.id}`;
    setCart((prevCart) => {
      const existing = prevCart.find(item => (item.cartId || `${item.id}`) === cartId);
      const nextCart = existing
        ? prevCart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: item.quantity + incrementBy } : item))
        : [...prevCart, { ...product, cartId, quantity: incrementBy }];

      if (typeof onAdded === 'function') {
        setTimeout(() => onAdded(nextCart), 0);
      }

      return nextCart;
    });
    setCartBadgePulse(true);
    setTimeout(() => setCartBadgePulse(false), 360);
    if (openCart) {
      openCartDrawer();
      setTimeout(openCartDrawer, 24);
    }
  }

  const removeFromCart = (cartId) => {
    setCart((prevCart) => prevCart.filter(item => (item.cartId || `${item.id}`) !== cartId))
  }

  const updateQuantity = (cartId, newQty) => {
    if (newQty <= 0) return removeFromCart(cartId);
    setCart((prevCart) => prevCart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: newQty } : item)))
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
    closeCartDrawer();
    window.history.pushState({}, '', '/checkout');
    window.dispatchEvent(new Event('popstate'));
  }

  const hasInvalidVariant = cart.some((item) => (
    item.selectedColor
    && item.selectedSize
    && (!item.variantId || Number.isNaN(Number(item.variantId)))
  ));

  const isCheckoutFormValid = checkoutForm.customerName.trim()
    && checkoutForm.customerEmail.trim()
    && checkoutForm.address.trim();

  const buildCheckoutPayload = () => ({
    customerName: checkoutForm.customerName.trim(),
    customerEmail: checkoutForm.customerEmail.trim(),
    address: checkoutForm.address.trim(),
    items: cart,
    totalAmount: cartTotal,
    bundleCount: BUNDLE_ITEM_COUNT,
    bundlePrice: BUNDLE_ITEM_PRICE,
    shippingCost: shippingCost,
    bundleDiscount: bundleDiscount,
    couponCode: activeCoupon ? activeCoupon.code : null,
    currency,
  });

  const createPayPalOrder = async () => {
    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      throw new Error('Variant mismatch');
    }

    if (!isCheckoutFormValid) {
      showToast(t('shipping_details'));
      throw new Error('Missing shipping details');
    }

    const response = await fetch(`${API_BASE}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCheckoutPayload())
    });

    const data = await response.json();
    if (!response.ok || !data.orderID) {
      throw new Error(data.error || 'Failed to create PayPal order');
    }

    return data.orderID;
  };

  const capturePayPalOrder = async (orderID) => {
    const response = await fetch(`${API_BASE}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to capture PayPal order');
    }

    return data;
  };

  const submitCheckout = async (e) => {
    e.preventDefault();

    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      return;
    }

    try {
      const endpoint = paymentMethod === 'stripe' ? '/api/checkout/stripe' : '/api/checkout/payplus';
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCheckoutPayload())
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
            <input
              name="customerName"
              type="text"
              placeholder={t('full_name')}
              required
              value={checkoutForm.customerName}
              onChange={(e) => setCheckoutForm((prev) => ({ ...prev, customerName: e.target.value }))}
            />
            <input
              name="customerEmail"
              type="email"
              placeholder={t('email')}
              required
              value={checkoutForm.customerEmail}
              onChange={(e) => setCheckoutForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
            />
            <input
              name="address"
              type="text"
              placeholder={t('address')}
              required
              value={checkoutForm.address}
              onChange={(e) => setCheckoutForm((prev) => ({ ...prev, address: e.target.value }))}
            />
            
            <h3 style={{ marginTop: '24px' }}>{t('payment_method')}</h3>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="paypal" checked={paymentMethod === 'paypal'} onChange={() => setPaymentMethod('paypal')} />
                {t('payment_paypal')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="payplus" checked={paymentMethod === 'payplus'} onChange={() => setPaymentMethod('payplus')} />
                {t('payment_card_bit')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} />
                {t('payment_stripe')}
              </label>
            </div>
            {paymentMethod === 'paypal' ? (
              paypalClientId ? (
                <PayPalScriptProvider options={{ 'client-id': paypalClientId, currency, intent: 'capture' }}>
                  <PayPalButtons
                    style={{ layout: 'vertical', label: 'paypal' }}
                    forceReRender={[currency, cartTotal, paypalClientId]}
                    createOrder={async () => {
                      setIsPayPalProcessing(true);
                      try {
                        const orderID = await createPayPalOrder();
                        return orderID;
                      } catch (err) {
                        showToast(err.message || GLOBAL_ERROR_TOAST_HE);
                        throw err;
                      } finally {
                        setIsPayPalProcessing(false);
                      }
                    }}
                    onApprove={async (data) => {
                      setIsPayPalProcessing(true);
                      try {
                        await capturePayPalOrder(data.orderID);
                        localStorage.removeItem('drip_street_cart');
                        setCart([]);
                        window.history.pushState({}, '', '/success');
                        window.dispatchEvent(new Event('popstate'));
                      } catch (err) {
                        showToast(err.message || GLOBAL_ERROR_TOAST_HE);
                      } finally {
                        setIsPayPalProcessing(false);
                      }
                    }}
                    onError={() => {
                      showToast(GLOBAL_ERROR_TOAST_HE);
                    }}
                    disabled={isPayPalProcessing || !isCheckoutFormValid || cart.length === 0}
                  />
                </PayPalScriptProvider>
              ) : (
                <p style={{ color: '#ff6b6b', marginBottom: '16px' }}>PayPal is not configured yet. Please try again in a moment.</p>
              )
            ) : (
              <button type="submit" className="checkout-btn">{t('complete_order')} – {curSym}{displayVal(cartTotal).toFixed(2)}</button>
            )}
          </form>
          
          <div style={{ flex: '1', minWidth: '300px', backgroundColor: '#111', padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
            <h3>{t('order_summary')}</h3>
            <div className="checkout-review-card">
              <h4>{t('review_title')}</h4>
              <p>{t('review_subtitle')}</p>
            </div>
            {cart.map(item => {
              const itemPrice = currency === 'USD' ? (item.priceUSD || (item.price / exchangeRate)) : item.price;
              const parsed = splitVariantTitle(item.title);
              return (
                <div key={item.cartId || item.id} className="checkout-review-line">
                  <div>
                    <span>{item.quantity}x {getProductTitle(parsed.base, locale)}</span>
                    {(parsed.color || parsed.size) && (
                      <small>
                        {parsed.color ? `${t('color')}: ${localizeColorName(parsed.color, locale)}` : ''}
                        {parsed.color && parsed.size ? ' • ' : ''}
                        {parsed.size ? `${t('size')}: ${parsed.size}` : ''}
                      </small>
                    )}
                  </div>
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
    return <ProductDetailPage productId={productId} addToCart={addToCart} goToCheckout={goToCheckoutNow} showToast={showToast} t={t} currency={currency} curSym={curSym} locale={locale} cartCount={totalItems} onOpenCart={openCartDrawer} />;
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

      <header className="header container storefront-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="header-leading">
          <button className="nav-toggle" type="button" aria-label="Open navigation" onClick={openMobileNav}>
            <span />
            <span />
            <span />
          </button>
          <a href="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new Event('popstate')); }}><h1 className="logo">{t('logo')}</h1></a>
        </div>
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
          <button className="locale-toggle-btn" title={t('language_currency')} onClick={() => {
            const nextLocale = locale === 'he' ? 'en' : 'he';
            const nextCurrency = locale === 'he' ? 'USD' : 'ILS';
            const nextRate = locale === 'he' ? 3.75 : 3.75;
            setLocale(nextLocale);
            setCurrency(nextCurrency);
            setExchangeRate(nextRate);
            localStorage.setItem('drip_street_locale', nextLocale);
            localStorage.setItem('drip_street_currency', nextCurrency);
          }}>
            {locale === 'he' ? '🇬🇧 EN / USD' : '🇮🇱 HE / ILS'}
          </button>
          <button className="cart-btn cart-btn-pill" aria-label={t('open_cart_aria')} onClick={openCartDrawer}>
            <span>🛒 {t('cart')}</span>
            {totalItems > 0 && <span className={`cart-badge ${cartBadgePulse ? 'pulse' : ''}`}>{totalItems}</span>}
          </button>
        </div>
      </header>

      <div className={`side-nav-overlay ${isMobileNavOpen ? 'open' : ''}`} onClick={closeMobileNav}>
        <aside className="side-nav-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="side-nav-header">
            <strong>{t('logo')}</strong>
            <button type="button" className="side-nav-close" onClick={closeMobileNav} aria-label="Close navigation">×</button>
          </div>
          <button className="locale-toggle-btn mobile-nav-locale" title={t('language_currency')} onClick={() => {
            const nextLocale = locale === 'he' ? 'en' : 'he';
            const nextCurrency = locale === 'he' ? 'USD' : 'ILS';
            const nextRate = locale === 'he' ? 3.75 : 3.75;
            setLocale(nextLocale);
            setCurrency(nextCurrency);
            setExchangeRate(nextRate);
            localStorage.setItem('drip_street_locale', nextLocale);
            localStorage.setItem('drip_street_currency', nextCurrency);
          }}>
            {locale === 'he' ? '🇬🇧 English / USD' : '🇮🇱 עברית / ILS'}
          </button>
          <div className="side-nav-links">
            {categories.map((cat) => (
              <button
                key={`drawer-${cat}`}
                type="button"
                className={`side-nav-link ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat)
                  closeMobileNav()
                }}
              >
                {cat === 'All' ? t('all') : cat === 'New Arrivals' ? t('new_arrivals') : cat === 'Hoodies' ? t('hoodies') : cat === 'Shirts' ? t('tshirts') : cat === 'Tank Tops' ? t('tank_tops') : cat}
              </button>
            ))}
          </div>
        </aside>
      </div>

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
          <motion.div className="hero-cta-group" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}>
            <button className="hero-cta-primary" onClick={() => { setActiveCategory('All'); const elem = document.querySelector('.categories-nav'); if(elem) elem.scrollIntoView({ behavior: 'smooth' }); }}>
              {t('shop_now')}
            </button>
            <button className="hero-cta-secondary" onClick={() => { setActiveCategory('Shirts'); const elem = document.querySelector('.categories-nav'); if(elem) elem.scrollIntoView({ behavior: 'smooth' }); }}>
              {t('best_sellers')}
            </button>
          </motion.div>
        </div>
      </section>

      <main className="container">
        <div className="categories-nav">
          {categories.map(cat => {
            const catKeys = {
              'All': 'all',
              'New Arrivals': 'new_arrivals',
              'Hoodies': 'hoodies',
              'Shirts': 'tshirts',
              'Tank Tops': 'tank_tops'
            };
            return (
              <button 
                key={cat} 
                className={`cat-btn ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {catKeys[cat] ? t(catKeys[cat]) : cat}
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
                      {isTeeProduct(product) && <PromoDealBadge locale={locale} currency={currency} curSym={curSym} displayVal={displayVal} />}
                    </div>
                    <div className="product-card-content">
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
                      <div className="product-card-actions">
                        <button className="add-to-cart" aria-label={`${t('add_to_cart')} ${getProductTitle(product.title, locale)}`} onClick={() => openQuickAdd(product)}>
                          {t('add_to_cart')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      <AnimatePresence>
        {quickAddProduct && (
          <motion.div
            className="quick-config-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeQuickAdd}
          >
            <motion.div
              className="quick-config-modal"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              transition={{ duration: 0.22 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button className="quick-config-close" onClick={closeQuickAdd} aria-label={t('close_cart_aria')}>×</button>
              <div className="quick-config-head">
                <h3>{t('configure_product_title')}</h3>
                <p>{t('configure_product_subtitle')}</p>
              </div>

              <div className="quick-config-product">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={quickAddActiveImage}
                    src={quickAddActiveImage}
                    alt={quickAddProduct.title}
                    onError={(e) => setImageFallback(e)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: 'easeOut' }}
                    className="quick-config-product-image"
                  />
                </AnimatePresence>
                <div>
                  <strong>{getProductTitle(quickAddProduct.title, locale)}</strong>
                  <span>{curSym}{displayVal(quickAddProduct.price).toFixed(2)}</span>
                </div>
              </div>

              {isQuickAddLoading ? (
                <p>{t('loading')}</p>
              ) : (
                <>
                  {Array.isArray(quickAddProduct.colors) && quickAddProduct.colors.length > 0 && (
                    <div className="quick-config-group">
                      <label>{t('choose_color')}</label>
                      <div className="quick-config-swatches">
                        {quickAddProduct.colors.map((colorOption) => (
                          <button
                            key={colorOption.name}
                            type="button"
                            className={`quick-swatch ${normalizeValue(quickAddColor) === normalizeValue(colorOption.name) ? 'active' : ''}`}
                            style={{ backgroundColor: colorOption.hex }}
                            onClick={() => {
                              setQuickAddColor(colorOption.name)
                              const fallbackVariant = findFirstAvailableVariantForColor(quickAddProduct.variants, colorOption.name)
                              if (fallbackVariant?.size) {
                                setQuickAddSize(normalizeSizeLabel(fallbackVariant.size))
                              }
                            }}
                            title={localizeColorName(colorOption.name, locale)}
                            aria-label={`${t('color')} ${localizeColorName(colorOption.name, locale)}`}
                            aria-pressed={normalizeValue(quickAddColor) === normalizeValue(colorOption.name)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {quickAddAvailableSizes.length > 0 && (
                    <div className="quick-config-group">
                      <label>{t('choose_size')}</label>
                      <div className="quick-config-sizes">
                        {getOrderedDisplaySizes(quickAddAvailableSizes).map((sizeOption) => (
                          <button
                            key={sizeOption}
                            type="button"
                            className={`quick-size-btn ${quickAddSize === sizeOption ? 'active' : ''}`}
                            onClick={() => setQuickAddSize(sizeOption)}
                          >
                            {sizeOption}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="quick-config-group">
                    <label htmlFor="quick-add-qty">{t('choose_quantity')}</label>
                    <select
                      id="quick-add-qty"
                      value={quickAddQuantity}
                      onChange={(e) => setQuickAddQuantity(Number(e.target.value) || 1)}
                    >
                      {Array.from({ length: 10 }, (_, index) => index + 1).map((qty) => (
                        <option key={`quick-qty-${qty}`} value={qty}>{qty}</option>
                      ))}
                    </select>
                  </div>

                  <div className="quick-config-actions">
                    <button type="button" className="quick-config-secondary" onClick={closeQuickAdd}>{t('continue_shopping')}</button>
                    <button type="button" className="quick-config-primary" onClick={submitQuickAdd}>{t('add_selected_to_cart')}</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
      <div className={`cart-overlay ${isCartOpen ? 'open' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) closeCartDrawer(); }}>
        <div className="cart-panel" onClick={(event) => event.stopPropagation()}>
          <div className="cart-header">
            <h2>{t('cart')} ({totalItems})</h2>
            <button className="close-cart" aria-label={t('close_cart_aria')} onClick={closeCartDrawer}>×</button>
          </div>

          <div className="cart-scroll-region">
            {bundleActive ? (
              <div className="bundle-banner active">{t('bundle_active')}</div>
            ) : totalItems === 2 ? (
              <div className="bundle-banner hint">{t('bundle_hint')}</div>
            ) : null}

            <div className="cart-items">
              {cart.map(item => {
                const itemPrice = getCartUnitPrice(item, currency, exchangeRate);
                const parsed = splitVariantTitle(item.title);
                const itemVariants = Array.isArray(item.variants) ? item.variants : [];
                const itemColors = Array.isArray(item.colors) ? item.colors : [];
                const selectedColor = item.selectedColor || parsed.color || itemColors[0]?.name || '';
                const sizesByColor = itemVariants.length > 0
                  ? Array.from(new Set(itemVariants.filter((variant) => variant.color === selectedColor && variant.size).map((variant) => normalizeSizeLabel(variant.size))))
                  : (Array.isArray(item.sizes) ? item.sizes : []);
                const itemSizes = sizesByColor.length > 0
                  ? getOrderedDisplaySizes(sizesByColor)
                  : getOrderedDisplaySizes(Array.isArray(item.sizes) ? item.sizes : []);
                const selectedSize = normalizeSizeLabel(item.selectedSize || parsed.size || itemSizes[0] || '');
                
                return (
                  <div key={item.cartId || item.id} className="cart-item">
                    <div style={{ flex: 1 }}>
                      <strong>{getCartDisplayTitle(item.title, locale)}</strong>
                      {itemVariants.length > 0 && itemColors.length > 0 && (
                        <div className="cart-variant-editor">
                          <span>{t('cart_customize')}</span>
                          <div className="cart-variant-grid">
                            <label>
                              {t('color')}
                              <select
                                value={selectedColor}
                                onChange={(e) => updateCartVariant(item.cartId || `${item.id}`, e.target.value, selectedSize)}
                              >
                                {itemColors.map((colorOption) => (
                                  <option key={colorOption.name} value={colorOption.name}>
                                    {localizeColorName(colorOption.name, locale)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {t('size')}
                              <select
                                value={selectedSize}
                                onChange={(e) => updateCartVariant(item.cartId || `${item.id}`, selectedColor, e.target.value)}
                              >
                                {itemSizes.map((sizeOption) => (
                                  <option key={sizeOption} value={sizeOption}>
                                    {sizeOption}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}
                      <div className="cart-qty-controls">
                        <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity - 1)}>−</button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity + 1)}>+</button>
                        <button type="button" className="remove-btn" onClick={() => removeFromCart(item.cartId || `${item.id}`)}>🗑</button>
                      </div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{curSym}{(itemPrice * item.quantity).toFixed(2)}</div>
                  </div>
                );
              })}
              {cart.length === 0 && <p style={{color: '#666', textAlign: 'center', marginTop: '40px'}}>{t('cart_empty')}.</p>}
            </div>

            {cartRecommendations.length > 0 && (
              <div className="cart-recommendations">
                <div className="cart-recommendations-title">You Might Also Like</div>
                <div className="cart-recommendations-row">
                  {cartRecommendations.map((product) => {
                    const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / exchangeRate)) : product.price;

                    return (
                      <button
                        key={`rec-${product.id}`}
                        type="button"
                        className="cart-recommendation-card"
                        onClick={() => openQuickAdd(product)}
                      >
                        <img src={product.imageUrl} alt={product.title} onError={(e) => setImageFallback(e)} />
                        <strong>{getProductTitle(product.title, locale)}</strong>
                        <span>{curSym}{displayPrice.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="cart-footer">
            {totalItems > 0 && (
              <div className="shipping-progress cart-footer-progress">
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
            <button type="button" className="continue-shopping-btn" onClick={closeCartDrawer}>{t('continue_shopping')}</button>
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
