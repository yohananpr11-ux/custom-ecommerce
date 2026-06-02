import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { motion, AnimatePresence } from 'framer-motion'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom'
import { initAnalytics, trackPageView, trackViewItem } from './utils/analytics.js'
import './index.css'

// Shared Components
import Footer from './components/Footer'
import CookieConsent from './components/CookieConsent'
import BackButton from './components/BackButton'

// Compliance & Legal Pages
import PrivacyPolicy from './pages/PrivacyPolicy'
import Terms from './pages/Terms'
import RefundPolicy from './pages/RefundPolicy'
import Shipping from './pages/Shipping'
import ContactUs from './pages/ContactUs'
import About from './pages/About'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://custom-ecommerce-qp30.onrender.com').replace(/\/$/, '');
const MARKETING_ABANDONED_INTAKE_URL = `${API_BASE}/api/marketing/intake/abandoned-cart`;
const MARKETING_WELCOME_INTAKE_URL = `${API_BASE}/api/marketing/intake/welcome-flow`;
const ABANDONED_CART_TIMEOUT_MS = Number(import.meta.env.VITE_ABANDONED_CART_DELAY_MS || (12 * 60 * 1000));
const ABANDONED_CART_FINGERPRINT_KEY = 'drip_street_abandoned_cart_fingerprint_v1';
const CHECKOUT_COMPLETED_KEY = 'drip_street_checkout_completed_v1';
const SHIPPING_COST = 29.90;
const FREE_SHIPPING_THRESHOLD = 249;
const BUNDLE_ITEM_PRICE = 229;
const BUNDLE_ITEM_COUNT = 3;
const JEWELRY_UPSELL_MOCK = [
  {
    id: 'jewel-urban-chain',
    title: 'Urban Chain Necklace',
    subtitle: 'Stainless steel streetwear layering essential',
    price: 89,
    imageUrl: '/brand/drip-mark.png',
  },
  {
    id: 'jewel-statement-ring',
    title: 'Statement Signet Ring',
    subtitle: 'Mirror-polish finish with daily-wear comfort',
    price: 74,
    imageUrl: '/brand/drip-mark.png',
  },
  {
    id: 'jewel-twin-bracelet',
    title: 'Twin Link Bracelet',
    subtitle: 'Adjustable fit for stacked street looks',
    price: 68,
    imageUrl: '/brand/drip-mark.png',
  },
];

const isLikelyValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim().toLowerCase());

const normalizeMarketingItems = (items = []) => {
  if (!Array.isArray(items)) return [];

  return items.slice(0, 20).map((item, index) => ({
    id: item?.id ?? item?.productId ?? null,
    title: String(item?.title || item?.name || `Item ${index + 1}`).trim(),
    quantity: Math.max(1, Number(item?.quantity) || 1),
    price: Number(item?.price) || 0,
    selectedColor: item?.selectedColor || null,
    selectedSize: item?.selectedSize || null,
  }));
};

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
    if (this.state.hasError) return <div className="container" style={{padding: '100px 20px', textAlign: 'center'}}><h1>Temporary error</h1><p>Please refresh the page and try again.</p></div>;
    return this.props.children;
  }
}

const translations = {
  he: {
    logo: "DRIP STREET",
    announcement: "משלוח חינם בהזמנה מ-249 ₪ | 3 חולצות ב-229 ₪",
    search_placeholder: "חפש פריטים...",
    cart: "סל קניות",
    hero_title: "DRIP STREET",
    hero_subtitle: "סטריטוור מינימליסטי ליום יום.",
    shop_now: "קנה עכשיו",
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
    jewelry: "תכשיטים",
    fabric_fit: "חומר וגזרה",
    care_instructions: "טיפול",
    delivery_info: "משלוח",
    product_description: "תיאור",
    material_care: "חומרים וטיפול",
    shipping_returns: "משלוחים והחזרות",
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
    low_stock: "ביקוש גבוה - מלאי מוגבל",
    select_available_variant: "בחר צבע ומידה זמינים כדי להוסיף לסל",
    empty_cart_toast: "הסל ריק, הוסף פריטים כדי להמשיך",
    variant_error_toast: "נמצאה שגיאה בוריאנט. רענן את העמוד ובחר מחדש",
    checkout: "קופה",
    checkout_secure: "קופה מאובטחת",
    shipping_details: "פרטי משלוח",
    full_name: "שם מלא",
    email: "אימייל",
    address: "כתובת (רחוב, עיר, מיקוד)",
    shipping_name_english_only: "שם מלא חייב להיות באנגלית בלבד.",
    shipping_address_english_only: "כתובת משלוח חייבת להיות באנגלית בלבד כדי שהמשלוח יגיע נכון.",
    payment_method: "בחר תשלום",
    payment_card_apple_google: "כרטיס אשראי / Apple Pay / Google Pay",
    payment_card_bit: "כרטיס אשראי / ביט",
    payment_stripe: "כרטיס בינלאומי (Stripe)",
    payment_paypal: "PayPal",
    payment_meshulam_card: "כרטיס אשראי ישראלי",
    payment_meshulam_card_sub: "ויזה · מאסטרקארד · ישראכרט · Apple Pay",
    payment_meshulam_bit: "תשלום ב-Bit",
    payment_meshulam_bit_sub: "סריקת QR מהאפליקציה",
    payment_meshulam_processing: "מעביר אותך לעמוד תשלום מאובטח...",
    payment_unavailable: "אמצעי התשלום שבחרת לא זמין כרגע. נסה PayPal.",
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
    shipping_hint: "הוסף עוד {amount} למשלוח חינם",
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
    shop_rights: "© 2026 Drip Street. כל הזכויות שמורות.",
    popup_title: "הצטרפו למועדון שלנו וקבלו 10% הנחה לקנייה הראשונה.",
    popup_subtitle: "השאירו אימייל וקבלו קוד אישי חד פעמי.",
    popup_placeholder: "האימייל שלך...",
    popup_cta: "קבל את ההנחה",
    popup_dismiss: "לא עכשיו, תודה",
    popup_success: "תודה! הקוד נשלח לאימייל שלך.",
    popup_already_registered: "האימייל כבר רשום במערכת",
    popup_unique_code: "הקוד הייחודי שלך",
    popup_copy: "העתק קוד",
    popup_copied: "הועתק!",
    promo_code: "קוד קופון",
    promo_apply: "החל",
    promo_applied: "קוד הופעל",
    promo_invalid: "קוד לא תקין או שכבר נוצל",
    rating_label: "מבוסס על בסיס ביקורות",
    reviews_title: "מה אומרים הלקוחות",
    trending_title: "טרנדינג עכשיו",
    why_title: "למה DRIP STREET?",
    why_shipping: "משלוח לכל העולם",
    why_shipping_desc: "משלוח בינלאומי מהיר ואמין לכל יעד.",
    why_secure: "תשלום מאובטח 100%",
    why_secure_desc: "SSL מוצפן + Stripe, PayPal, ויזה.",
    why_quality: "איכות פרימיום",
    why_quality_desc: "בד נוח עם הדפסה חדה שלא דוהה.",
    why_returns: "אחריות איכות פרימיום",
    why_returns_desc: "הדפסה מושלמת. פריט פגום יוחלף מיד.",
    seo_title: "DRIP STREET | סטריטוור מינימליסטי",
    seo_description: "סטריטוור פרימיום מינימליסטי לחיי היומיום. חולצות אוברסייז, גופיות קיץ ובייסיקס איכותיים. משלוח לכל העולם.",
    taxes_shipping_note: "מסים ומשלוח יחושבו בקופה",
    payment_icons_label: "אנחנו מקבלים"
  },
  en: {
    logo: "DRIP STREET",
    announcement: "Complimentary shipping from 249 ILS cart subtotal | 3-item bundle from $61",
    search_placeholder: "Search items...",
    cart: "Cart",
    hero_title: "DRIP STREET",
    hero_subtitle: "Minimal streetwear built for confidence.",
    shop_now: "Shop Now",
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
    jewelry: "Jewelry",
    fabric_fit: "Fabric & Fit",
    care_instructions: "Care Instructions",
    delivery_info: "Delivery Info",
    product_description: "Description",
    material_care: "Material & Care",
    shipping_returns: "Shipping & Returns",
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
    low_stock: "High Demand - Limited Stock",
    select_available_variant: "Please select an available color and size",
    empty_cart_toast: "Your cart is empty, add items to continue",
    variant_error_toast: "Variant mismatch detected, refresh and select again",
    checkout: "Checkout",
    checkout_secure: "Secure Checkout",
    shipping_details: "Shipping Details",
    full_name: "Full Name",
    email: "Email Address",
    address: "Full Address (Street, City, Zip)",
    shipping_name_english_only: "Full name must be entered in English.",
    shipping_address_english_only: "Shipping address must be entered in English so Printify can deliver correctly.",
    payment_method: "Payment Method",
    payment_card_apple_google: "Credit Card / Apple Pay / Google Pay",
    payment_card_bit: "Card Payment",
    payment_stripe: "Stripe ($)",
    payment_paypal: "PayPal",
    payment_meshulam_card: "Credit Card (Israel)",
    payment_meshulam_card_sub: "Visa · Mastercard · Isracard · Apple Pay",
    payment_meshulam_bit: "Pay with Bit",
    payment_meshulam_bit_sub: "Scan QR from the Bit app",
    payment_meshulam_processing: "Redirecting to secure payment page...",
    payment_unavailable: "Selected payment method is unavailable right now. Please use PayPal.",
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
    shipping_hint: "Add {amount} more for free shipping!",
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
    shop_rights: "© 2026 Drip Street. All rights reserved.",
    popup_title: "Join our club and get 10% off your first purchase.",
    popup_subtitle: "Enter your email to unlock your unique one-time code.",
    popup_placeholder: "Your email address...",
    popup_cta: "Claim My Discount",
    popup_dismiss: "No thanks",
    popup_success: "Done! Your code is on its way.",
    popup_already_registered: "Already registered",
    popup_unique_code: "Your unique code",
    popup_copy: "Copy code",
    popup_copied: "Copied!",
    promo_code: "Coupon Code",
    promo_apply: "Apply",
    promo_applied: "Code applied",
    promo_invalid: "Promo code is invalid or already used",
    rating_label: "based on reviews",
    reviews_title: "What Customers Are Saying",
    trending_title: "Trending Now",
    why_title: "Why DRIP STREET?",
    why_shipping: "Worldwide Shipping",
    why_shipping_desc: "Fast, tracked international delivery to any destination.",
    why_secure: "100% Secure Checkout",
    why_secure_desc: "SSL-encrypted + Stripe, PayPal, and more.",
    why_quality: "Premium Quality",
    why_quality_desc: "Soft fabric with sharp, fade-resistant prints.",
    why_returns: "Premium Quality Guarantee",
    why_returns_desc: "Flawless prints. Defective items replaced immediately.",
    seo_title: "DRIP STREET | Minimalist Streetwear",
    seo_description: "Premium minimal streetwear built for confidence. Shop oversized tees, summer tanks, and high-quality basics. Worldwide shipping.",
    taxes_shipping_note: "Taxes and shipping calculated at checkout",
    payment_icons_label: "We accept"
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

const isJewelryProduct = (product = {}) => deriveProductCategory(product) === 'Jewelry';

const getSizeGuideContent = (product, locale) => {
  const jewelry = isJewelryProduct(product);

  if (jewelry) {
    return {
      title: locale === 'he' ? 'מדריך מידות לתכשיטים' : 'Jewelry Size Guide',
      subtitle: locale === 'he'
        ? 'בחר אורך שרשרת לפי נקודת הישיבה הרצויה על הצוואר והחזה.'
        : 'Choose your chain length based on where you want it to sit.',
      note: locale === 'he'
        ? 'למראה שכבות דרמטי, 22-24 אינץ׳ הם האורך המומלץ.'
        : 'For layered looks, 22-24 inches usually works best.',
      columns: locale === 'he'
        ? ['אורך', 'סגנון ישיבה', 'למי זה מתאים']
        : ['Length', 'Fit Style', 'Best For'],
      rows: [
        ['18" / 45cm', locale === 'he' ? 'צמוד לבסיס הצוואר' : 'Close neckline', locale === 'he' ? 'מראה נקי' : 'Clean minimal look'],
        ['20" / 50cm', locale === 'he' ? 'על עצם הבריח' : 'At collarbone', locale === 'he' ? 'אורך יומיומי' : 'Everyday classic'],
        ['22" / 55cm', locale === 'he' ? 'מתחת לעצם הבריח' : 'Below collarbone', locale === 'he' ? 'לוק סטריט' : 'Streetwear presence'],
        ['24" / 60cm', locale === 'he' ? 'אמצע חזה עליון' : 'Upper chest', locale === 'he' ? 'שכבות בולטות' : 'Layered statement'],
      ],
    };
  }

  return {
    title: locale === 'he' ? 'מדריך מידות לביגוד' : 'Apparel Size Guide',
    subtitle: locale === 'he'
      ? 'מדוד חולצה מועדפת והשווה לטבלה להתאמה מדויקת.'
      : 'Measure a favorite tee and compare for the best fit.',
    note: locale === 'he'
      ? 'אם אתה בין מידות, למראה אוברסייז בחר מידה אחת למעלה.'
      : 'Between sizes? Size up for an oversized silhouette.',
    columns: locale === 'he'
      ? ['מידה', 'חזה', 'אורך גוף', 'כתפיים']
      : ['Size', 'Chest', 'Body Length', 'Shoulders'],
    rows: [
      ['S', '96-101 cm', '69 cm', '43 cm'],
      ['M', '102-107 cm', '72 cm', '46 cm'],
      ['L', '108-113 cm', '75 cm', '49 cm'],
      ['XL', '114-119 cm', '78 cm', '52 cm'],
      ['2XL', '120-127 cm', '81 cm', '55 cm'],
    ],
  };
};

function SizeGuideModal({ product, locale, onClose }) {
  const guide = useMemo(() => getSizeGuideContent(product, locale), [product, locale]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="size-guide-overlay" onClick={onClose}>
      <div className="size-guide-modal" onClick={(event) => event.stopPropagation()} dir={locale === 'he' ? 'rtl' : 'ltr'}>
        <button type="button" className="size-guide-close" onClick={onClose} aria-label={locale === 'he' ? 'סגור חלון' : 'Close modal'}>×</button>
        <div className="size-guide-header">
          <span>{locale === 'he' ? 'מדריך מידות 📏' : 'Size Guide 📏'}</span>
          <h3>{guide.title}</h3>
          <p>{guide.subtitle}</p>
        </div>
        <div className="size-guide-table-wrap">
          <table className="size-guide-table">
            <thead>
              <tr>
                {guide.columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {guide.rows.map((row) => (
                <tr key={row.join('-')}>
                  {row.map((cell) => <td key={cell}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="size-guide-note">{guide.note}</div>
      </div>
    </div>
  );
}

function CartDemandBanner({ locale, totalItems }) {
  const headline = locale === 'he'
    ? '🔥 ביקוש גבוה! פריטים פופולריים נעלמים מהר מהסל.'
    : '🔥 High Demand! Popular pieces are moving fast right now.';
  const detail = locale === 'he'
    ? `יש כרגע ${totalItems} פריטים בסל שלך. השלם תשלום כדי לנעול מלאי ומחיר.`
    : `You currently have ${totalItems} item${totalItems === 1 ? '' : 's'} in your cart. Complete checkout to lock stock and price.`;

  return (
    <div className="cart-demand-banner">
      <div className="cart-demand-pulse" aria-hidden="true" />
      <div>
        <strong>{headline}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function CartTrustSignals({ locale }) {
  const badges = locale === 'he'
    ? [
        { icon: '🔐', title: 'קופה מוצפנת SSL' },
        { icon: '🚚', title: 'משלוח אקספרס מבוטח' },
        { icon: '🛡', title: 'אחריות איכות מלאה' },
      ]
    : [
        { icon: '🔐', title: 'SSL Encrypted Checkout' },
        { icon: '🚚', title: 'Insured Express Shipping' },
        { icon: '🛡', title: 'Quality Guarantee' },
      ];

  return (
    <div className="cart-trust-grid">
      {badges.map((badge) => (
        <div key={badge.title} className="cart-trust-card">
          <span>{badge.icon}</span>
          <b>{badge.title}</b>
        </div>
      ))}
    </div>
  );
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
const GLOBAL_OG_IMAGE_URL = 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=80';
const GLOBAL_ERROR_TOAST_HE = 'A temporary error occurred, please try again';
const LOW_STOCK_THRESHOLD = 10;
const MAX_ALLOWED_SIZE_RANK = 6;
const SIZE_ORDER = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZE_RANK = SIZE_ORDER.reduce((acc, size, index) => ({ ...acc, [size]: index + 1 }), {});
const ENGLISH_SHIPPING_TEXT_REGEX = /^[A-Za-z0-9\s.,'\-/#()]+$/;

const normalizeValue = (value) => String(value || '').trim().toLowerCase();
const normalizeSizeLabel = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const triggerHapticTap = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!window.matchMedia('(max-width: 768px)').matches) return;
  if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
};

const extractImageUrl = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'object') {
    const candidate = value.src || value.url || value.image_url || value.imageUrl;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
};

const pickFirstImageUrl = (...candidates) => {
  for (const candidate of candidates) {
    const url = extractImageUrl(candidate);
    if (url) return url;
  }
  return null;
};

const isValidEnglishShippingValue = (value, { requireLetter = false } = {}) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (!ENGLISH_SHIPPING_TEXT_REGEX.test(normalized)) return false;
  if (requireLetter && !/[A-Za-z]/.test(normalized)) return false;
  return true;
};

const getVariantIdsForColor = (variants, colorName) => {
  if (!Array.isArray(variants) || variants.length === 0 || !colorName) return [];
  const normalizedColor = normalizeValue(colorName);
  return variants
    .filter((variant) => normalizeValue(variant.color) === normalizedColor)
    .map((variant) => String(variant.printifyVariantId || variant.variantId || variant.id || ''))
    .filter(Boolean);
};

const getMappedImagesForVariantIds = (productImages, variantIds) => {
  if (!Array.isArray(productImages) || productImages.length === 0) return [];
  if (!Array.isArray(variantIds) || variantIds.length === 0) return [];

  const variantIdSet = new Set(variantIds.map((id) => String(id)));
  const ordered = [];

  productImages.forEach((entry) => {
    const entryVariantId = String(entry?.variantId || '');
    if (!entryVariantId || !variantIdSet.has(entryVariantId)) return;
    const src = extractImageUrl(entry);
    if (src) ordered.push(src);
  });

  return Array.from(new Set(ordered));
};

const isClothingSize = (size) => {
  const s = String(size || '').toUpperCase().trim();
  return /^[X]*[SML]$|^[0-9]XL$/i.test(s);
};

const getOrderedDisplaySizes = (sizes = []) => {
  const unique = Array.from(new Set((sizes || []).map((size) => normalizeSizeLabel(size)).filter(Boolean)));
  return unique
    .filter((size) => !isClothingSize(size) || (SIZE_RANK[size] || Number.MAX_SAFE_INTEGER) <= MAX_ALLOWED_SIZE_RANK)
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
  const normalizedSize = normalizeSizeLabel(selectedSize);

  return variants.find((variant) => (
    normalizeValue(variant.color) === normalizedColor
    && normalizeSizeLabel(variant.size) === normalizedSize
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
  const isJewelry = product.type === 'dropship' || product.supplier_id === 'dropship' || title.includes('jewelry') || title.includes('chain') || title.includes('bracelet') || title.includes('ring');
  if (isJewelry) return 'Jewelry';

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

function PromoDealBadge({ locale, curSym, displayVal }) {
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

function CartUpsellRail({ items, onQuickAdd, curSym, displayVal }) {
  if (!items.length) return null;

  return (
    <section className="cart-upsell-rail" aria-label="Frequently bought together">
      <div className="cart-upsell-head">
        <h4>Frequently Bought Together</h4>
        <p>Early access mockup for jewelry upsells to lift average order value.</p>
      </div>
      <div className="cart-upsell-grid">
        {items.map((item) => (
          <article key={item.id} className="cart-upsell-card">
            <div className="cart-upsell-image-wrap">
              <img src={item.imageUrl} alt={item.title} loading="lazy" />
            </div>
            <div className="cart-upsell-content">
              <strong>{item.title}</strong>
              <span>{item.subtitle}</span>
              <div className="cart-upsell-meta">
                <b>{curSym}{displayVal(item.price).toFixed(2)}</b>
                <button type="button" onClick={() => onQuickAdd(item)}>Add</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─── LeadCapturePopup ────────────────────────────────────────────────────────
function LeadCapturePopup({ t, currentPath }) {
  const STORAGE_KEY = 'drip_street_lead_dismissed_at';
  const SESSION_KEY = 'drip_street_lead_popup_seen_session';
  const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [errorText, setErrorText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (currentPath !== '/') return undefined;

    if (sessionStorage.getItem(SESSION_KEY) === '1') return undefined;
    if (localStorage.getItem('drip_street_lead_code')) return undefined;

    const dismissedAt = Number(localStorage.getItem(STORAGE_KEY) || 0);
    if (dismissedAt && (Date.now() - dismissedAt) < DISMISS_TTL_MS) {
      return undefined;
    }

    const openPopup = () => {
      if (visible) return;
      setVisible(true);
      sessionStorage.setItem(SESSION_KEY, '1');
    };

    const dwellTimer = setTimeout(() => {
      openPopup();
    }, 6000);

    const handleScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      const progress = window.scrollY / maxScroll;
      if (progress >= 0.35) {
        openPopup();
      }
    };

    const handleMouseOut = (e) => {
      if (e.clientY <= 5) {
        openPopup();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('mouseleave', handleMouseOut);

    return () => {
      clearTimeout(dwellTimer);
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('mouseleave', handleMouseOut);
    };
  }, [currentPath, visible]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || isSubmitting) return;

    setErrorText('');
    setCopied(false);
    setIsSubmitting(true);

    fetch(MARKETING_WELCOME_INTAKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        locale: 'en',
        source: 'storefront-popup',
        website: '',
        company: '',
      })
    })
      .catch(() => null)
      .then(() => fetch(`${API_BASE}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail })
    }))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = data.error || t('popup_already_registered');
          throw new Error(error);
        }
        return data;
      })
      .then((data) => {
        const promoCode = String(data.promoCode || '').trim();
        if (!promoCode) throw new Error(GLOBAL_ERROR_TOAST_HE);

        localStorage.setItem(STORAGE_KEY, '1');
        localStorage.setItem('drip_street_lead_email', normalizedEmail);
        localStorage.setItem('drip_street_lead_code', promoCode);

        setGeneratedCode(promoCode);
        setSubmitted(true);
      })
      .catch((err) => {
        setErrorText(err.message || t('popup_already_registered'));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleCopyCode = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="lead-popup-overlay" onClick={dismiss}>
      <motion.div
        className="lead-popup"
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ duration: 0.28 }}
        onClick={(e) => e.stopPropagation()}
        dir="ltr"
      >
        <button className="lead-popup-close" onClick={dismiss} aria-label="Close">×</button>
        {submitted ? (
          <div className="lead-popup-success">
            <div className="lead-popup-check">✓</div>
            <p>{t('popup_success')}</p>
            <div className="lead-popup-code-wrap">
              <span className="lead-popup-code-label">{t('popup_unique_code')}</span>
              <div className="lead-popup-code">{generatedCode}</div>
              <button type="button" className="lead-popup-copy-btn" onClick={handleCopyCode}>
                {copied ? t('popup_copied') : t('popup_copy')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lead-popup-badge">10% OFF</div>
            <h2 className="lead-popup-title">{t('popup_title')}</h2>
            <p className="lead-popup-subtitle">{t('popup_subtitle')}</p>
            <form className="lead-popup-form" onSubmit={handleSubmit}>
              <input
                type="email"
                required
                placeholder={t('popup_placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="lead-popup-input"
              />
              <button type="submit" className="lead-popup-cta" disabled={isSubmitting}>{isSubmitting ? '...' : t('popup_cta')}</button>
            </form>
            {errorText && <p className="lead-popup-error">{errorText === 'This email is already registered' ? t('popup_already_registered') : errorText}</p>}
            <button type="button" className="lead-popup-dismiss" onClick={dismiss}>{t('popup_dismiss')}</button>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────
function StarRating({ score = 5, count = 47, t }) {
  return (
    <div className="star-rating-row">
      <span className="star-rating-stars" aria-label={`${score} out of 5`}>
        {[1,2,3,4,5].map((s) => (
          <span key={s} className={`star ${s <= Math.round(score) ? 'filled' : 'empty'}`}>★</span>
        ))}
      </span>
      <span className="star-rating-score">{score.toFixed(1)}</span>
      <span className="star-rating-count">({count} {t('rating_label')})</span>
    </div>
  );
}

// ─── CustomerReviews ──────────────────────────────────────────────────────────
const REVIEWS_HE = [
  { name: 'יואב ל.', date: 'מאי 2026', text: 'חולצה ממש איכותית, הבד נעים ועדין. ההדפסה חדה ומדויקת. קיבלתי המון מחמאות.', score: 5 },
  { name: 'שירה מ.', date: 'אפריל 2026', text: 'הזמנתי כמה פריטים ו-100% מרוצה. המשלוח היה מהיר והאריזה מושקעת. ממליצה בחום!', score: 5 },
  { name: 'ניב ב.', date: 'מרץ 2026', text: 'סטייל מינימליסטי בדיוק כמו שרציתי. כבר הזמנתי שוב.', score: 5 },
];
const REVIEWS_EN = [
  { name: 'Yoav L.', date: 'May 2026', text: "Really high quality tee — the fabric is super soft and the print is laser-sharp. Got so many compliments.", score: 5 },
  { name: 'Shira M.', date: 'April 2026', text: "Ordered several items and I'm 100% satisfied. Fast shipping and the packaging feels premium. Highly recommend!", score: 5 },
  { name: 'Niv B.', date: 'March 2026', text: "Exactly the minimalist aesthetic I was looking for. Already placed a second order.", score: 5 },
];

function CustomerReviews({ t, locale }) {
  const reviews = locale === 'he' ? REVIEWS_HE : REVIEWS_EN;
  return (
    <div className="customer-reviews">
      <h3 className="reviews-section-title">{t('reviews_title')}</h3>
      <div className="reviews-list">
        {reviews.map((review, i) => (
          <div key={i} className="review-card">
            <div className="review-header">
              <span className="review-name">{review.name}</span>
              <span className="review-date">{review.date}</span>
            </div>
            <div className="review-stars">{'★'.repeat(review.score)}</div>
            <p className="review-text">{review.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductDetailPage({ productId, addToCart, goToCheckout, showToast, t, currency, curSym, locale }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('');
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const mainCtaRef = useRef(null);
  const mobileCarouselRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    fetch(`${API_BASE}/api/products/${productId}`)
      .then(res => {
        if (!res.ok) throw new Error('Product not found or failed to load');
        return res.json();
      })
      .then(data => {
        // Build imagesByColor mapping from variants and images
        if (data.variants && data.images) {
          const imagesByColor = {};
          const variantIdToColor = {};
          
          // Map variant IDs to colors
          data.variants.forEach(v => {
            const vid = v.printifyVariantId || v.variantId || v.id;
            if (vid) {
              variantIdToColor[vid] = v.color;
            }
          });
          
          // Group images by variant ID (extracted from URL path)
          const imagesByVariantId = {};
          if (Array.isArray(data.images)) {
            data.images.forEach(img => {
              const imgSrc = typeof img === 'string' ? img : (img?.src || '');
              if (!imgSrc) return;
              const variantMatch = imgSrc.match(/\/mockup\/[^/]+\/(\d+)\//);
              if (variantMatch) {
                const variantId = variantMatch[1];
                if (!imagesByVariantId[variantId]) imagesByVariantId[variantId] = [];
                imagesByVariantId[variantId].push(img);
              }
            });
          }
          
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
        
        // Fire analytics view_item
        trackViewItem(data, currency);

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
        && (!isClothingSize(normalizeSizeLabel(variant.size)) || (SIZE_RANK[normalizeSizeLabel(variant.size)] || Number.MAX_SAFE_INTEGER) <= MAX_ALLOWED_SIZE_RANK)
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

    const variants = Array.isArray(product.variants) ? product.variants : [];
    
    // Safely extract product images array
    let productImages = [];
    if (Array.isArray(product.images)) {
      productImages = product.images;
    } else if (typeof product.images === 'string') {
      try {
        const parsed = JSON.parse(product.images);
        if (Array.isArray(parsed)) {
          productImages = parsed;
        } else if (parsed && typeof parsed === 'object') {
          productImages = parsed.allImages || parsed.images || [parsed];
        } else {
          productImages = [product.images];
        }
      } catch {
        if (product.images.includes(',')) {
          productImages = product.images.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          productImages = [product.images];
        }
      }
    } else if (product.images) {
      productImages = [product.images];
    }

    const mappedVariantImages = getMappedImagesForVariantIds(
      productImages,
      getVariantIdsForColor(variants, selectedColor)
    );
    if (mappedVariantImages.length > 0) return mappedVariantImages;

    const imagesByColor = product.imagesByColor && typeof product.imagesByColor === 'object'
      ? product.imagesByColor
      : null;

    if (imagesByColor) {
      const matchingColorEntry = Object.entries(imagesByColor).find(([colorName]) => (
        normalizeValue(colorName) === normalizeValue(selectedColor)
      ));

      if (matchingColorEntry && Array.isArray(matchingColorEntry[1])) {
        const colorImages = matchingColorEntry[1].map((entry) => extractImageUrl(entry)).filter(Boolean);
        if (colorImages.length > 0) return colorImages;
      }
    }

    if (selectedVariant?.imageUrl || selectedVariant?.image_url) {
      const variantImage = extractImageUrl(selectedVariant.imageUrl || selectedVariant.image_url);
      if (variantImage) return [variantImage];
    }

    if (productImages.length > 0) {
      const parsedImages = productImages.map((entry) => extractImageUrl(entry)).filter(Boolean);
      if (parsedImages.length > 0) return parsedImages;
    }

    const fallbackImage = pickFirstImageUrl(
      product.imageUrl,
      product.image_url,
      product.backImageUrl,
      product.backImage_url,
      GLOBAL_IMAGE_FALLBACK
    );
    return [fallbackImage || GLOBAL_IMAGE_FALLBACK];
  }, [product, selectedColor, selectedVariant]);

  const mediaAssets = useMemo(() => {
    const imageAssets = activeImages.map((src, index) => ({
      type: 'image',
      src,
      key: `img-${index}-${src}`,
      label: `Image ${index + 1}`,
    }));

    const videoAssets = [
      ...(Array.isArray(product?.videoUrls) ? product.videoUrls : []),
      product?.videoUrl,
    ]
      .filter(Boolean)
      .map((src, index) => ({
        type: 'video',
        src,
        key: `vid-${index}-${src}`,
        label: `Video ${index + 1}`,
      }));

    const assets = [...imageAssets, ...videoAssets];
    if (assets.length === 0) {
      assets.push({ type: 'placeholder', kind: 'image', key: 'ph-image', label: 'Image Placeholder' });
    }

    assets.push({ type: 'placeholder', kind: 'video', key: 'ph-video', label: locale === 'he' ? 'וידאו מוצר בקרוב' : 'Product Video Coming Soon' });
    assets.push({ type: 'placeholder', kind: 'gif', key: 'ph-gif', label: locale === 'he' ? 'תצוגת GIF בקרוב' : 'GIF Motion Preview Coming Soon' });

    return assets;
  }, [activeImages, product, locale]);

  const activeMedia = mediaAssets[activeImageIndex] || mediaAssets[0] || null;

  useEffect(() => {
    setActiveImageIndex(0);
    if (mobileCarouselRef.current) mobileCarouselRef.current.scrollLeft = 0;
  }, [selectedColor, productId]);

  useEffect(() => {
    if (activeImageIndex >= mediaAssets.length) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, mediaAssets.length]);

  const goToImage = (index) => {
    const boundedIndex = Math.max(0, Math.min(index, mediaAssets.length - 1));
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
  const hasLiveInventory = Boolean(product?.operationalNotice?.isLiveInventory);
  const isLowStock = hasLiveInventory && selectedVariantStock !== null && selectedVariantStock > 0 && selectedVariantStock < LOW_STOCK_THRESHOLD;

  const renderMediaAsset = (asset, variant = 'main') => {
    if (!asset) return null;

    if (asset.type === 'video') {
      return (
        <video
          className={variant === 'thumb' ? 'pdp-thumb-img' : 'pdp-image'}
          controls
          muted
          playsInline
          preload="metadata"
          poster={activeImages[0] || GLOBAL_IMAGE_FALLBACK}
        >
          <source src={asset.src} />
        </video>
      );
    }

    if (asset.type === 'placeholder') {
      return (
        <div className={`pdp-media-placeholder ${variant === 'thumb' ? 'thumb' : ''}`}>
          <span>{asset.kind === 'video' ? '▶' : asset.kind === 'gif' ? 'GIF' : 'IMG'}</span>
          <small>{asset.label}</small>
        </div>
      );
    }

    return (
      <GuardedProductImage
        src={asset.src}
        alt={`${product.title} ${asset.label}`}
        className={variant === 'thumb' ? 'pdp-thumb-img' : 'pdp-image'}
        loading={variant === 'main' ? 'eager' : 'lazy'}
        fetchPriority={variant === 'main' ? 'high' : 'auto'}
      />
    );
  };

  if (loading) {
    return (
      <div className="container pdp-skeleton-layout">
        <div className="pdp-skeleton-visuals">
          <div className="skeleton pdp-skeleton-gallery" />
          <div className="pdp-skeleton-thumb-row">
            <div className="skeleton pdp-skeleton-thumb" />
            <div className="skeleton pdp-skeleton-thumb" />
            <div className="skeleton pdp-skeleton-thumb" />
            <div className="skeleton pdp-skeleton-thumb" />
          </div>
        </div>
        <div className="pdp-skeleton-meta">
          <div className="skeleton pdp-skeleton-kicker" />
          <div className="skeleton pdp-skeleton-line" />
          <div className="skeleton pdp-skeleton-line short" />
          <div className="skeleton pdp-skeleton-price" />
          <div className="skeleton pdp-skeleton-chip-row" />
          <div className="skeleton pdp-skeleton-chip-row short" />
          <div className="skeleton pdp-skeleton-button" />
          <div className="skeleton pdp-skeleton-button secondary" />
        </div>
      </div>
    );
  }
  if (!product || product.error || !product.title) return <div className="container" style={{padding: '100px 0', textAlign: 'center'}}>{t('product_not_found')}</div>;

  const isJewelry = isJewelryProduct(product);
  const materialCareContent = locale === 'he'
    ? {
        intro: isJewelry
          ? 'פלדת אל-חלד איכותית עם ציפוי מוזהב וגימור מבריק שמיועד לנוכחות יומיומית.'
          : `${getLocalizedFabric(product, locale)} ${getLocalizedCare(product, locale)}`,
        bullets: isJewelry
          ? ['היפואלרגני ומתאים לשימוש יומיומי', 'ברק חלק עם ליטוש מדויק', 'מתאים לשכבות או לענידה בודדת']
          : ['בד פרימיום עם תחושת משקל נכונה', 'נוחות גבוהה ליום שלם', 'שומר על צורה ונראות גם אחרי כביסות'],
      }
    : {
        intro: isJewelry
          ? 'Premium stainless steel with a deep gold finish built for everyday shine and comfort.'
          : `${getLocalizedFabric(product, locale)} ${getLocalizedCare(product, locale)}`,
        bullets: isJewelry
          ? ['Hypoallergenic everyday wear', 'Polished premium shine', 'Strong solo piece or layering staple']
          : ['Premium-weight fabrication', 'All-day comfort and structure', 'Designed to keep its shape after repeated wear'],
      };
  const shippingReturnsContent = locale === 'he'
    ? {
        intro: getLocalizedDelivery(product, locale),
        bullets: ['מספר מעקב נשלח מיד לאחר יציאה למחסן השילוח', 'החזרות והחלפות מטופלות מול שירות הלקוחות במהירות', 'במקרה של פגם ייצור נטפל בהחלפה או בזיכוי ללא עיכוב'],
      }
    : {
        intro: getLocalizedDelivery(product, locale),
        bullets: ['Tracking is emailed once the parcel is scanned by the carrier', 'Easy support-led returns and replacements', 'Manufacturing defects are handled quickly with a replacement or refund'],
      };

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

  const absoluteImageUrl = activeImages[0]
    ? (activeImages[0].startsWith('http') ? activeImages[0] : `https://dripstreetshop.com${activeImages[0]}`)
    : GLOBAL_OG_IMAGE_URL;

  const jsonLd = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": getProductTitle(product.title, locale),
    "image": activeImages.map(img => img.startsWith('http') ? img : `https://dripstreetshop.com${img}`),
    "description": getLocalizedProductDescription(product, locale),
    "offers": {
      "@type": "Offer",
      "url": `https://dripstreetshop.com/product/${product.id}`,
      "priceCurrency": currency,
      "price": Number(displayPrice.toFixed(2)),
      "availability": isOutOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock"
    }
  };

  return (
    <>
      <Helmet>
        <title>{`${getProductTitle(product.title, locale)} | Drip Street`}</title>
        <meta name="description" content={getLocalizedProductDescription(product, locale)} />
        <link rel="canonical" href={`https://dripstreetshop.com/product/${product.id}`} />
        <meta property="og:title" content={`${getProductTitle(product.title, locale)} | Drip Street`} />
        <meta property="og:description" content={getLocalizedProductDescription(product, locale)} />
        <meta property="og:url" content={`https://dripstreetshop.com/product/${product.id}`} />
        <meta property="og:type" content="product" />
        <meta property="og:image" content={absoluteImageUrl} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${getProductTitle(product.title, locale)} | Drip Street`} />
        <meta name="twitter:description" content={getLocalizedProductDescription(product, locale)} />
        <meta name="twitter:image" content={absoluteImageUrl} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      {/* Header removed — the MainApp's sticky storefront-header (with drip-mark
         lockup, search, and cart) is already visible on this route. Rendering
         a second header here caused a visible duplicate "DRIP STREET" bar. */}
      <div className="container pdp-container">
        <div style={{ width: '100%', marginBottom: '12px' }}>
          <BackButton />
        </div>
        <div className="pdp-images">
          {isMobileViewport ? (
            <div className="pdp-mobile-gallery">
              <div className="pdp-mobile-carousel" ref={mobileCarouselRef} onScroll={handleMobileScroll}>
                {mediaAssets.map((asset, i) => (
                  <div className="pdp-mobile-slide" key={`${selectedColor}-${i}-${asset.key}`}>
                    {renderMediaAsset(asset, 'main')}
                  </div>
                ))}
              </div>
              <div className="pdp-carousel-dots">
                {mediaAssets.map((asset, i) => (
                  <button
                    key={`dot-${i}-${asset.key}`}
                    type="button"
                    className={`pdp-dot ${activeImageIndex === i ? 'active' : ''}`}
                    onClick={() => goToImage(i)}
                    aria-label={`Show media ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="pdp-desktop-media-grid">
              <div className="pdp-main-image-frame">
                {renderMediaAsset(activeMedia, 'main')}
              </div>
              <div className="pdp-thumbnail-row pdp-media-rail">
                {mediaAssets.map((asset, i) => (
                  <button
                    key={`thumb-${i}-${asset.key}`}
                    type="button"
                    className={`pdp-thumb-btn ${activeImageIndex === i ? 'active' : ''}`}
                    onClick={() => goToImage(i)}
                  >
                    {renderMediaAsset(asset, 'thumb')}
                  </button>
                ))}
              </div>
            </div>
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
                <div className="pdp-section-headline">
                  <h3>{t('size')}</h3>
                  <button type="button" className="size-guide-link" onClick={() => setIsSizeGuideOpen(true)}>
                    {locale === 'he' ? 'מדריך מידות 📏' : 'Size Guide 📏'}
                  </button>
                </div>
                {isOutOfStock && <div className="low-stock-badge out-of-stock">{locale === 'he' ? 'אזל מהמלאי' : 'Out of stock'}</div>}
                {!isOutOfStock && isLowStock && <div className="low-stock-badge"><span className="stock-pulse-dot" />{t('low_stock')}</div>}
                <div className="pdp-options premium-size-grid">
                  {orderedDisplaySizes.map((sizeOption) => {
                    const unavailable = availableSizesForColor.size > 0 && !availableSizesForColor.has(sizeOption);
                    return (
                      <button
                        key={sizeOption}
                        className={`size-btn ${selectedSize === sizeOption ? 'active' : ''}`}
                        disabled={unavailable}
                        onClick={() => {
                          triggerHapticTap();
                          setSelectedSize(sizeOption);
                        }}
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

            <motion.button
              ref={mainCtaRef}
              className="checkout-btn add-to-cart-large"
              whileTap={{ scale: 0.985 }}
              data-track="pdp_add_to_cart"
              onClick={() => {
                triggerHapticTap();
                handleAdd('cart');
              }}
            >
              {t('add_to_cart')}
            </motion.button>
            <button className="buy-now-inline" data-track="pdp_buy_now" onClick={() => handleAdd('buy')}>
              {t('buy_now')}
            </button>

            <div className="purchase-signal-card">
              <strong>Material & Fit</strong>
              <ul>
                <li>Premium Heavyweight Cotton</li>
                <li>Soft interior with clean exterior finish</li>
                <li>Relaxed silhouette for everyday layering</li>
              </ul>
            </div>

            <div className="shipping-trust-strip">
              <span>Tracked shipping worldwide</span>
              <span>Easy 14-day returns</span>
            </div>

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
            <StarRating score={4.9} count={47} t={t} />

            <div className="pdp-accordion">
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'description' ? '' : 'description')}>
                  {t('product_description')} <span>{activeTab === 'description' ? '−' : '+'}</span>
                </button>
                <div className={`accordion-panel ${activeTab === 'description' ? 'open' : ''}`}>
                  <div className="accordion-content">{getLocalizedProductDescription(product, locale)}</div>
                </div>
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'materialCare' ? '' : 'materialCare')}>
                  {t('material_care')} <span>{activeTab === 'materialCare' ? '−' : '+'}</span>
                </button>
                <div className={`accordion-panel ${activeTab === 'materialCare' ? 'open' : ''}`}>
                  <div className="accordion-content accordion-rich-copy">
                    <p>{materialCareContent.intro}</p>
                    <ul>
                      {materialCareContent.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="accordion-item">
                <button className="accordion-header" onClick={() => setActiveTab(activeTab === 'shippingReturns' ? '' : 'shippingReturns')}>
                  {t('shipping_returns')} <span>{activeTab === 'shippingReturns' ? '−' : '+'}</span>
                </button>
                <div className={`accordion-panel ${activeTab === 'shippingReturns' ? 'open' : ''}`}>
                  <div className="accordion-content accordion-rich-copy">
                    <p>{shippingReturnsContent.intro}</p>
                    <ul>
                      {shippingReturnsContent.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <CustomerReviews t={t} locale={locale} />
          </div>
        </div>
      </div>

      {showStickyCta && (
        <div className="sticky-buy-bar">
          <div className="sticky-buy-meta">
            <strong>{getProductTitle(product.title, locale)}</strong>
            <span>{curSym}{displayPrice.toFixed(2)}</span>
          </div>
          <button
            className="sticky-buy-btn"
            data-track="pdp_sticky_add_to_cart"
            onClick={() => {
              triggerHapticTap();
              handleAdd('cart');
            }}
          >
            {t('add_to_cart')}
          </button>
        </div>
      )}
      {isSizeGuideOpen && <SizeGuideModal product={product} locale={locale} onClose={() => setIsSizeGuideOpen(false)} />}
      <Footer locale={locale} />
      <CookieConsent />
    </>
  );
}

// Thin wrapper so /product/:productId can render ProductDetailPage with URL params
function ProductDetailRoute(props) {
  const { productId } = useParams();
  const parsed = Number(productId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return (
      <div className="container legal-page" style={{ textAlign: 'center', padding: '100px 20px' }}>
        <h1 style={{ fontSize: '36px', textTransform: 'uppercase', marginBottom: '16px' }}>404 NOT FOUND</h1>
      </div>
    );
  }
  return <ProductDetailPage productId={parsed} {...props} />;
}

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

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
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paypalClientId, setPaypalClientId] = useState(import.meta.env.VITE_PAYPAL_CLIENT_ID || '')
  const [checkoutConfig, setCheckoutConfig] = useState({
    paypalEnabled: true,
    stripeEnabled: false,
    payplusEnabled: false,
    meshulamEnabled: true,
  })
  const [isPayPalProcessing, setIsPayPalProcessing] = useState(false)
  const [isMeshulamProcessing, setIsMeshulamProcessing] = useState(false)
  const [checkoutForm, setCheckoutForm] = useState({
    customerName: '',
    customerEmail: '',
    address: '',
    firstName: '',
    lastName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  })
  const [shippingCountry, setShippingCountry] = useState('IL')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [activeCoupon, setActiveCoupon] = useState(null)
  const [promoInput, setPromoInput] = useState('')
  const [activeLeadPromo, setActiveLeadPromo] = useState(null)
  const [promoFeedback, setPromoFeedback] = useState('')
  const [isApplyingPromo, setIsApplyingPromo] = useState(false)
  const [quickAddProduct, setQuickAddProduct] = useState(null)
  const [quickAddColor, setQuickAddColor] = useState('')
  const [quickAddSize, setQuickAddSize] = useState('')
  const [quickAddQuantity, setQuickAddQuantity] = useState(1)
  const [isQuickAddLoading, setIsQuickAddLoading] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  const [locale, setLocale] = useState(() => localStorage.getItem('drip_street_locale') || 'en');
  const [currency, setCurrency] = useState('USD')
  const [exchangeRate, setExchangeRate] = useState(3.75)
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false)

  const toggleLocale = () => {
    const nextLocale = locale === 'he' ? 'en' : 'he';
    setLocale(nextLocale);
    localStorage.setItem('drip_street_locale', nextLocale);
  };

  // Glass header deepens after first scroll
  useEffect(() => {
    const onScroll = () => setIsHeaderScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Geo-aware currency + country defaults.
  // The backend gives us the live exchange rate (and a server-side country guess).
  // We *also* hit ipapi.co directly from the browser, because Render strips most
  // proxy headers and the server otherwise falls back to the IL default for
  // every visitor. The browser-side lookup is the source of truth for currency.
  useEffect(() => {
    // 1) Backend: authoritative for exchange rate, provisional for country.
    fetch(`${API_BASE}/api/geolocation`)
      .then((res) => res.json())
      .then((data) => {
        if (data && Number.isFinite(Number(data.exchangeRate)) && Number(data.exchangeRate) > 0) {
          setExchangeRate(Number(data.exchangeRate));
        }
        if (data && (data.currency === 'ILS' || data.currency === 'USD')) {
          setCurrency(data.currency);
        }
        if (data && typeof data.country === 'string' && data.country.length === 2) {
          const cc = data.country.toUpperCase();
          setShippingCountry(cc);
          setCheckoutForm((prev) => prev.country ? prev : { ...prev, country: cc });
        }
        // Set locale dynamically on first visit if no manual choice is stored
        if (data && (data.locale === 'he' || data.locale === 'en') && !localStorage.getItem('drip_street_locale')) {
          setLocale(data.locale);
        }
      })
      .catch(() => { /* keep defaults — ipapi step below will still try */ });

    // 2) Browser-side IP→country lookup. Reliable regardless of backend proxy setup.
    fetch('https://ipapi.co/json/')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        const cc = String(data.country_code || '').toUpperCase();
        if (cc.length !== 2) return;
        setCurrency(cc === 'IL' ? 'ILS' : 'USD');
        setShippingCountry(cc);
        setCheckoutForm((prev) => prev.country ? prev : { ...prev, country: cc });
        // Fallback locale dynamic set if no manual override
        if (!localStorage.getItem('drip_street_locale')) {
          setLocale(cc === 'IL' ? 'he' : 'en');
        }
      })
      .catch(() => { /* silent — backend value already applied */ });
  }, []);

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
  const abandonedCartTimeoutRef = useRef(null);
  const abandonedCartSentRef = useRef(false);
  const lastAbandonedDispatchRef = useRef(0);

  const showToast = (message) => {
    if (!message) return;
    setToast({ visible: true, message });
  };

  function openCartDrawer() {
    setIsCartOpen(true);
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => setIsCartOpen(true));
    }
  }

  const hasCheckoutContact = useMemo(() => {
    const email = String(checkoutForm.customerEmail || '').trim();
    const phoneDigits = String(checkoutForm.phone || '').replace(/\D/g, '');
    return isLikelyValidEmail(email) || phoneDigits.length >= 7;
  }, [checkoutForm.customerEmail, checkoutForm.phone]);

  // Keep pricing values above effects/memos that depend on cartTotal.
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const bundlePricing = calculateBundlePricing(cart);
  const baseSubtotal = bundlePricing.baseSubtotal;
  const bundleSets = bundlePricing.bundleSets;
  const bundleDiscount = bundlePricing.bundleDiscount;
  const bundleActive = bundleSets > 0;

  const shirtsInCart = expandCartUnits(cart).length;
  const bundleRemainder = shirtsInCart % 3;
  const shirtsToNextBundle = bundleRemainder > 0 ? 3 - bundleRemainder : 0;
  const bundleProgressPercent = bundleRemainder > 0 ? (bundleRemainder / 3) * 100 : 0;

  const couponDiscount = activeCoupon ? (baseSubtotal - bundleDiscount) * (activeCoupon.discount_pct / 100) : 0;

  const subtotalAfterDiscounts = Math.max(0, bundlePricing.subtotalAfterDiscounts - couponDiscount);
  const leadPromoDiscount = activeLeadPromo ? subtotalAfterDiscounts * 0.10 : 0;
  const subtotalAfterLeadPromo = Math.max(0, subtotalAfterDiscounts - leadPromoDiscount);
  const isFreeShipping = subtotalAfterLeadPromo >= FREE_SHIPPING_THRESHOLD;
  const shippingCost = isFreeShipping ? 0 : (subtotalAfterLeadPromo > 0 ? SHIPPING_COST : 0);
  const amountToFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotalAfterLeadPromo);
  const freeShippingProgress = Math.min(100, (subtotalAfterLeadPromo / FREE_SHIPPING_THRESHOLD) * 100);
  const cartTotal = subtotalAfterLeadPromo + shippingCost;
  const amountToBundleThreshold = Math.max(0, BUNDLE_ITEM_PRICE - subtotalAfterLeadPromo);
  const bundleValueProgress = Math.min(100, (subtotalAfterLeadPromo / BUNDLE_ITEM_PRICE) * 100);

  const abandonedCartPayload = useMemo(() => {
    if (!cart.length || !hasCheckoutContact) return null;
    return {
      sessionId: chatSessionId,
      customerEmail: String(checkoutForm.customerEmail || '').trim().toLowerCase(),
      customerPhone: String(checkoutForm.phone || '').trim(),
      currency,
      locale,
      totalValue: Number(Number(cartTotal || 0).toFixed(2)),
      items: normalizeMarketingItems(cart),
      website: '',
      company: '',
    };
  }, [cart, hasCheckoutContact, chatSessionId, checkoutForm.customerEmail, checkoutForm.phone, currency, locale, cartTotal]);

  const abandonedCartFingerprint = useMemo(() => {
    if (!abandonedCartPayload) return '';
    const itemCount = abandonedCartPayload.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    return [
      abandonedCartPayload.sessionId,
      abandonedCartPayload.customerEmail,
      abandonedCartPayload.customerPhone,
      itemCount,
      abandonedCartPayload.totalValue,
      abandonedCartPayload.currency,
    ].join('::');
  }, [abandonedCartPayload]);

  const hasCheckoutBeenCompleted = () => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(CHECKOUT_COMPLETED_KEY) === '1';
  };

  const markAbandonedCartSent = () => {
    abandonedCartSentRef.current = true;
    if (typeof window === 'undefined' || !abandonedCartFingerprint) return;
    sessionStorage.setItem(ABANDONED_CART_FINGERPRINT_KEY, abandonedCartFingerprint);
  };

  const canDispatchAbandonedCart = () => {
    if (!abandonedCartPayload || !abandonedCartFingerprint) return false;
    if (currentPath !== '/checkout') return false;
    if (abandonedCartSentRef.current) return false;
    if (hasCheckoutBeenCompleted()) return false;

    if (typeof window !== 'undefined') {
      const existingFingerprint = sessionStorage.getItem(ABANDONED_CART_FINGERPRINT_KEY);
      if (existingFingerprint && existingFingerprint === abandonedCartFingerprint) {
        return false;
      }
    }

    const nowTs = Date.now();
    if (nowTs - lastAbandonedDispatchRef.current < 15000) {
      return false;
    }

    return true;
  };

  const dispatchAbandonedCart = async (triggerReason, preferBeacon = false) => {
    if (!canDispatchAbandonedCart()) return;
    lastAbandonedDispatchRef.current = Date.now();

    const payload = {
      ...abandonedCartPayload,
      triggerReason,
      sentAt: new Date().toISOString(),
    };

    if (preferBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const queued = navigator.sendBeacon(MARKETING_ABANDONED_INTAKE_URL, blob);
        if (queued) {
          markAbandonedCartSent();
          return;
        }
      } catch {
        // Fall through to fetch keepalive.
      }
    }

    try {
      const response = await fetch(MARKETING_ABANDONED_INTAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });

      if (response.ok) {
        markAbandonedCartSent();
      }
    } catch (err) {
      console.warn('Abandoned cart dispatch failed:', err);
    }
  };

  useEffect(() => {
    if (!toast.visible) return;
    const timer = setTimeout(() => setToast({ visible: false, message: '' }), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    abandonedCartSentRef.current = false;
  }, [abandonedCartFingerprint]);

  useEffect(() => {
    if (abandonedCartTimeoutRef.current) {
      clearTimeout(abandonedCartTimeoutRef.current);
      abandonedCartTimeoutRef.current = null;
    }

    if (currentPath !== '/checkout' || !abandonedCartPayload || hasCheckoutBeenCompleted()) {
      return undefined;
    }

    abandonedCartTimeoutRef.current = setTimeout(() => {
      dispatchAbandonedCart('checkout-timeout');
    }, ABANDONED_CART_TIMEOUT_MS);

    return () => {
      if (abandonedCartTimeoutRef.current) {
        clearTimeout(abandonedCartTimeoutRef.current);
        abandonedCartTimeoutRef.current = null;
      }
    };
  }, [currentPath, abandonedCartPayload, abandonedCartFingerprint]);

  useEffect(() => {
    if (currentPath !== '/checkout' || !abandonedCartPayload || hasCheckoutBeenCompleted()) {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        dispatchAbandonedCart('tab-hidden', true);
      }
    };

    const handlePageHide = () => {
      dispatchAbandonedCart('page-hide', true);
    };

    const handleBeforeUnload = () => {
      dispatchAbandonedCart('before-unload', true);
    };

    const handleMouseExitIntent = (event) => {
      if (!event.relatedTarget && event.clientY <= 0) {
        dispatchAbandonedCart('exit-intent');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('mouseout', handleMouseExitIntent);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('mouseout', handleMouseExitIntent);
    };
  }, [currentPath, abandonedCartPayload, abandonedCartFingerprint]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (currentPath === '/success') {
      sessionStorage.setItem(CHECKOUT_COMPLETED_KEY, '1');
      abandonedCartSentRef.current = true;
      if (abandonedCartTimeoutRef.current) {
        clearTimeout(abandonedCartTimeoutRef.current);
        abandonedCartTimeoutRef.current = null;
      }
      return;
    }

    if (cart.length > 0) {
      sessionStorage.removeItem(CHECKOUT_COMPLETED_KEY);
    }
  }, [currentPath, cart.length]);

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
    const visitKey = 'drip_street_visit_notified';
    if (!sessionStorage.getItem(visitKey)) {
      fetch(`${API_BASE}/api/analytics/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: chatSessionId,
          path: window.location.pathname,
          locale: 'en',
          currency: 'USD',
          source: 'storefront'
        })
      }).catch(() => null);
      sessionStorage.setItem(visitKey, '1');
    }

    fetch(`${API_BASE}/api/checkout/config`)
      .then((res) => res.json())
      .then((data) => {
        if (!data) return;

        if (data.paypalClientId) setPaypalClientId(data.paypalClientId);
        setCheckoutConfig({
          paypalEnabled: Boolean(data.paypalEnabled),
          stripeEnabled: Boolean(data.stripeEnabled),
          payplusEnabled: Boolean(data.payplusEnabled),
        });
      })
      .catch((err) => {
        console.warn('Checkout config fallback applied:', err);
        fetch(`${API_BASE}/api/paypal/config`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.clientId) setPaypalClientId(data.clientId);
          })
          .catch(() => null);
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

  useEffect(() => {
    if (!isWidgetChatOpen || !chatSessionId) return;

    const pollHistory = () => {
      fetch(`${API_BASE}/api/chat/history/${chatSessionId}`)
        .then((res) => res.json())
        .then((data) => {
          setChatHistory(data.history || []);
          setChatStatus(data.status || 'bot');
        })
        .catch(() => null);
    };

    pollHistory();
    const intervalId = setInterval(pollHistory, 5000);
    return () => clearInterval(intervalId);
  }, [isWidgetChatOpen, chatSessionId]);

  const t = (key, replaces = {}) => {
    let text = translations[locale]?.[key] || translations['en']?.[key] || key;
    Object.keys(replaces).forEach(k => {
      text = text.replace(`{${k}}`, replaces[k]);
    });
    return text;
  };

  const curSym = currency === 'USD' ? '$' : '₪';
  const displayVal = (nisValue) => (currency === 'USD' ? (nisValue / exchangeRate) : nisValue);
  const isPayPalAvailable = Boolean(checkoutConfig.paypalEnabled && paypalClientId);
  const isStripeAvailable = Boolean(checkoutConfig.stripeEnabled);
  const isPayPlusAvailable = Boolean(checkoutConfig.payplusEnabled);
  // Meshulam (Grow) — Israeli payment processor. Always offered in the UI;
  // the backend returns a clear "not configured" error if env vars are missing.
  const isMeshulamAvailable = Boolean(checkoutConfig.meshulamEnabled !== false);
  const shippingValidationMessage = (() => {
    const f = checkoutForm;
    const namesProvided = (f.firstName || '').trim() || (f.lastName || '').trim();
    if (namesProvided) {
      if (!isValidEnglishShippingValue(`${f.firstName} ${f.lastName}`.trim(), { requireLetter: true })) {
        return t('shipping_name_english_only');
      }
      if (f.addressLine1 && !isValidEnglishShippingValue(f.addressLine1, { requireLetter: true })) {
        return t('shipping_address_english_only');
      }
      if (f.city && !isValidEnglishShippingValue(f.city, { requireLetter: true })) {
        return t('shipping_address_english_only');
      }
      return '';
    }
    // Legacy fallback (combined name + single-string address)
    if (!isValidEnglishShippingValue(f.customerName, { requireLetter: true })) return t('shipping_name_english_only');
    if (!isValidEnglishShippingValue(f.address, { requireLetter: true })) return t('shipping_address_english_only');
    return '';
  })();
  const isSelectedPaymentAvailable = (() => {
    if (paymentMethod === 'paypal') return isPayPalAvailable;
    if (paymentMethod === 'stripe') return isStripeAvailable;
    if (paymentMethod === 'meshulam_card' || paymentMethod === 'meshulam_bit') return isMeshulamAvailable;
    return isPayPlusAvailable;
  })();

  useEffect(() => {
    if (paymentMethod) return;
    // Meshulam (local) is the preferred default for the Israeli storefront.
    if (isMeshulamAvailable) setPaymentMethod('meshulam_card');
    else if (isStripeAvailable) setPaymentMethod('stripe');
    else if (isPayPlusAvailable) setPaymentMethod('payplus');
    else if (isPayPalAvailable) setPaymentMethod('paypal');
  }, [isMeshulamAvailable, isStripeAvailable, isPayPlusAvailable, isPayPalAvailable, paymentMethod]);

  useEffect(() => {
    const availableMethods = [];
    if (isMeshulamAvailable) availableMethods.push('meshulam_card', 'meshulam_bit');
    if (isPayPalAvailable) availableMethods.push('paypal');
    if (isPayPlusAvailable) availableMethods.push('payplus');
    if (isStripeAvailable) availableMethods.push('stripe');

    if (availableMethods.length > 0 && !availableMethods.includes(paymentMethod)) {
      setPaymentMethod(availableMethods[0]);
    }
  }, [isMeshulamAvailable, isPayPalAvailable, isPayPlusAvailable, isStripeAvailable, paymentMethod]);

  const closeCartDrawer = () => {
    setIsCartOpen(false);
    if (location.pathname === '/cart') {
      navigate('/');
    }
  };
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

  const jewelryUpsellCandidates = useMemo(() => {
    const cartIds = new Set(cart.map((item) => String(item.id || item.cartId || '')));
    return JEWELRY_UPSELL_MOCK.filter((item) => !cartIds.has(String(item.id))).slice(0, 3);
  }, [cart]);

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

    const normalizedColor = normalizeValue(quickAddColor);
    const variants = Array.isArray(quickAddProduct.variants) ? quickAddProduct.variants : [];

    const mappedVariantImages = getMappedImagesForVariantIds(
      Array.isArray(quickAddProduct.images) ? quickAddProduct.images : [],
      getVariantIdsForColor(variants, quickAddColor)
    );
    if (mappedVariantImages.length > 0) return mappedVariantImages[0];

    const imagesByColor = quickAddProduct.imagesByColor && typeof quickAddProduct.imagesByColor === 'object'
      ? quickAddProduct.imagesByColor
      : null;

    if (imagesByColor && normalizedColor) {
      const matchingColorEntry = Object.entries(imagesByColor).find(([colorName]) => (
        normalizeValue(colorName) === normalizedColor
      ));

      if (matchingColorEntry && Array.isArray(matchingColorEntry[1]) && matchingColorEntry[1].length > 0) {
        const preferredImage = matchingColorEntry[1].map((entry) => extractImageUrl(entry)).find(Boolean);
        if (preferredImage) return preferredImage;
      }
    }

    const firstVariantForColor = variants.find((variant) => (
      normalizeValue(variant.color) === normalizedColor
      && Number(variant.isEnabled) !== 0
      && Number(variant.isAvailable) !== 0
      && variant.imageUrl
    ));

    if (firstVariantForColor?.imageUrl) {
      const byVariant = extractImageUrl(firstVariantForColor.imageUrl);
      if (byVariant) return byVariant;
    }

    const matchedVariant = findMatchingVariant(variants, quickAddColor, quickAddSize)
      || findFirstAvailableVariantForColor(variants, quickAddColor);

    return pickFirstImageUrl(matchedVariant?.imageUrl, quickAddProduct.imageUrl, quickAddProduct.backImageUrl, GLOBAL_IMAGE_FALLBACK)
      || GLOBAL_IMAGE_FALLBACK;
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
    navigate('/checkout');
  };

  const addToCart = (product, options = {}) => {
    const { onAdded, quantity = 1 } = options;
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
    // Trigger toast notification
    showToast(locale === 'he' ? 'התווסף לסל! 🛒' : 'Added to Cart! 🛒');
  }

  const addUpsellToCart = (upsellItem) => {
    if (!upsellItem) return;

    addToCart({
      id: upsellItem.id,
      cartId: String(upsellItem.id),
      title: upsellItem.title,
      price: Number(upsellItem.price) || 0,
      imageUrl: upsellItem.imageUrl,
      quantity: 1,
      stock: 1,
      type: 'upsell-mock',
    }, { openCart: false, quantity: 1 });

    showToast(`${upsellItem.title} added to cart`);
  };

  const removeFromCart = (cartId) => {
    setCart((prevCart) => prevCart.filter(item => (item.cartId || `${item.id}`) !== cartId))
  }

  const applyLeadPromo = async () => {
    const candidate = promoInput.trim().toUpperCase();
    if (!candidate || isApplyingPromo) return;

    setIsApplyingPromo(true);
    setPromoFeedback('');

    try {
      // 1) Try lead promo (DRP-XXXXXX from newsletter signups)
      const leadResp = await fetch(`${API_BASE}/api/promo/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoCode: candidate })
      });
      const leadData = await leadResp.json().catch(() => ({}));

      if (leadResp.ok && leadData.valid) {
        setActiveLeadPromo({ code: leadData.promoCode || candidate, discountRate: Number(leadData.discountRate) || 0.1 });
        setPromoInput(leadData.promoCode || candidate);
        setPromoFeedback(t('promo_applied'));
        return;
      }

      // 2) Fallback: check admin coupon (MENI-XXX, SAMPLE100, etc. from Telegram)
      const adminResp = await fetch(`${API_BASE}/api/coupons/active`);
      const adminData = await adminResp.json().catch(() => ({}));
      if (adminData && adminData.coupon && String(adminData.coupon.code).toUpperCase() === candidate) {
        setActiveCoupon(adminData.coupon);
        setPromoInput(adminData.coupon.code);
        setPromoFeedback(t('promo_applied'));
        setActiveLeadPromo(null);
        return;
      }

      // Neither matched
      setActiveLeadPromo(null);
      setPromoFeedback(t('promo_invalid'));
    } catch {
      setActiveLeadPromo(null);
      setPromoFeedback(t('promo_invalid'));
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const updateQuantity = (cartId, newQty) => {
    if (newQty <= 0) return removeFromCart(cartId);
    setCart((prevCart) => prevCart.map(item => ((item.cartId || `${item.id}`) === cartId ? { ...item, quantity: newQty } : item)))
  }

  // ============ NAVIGATION ============

  const proceedToCheckout = () => {
    if (cart.length === 0) {
      showToast(t('empty_cart_toast'));
      return;
    }
    closeCartDrawer();
    navigate('/checkout');
  }

  const hasInvalidVariant = cart.some((item) => (
    item.selectedColor
    && item.selectedSize
    && (!item.variantId || Number.isNaN(Number(item.variantId)))
  ));

  const REGION_REQUIRED_FRONTEND = new Set(['US', 'CA', 'AU']);

  const isCheckoutFormValid = (() => {
    const f = checkoutForm;
    const hasNames = f.firstName.trim() && f.lastName.trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.customerEmail.trim());
    const phoneDigits = String(f.phone || '').replace(/\D/g, '');
    const validPhone = phoneDigits.length >= 7;
    const country = String(f.country || '').toUpperCase();
    const validCountry = country.length === 2;
    const regionOk = !REGION_REQUIRED_FRONTEND.has(country) || !!f.region.trim();
    return Boolean(
      hasNames
      && validEmail
      && validPhone
      && f.addressLine1.trim()
      && f.city.trim()
      && f.postalCode.trim()
      && validCountry
      && regionOk
      && !shippingValidationMessage
    );
  })();

  const buildCheckoutPayload = () => {
    const f = checkoutForm;
    const combinedName = `${f.firstName.trim()} ${f.lastName.trim()}`.trim();
    const compactAddress = [f.addressLine1, f.addressLine2, f.city, f.region, f.postalCode, (f.country || '').toUpperCase()]
      .map((p) => String(p || '').trim()).filter(Boolean).join(', ');
    return {
      // Legacy fields (kept so older backend code paths still work)
      customerName: combinedName,
      customerEmail: f.customerEmail.trim(),
      address: compactAddress,
      // Structured shipping (new — what Printify actually uses)
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      phone: f.phone.trim(),
      addressLine1: f.addressLine1.trim(),
      addressLine2: f.addressLine2.trim(),
      city: f.city.trim(),
      region: f.region.trim(),
      postalCode: f.postalCode.trim(),
      country: (f.country || '').toUpperCase(),
      // Cart + pricing context
      items: cart,
      totalAmount: cartTotal,
      bundleCount: BUNDLE_ITEM_COUNT,
      bundlePrice: BUNDLE_ITEM_PRICE,
      shippingCost: shippingCost,
      bundleDiscount: bundleDiscount,
      couponCode: activeCoupon ? activeCoupon.code : null,
      promoCode: activeLeadPromo ? activeLeadPromo.code : null,
      currency,
    };
  };

  const createPayPalOrder = async () => {
    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      throw new Error('Variant mismatch');
    }

    if (!isCheckoutFormValid) {
      showToast(shippingValidationMessage || t('shipping_details'));
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

  // Generate a short, URL-safe order ID. crypto.randomUUID is available in all
  // modern browsers; we keep a tiny fallback for old engines just in case.
  const generateOrderId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `DS-${crypto.randomUUID().split('-')[0].toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      }
    } catch { /* ignore */ }
    return `DS-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  };

  const submitMeshulamPayment = async () => {
    if (isMeshulamProcessing) return;
    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      return;
    }
    if (!isCheckoutFormValid) {
      showToast(shippingValidationMessage || t('shipping_details'));
      return;
    }
    if (!isMeshulamAvailable) {
      showToast(t('payment_unavailable'));
      return;
    }
    if (!cart || cart.length === 0) {
      showToast(t('cart_empty') || t('payment_unavailable'));
      return;
    }

    setIsMeshulamProcessing(true);
    try {
      const fullName = `${(checkoutForm.firstName || '').trim()} ${(checkoutForm.lastName || '').trim()}`.trim()
        || (checkoutForm.customerName || '').trim();

      // Build the cart-items payload that the backend will persist into
      // order_items so the Meshulam webhook can dispatch them to CJ on success.
      const itemsPayload = (cart || []).map((item) => ({
        productId: item.id,
        variantId: item.variantId || null,
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        selectedColor: item.selectedColor || null,
        selectedSize: item.selectedSize || null,
      }));

      const response = await fetch(`${API_BASE}/api/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(Number(cartTotal || 0).toFixed(2)),
          paymentMethod, // meshulam_card or meshulam_bit
          customer: {
            fullName,
            email: (checkoutForm.customerEmail || '').trim(),
            phone: (checkoutForm.phone || '').trim(),
          },
          shipping: {
            firstName: (checkoutForm.firstName || '').trim(),
            lastName: (checkoutForm.lastName || '').trim(),
            addressLine1: (checkoutForm.addressLine1 || '').trim(),
            addressLine2: (checkoutForm.addressLine2 || '').trim(),
            city: (checkoutForm.city || '').trim(),
            region: (checkoutForm.region || '').trim(),
            postalCode: (checkoutForm.postalCode || '').trim(),
            country: (checkoutForm.country || 'IL').toUpperCase(),
          },
          items: itemsPayload,
          currency,
          locale,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok === true && data.redirectUrl) {
        // Persist a pending-order snapshot keyed on the REAL internal orderId
        // the backend returned — used by the /success page for reconciliation.
        try {
          sessionStorage.setItem('drip_street_pending_order', JSON.stringify({
            orderId: data.orderId,
            amount: Number(Number(cartTotal || 0).toFixed(2)),
            method: paymentMethod,
            createdAt: new Date().toISOString(),
            itemCount: cart.length,
          }));
        } catch { /* sessionStorage may be unavailable in private mode */ }

        showToast(t('payment_meshulam_processing'));
        // Do NOT clear the cart here — only after the success webhook lands.
        window.location.href = data.redirectUrl;
        return;
      }

      const reason = data && (data.details || data.error);
      showToast(reason || t('payment_unavailable'));
    } catch (err) {
      console.error('[meshulam] checkout failed:', err);
      showToast(err.message || GLOBAL_ERROR_TOAST_HE);
    } finally {
      setIsMeshulamProcessing(false);
    }
  };

  const submitCheckout = async (e) => {
    e.preventDefault();

    if (hasInvalidVariant) {
      showToast(t('variant_error_toast'));
      return;
    }

    if (!isCheckoutFormValid) {
      showToast(shippingValidationMessage || t('shipping_details'));
      return;
    }

    if (!isSelectedPaymentAvailable) {
      showToast(t('payment_unavailable'));
      return;
    }

    // Meshulam: hosted-page redirect flow.
    if (paymentMethod === 'meshulam_card' || paymentMethod === 'meshulam_bit') {
      await submitMeshulamPayment();
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
        showToast(data.error || t('payment_unavailable'));
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      showToast(err.message || GLOBAL_ERROR_TOAST_HE);
    }
  }

  // ── Abandoned Cart capture ───────────────────────────────────────────────
  // Fires on email input blur: validates email, builds a lightweight cart
  // fingerprint, and POSTs to /api/carts/abandoned in the background.
  // Fully fire-and-forget — errors are silently swallowed to never disrupt UX.
  const handleEmailBlur = () => {
    const email = (checkoutForm.customerEmail || '').trim();
    // Basic email format guard
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    // No point saving an empty cart
    if (!cart || cart.length === 0) return;

    // Lightweight fingerprint: sorted item IDs + quantities (no crypto needed)
    const fingerprint = cart
      .map((item) => `${item.id}:${item.selectedColor || ''}:${item.selectedSize || ''}:${item.quantity}`)
      .sort()
      .join('|');

    const payload = {
      email,
      cart_fingerprint: fingerprint,
      items: cart.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        selectedColor: item.selectedColor || null,
        selectedSize: item.selectedSize || null,
        imageUrl: item.imageUrl || null,
      })),
    };

    // fire-and-forget — never await, never block
    fetch(`${API_BASE}/api/carts/abandoned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* silently ignore network errors */ });
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Legacy cart drawer JSX kept for parity while the active drawer is rendered below.
  // eslint-disable-next-line no-unused-vars
  const cartDrawer = (
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

              const itemThumbnail = item.imageUrl || (Array.isArray(item.images) && item.images[0]) || null;
              return (
                <div key={item.cartId || item.id} className="cart-item" style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  {itemThumbnail && (
                    <img
                      loading="lazy"
                      decoding="async"
                      src={itemThumbnail}
                      alt={item.title}
                      style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, background: '#1a1a1a' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '14px', lineHeight: '1.3' }}>{getCartDisplayTitle(item.title, locale)}</strong>
                    {(selectedColor || selectedSize) && (
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {selectedColor && <span>{localizeColorName(selectedColor, locale)}</span>}
                        {selectedColor && selectedSize && <span> · </span>}
                        {selectedSize && <span>{selectedSize}</span>}
                      </div>
                    )}
                    <div className="cart-qty-controls" style={{ marginTop: '8px' }}>
                      <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity - 1)}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity + 1)}>+</button>
                      <button type="button" className="remove-btn" onClick={() => removeFromCart(item.cartId || `${item.id}`)}>🗑</button>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{curSym}{(itemPrice * item.quantity).toFixed(2)}</div>
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
                      <img loading="lazy" decoding="async" src={product.imageUrl} alt={product.title} onError={(e) => setImageFallback(e)} />
                      <strong>{getProductTitle(product.title, locale)}</strong>
                      <span>{curSym}{displayPrice.toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <CartUpsellRail
            items={jewelryUpsellCandidates}
            onQuickAdd={addUpsellToCart}
            curSym={curSym}
            displayVal={displayVal}
          />

          {cart.length > 0 && <CartDemandBanner locale={locale} totalItems={totalItems} />}
        </div>

        <div className="cart-footer">
          {totalItems > 0 && (
            <div className="shipping-progress cart-footer-progress">
              {isFreeShipping ? (
                <p className="shipping-unlocked">{t('shipping_unlocked')}</p>
              ) : (
                <>
                  <p className="shipping-hint">{t('shipping_hint', { amount: `${curSym}${displayVal(amountToFreeShipping).toFixed(2)}` })}</p>
                  <div className="progress-bar-bg">
                    <motion.div 
                      className="progress-bar-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${freeShippingProgress}%` }}
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

          <div className="cart-promo-section" style={{ marginTop: '12px', marginBottom: '8px', padding: '12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa', marginBottom: '8px' }}>
              🎟️ {t('promo_code')}?
            </div>
            <div className="cart-promo-row">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="MENI-XXXX / DRP-XXXX"
                className="cart-promo-input"
                style={{ flex: 1 }}
              />
              <button type="button" className="cart-promo-btn" onClick={applyLeadPromo} disabled={isApplyingPromo || !promoInput.trim()}>
                {isApplyingPromo ? '...' : t('promo_apply')}
              </button>
            </div>
          </div>

          {promoFeedback && (
            <div className={`cart-promo-feedback ${activeLeadPromo ? 'success' : 'error'}`}>
              {promoFeedback}
            </div>
          )}

          {activeLeadPromo && leadPromoDiscount > 0 && (
            <div className="cart-savings-line">
              <span>{t('promo_code')} ({activeLeadPromo.code})</span>
              <span style={{ color: '#4caf50' }}>-{curSym}{displayVal(leadPromoDiscount).toFixed(2)}</span>
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

          <p className="cart-taxes-note">{t('taxes_shipping_note')}</p>
          <button className="checkout-btn" data-track="cart_checkout" onClick={proceedToCheckout} disabled={cart.length === 0} style={{ opacity: cart.length === 0 ? 0.5 : 1 }}>
            {t('checkout')}
          </button>
          <CartTrustSignals locale={locale} />
          <div className="cart-payment-icons" aria-label={t('payment_icons_label')}>
            <svg viewBox="0 0 38 24" width="38" height="24" aria-label="Visa" role="img"><rect width="38" height="24" rx="4" fill="#1a1f71"/><text x="6" y="17" fontFamily="Arial" fontWeight="bold" fontSize="11" fill="#fff">VISA</text></svg>
            <svg viewBox="0 0 38 24" width="38" height="24" aria-label="Mastercard" role="img"><rect width="38" height="24" rx="4" fill="#252525"/><circle cx="15" cy="12" r="7" fill="#eb001b"/><circle cx="23" cy="12" r="7" fill="#f79e1b"/><path d="M19 6.8a7 7 0 0 1 0 10.4A7 7 0 0 1 19 6.8z" fill="#ff5f00"/></svg>
            <svg viewBox="0 0 38 24" width="38" height="24" aria-label="PayPal" role="img"><rect width="38" height="24" rx="4" fill="#003087"/><text x="5" y="16" fontFamily="Arial" fontWeight="bold" fontSize="9" fill="#009cde">Pay</text><text x="17" y="16" fontFamily="Arial" fontWeight="bold" fontSize="9" fill="#fff">Pal</text></svg>
          </div>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === '/cart') {
      setIsCartOpen(true);
    }
  }, [location.pathname]);

  // ============ ROUTE: SUCCESS ============
  if (currentPath === '/success') {
    return (
      <>
        <Helmet>
          <title>Order Confirmed | Drip Street</title>
          <meta name="description" content="Thank you for your order! Your payment was successful and we are processing your shipment." />
          <link rel="canonical" href="https://dripstreetshop.com/success" />
          <meta property="og:title" content="Order Confirmed | Drip Street" />
          <meta property="og:description" content="Thank you for your order! Your payment was successful and we are processing your shipment." />
          <meta property="og:url" content="https://dripstreetshop.com/success" />
          <meta property="og:image" content={GLOBAL_OG_IMAGE_URL} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:image" content={GLOBAL_OG_IMAGE_URL} />
        </Helmet>
        <div className="container" style={{ textAlign: 'center', padding: '100px 20px' }}>
          <motion.h1
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: '48px', marginBottom: '24px' }}>{t('success_title')}</motion.h1>
          <p style={{ fontSize: '20px', color: '#888', marginBottom: '32px' }}>
            {t('success_desc')}
          </p>
          <button className="checkout-btn" style={{ maxWidth: '250px' }} onClick={() => navigate('/')}>
            {t('return_home')}
          </button>
        </div>
      </>
    );
  }

  // ============ ROUTE: CART ============
  if (currentPath === '/cart') {
    return (
      <div className="container" style={{ paddingTop: '24px', paddingBottom: '60px' }}>
        <BackButton label="Continue Shopping" fallback="/" />
        <h1 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.01em', textTransform: 'uppercase', margin: '8px 0 32px' }}>
          {t('cart')} ({totalItems})
        </h1>

        {cart.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#888' }}>
            <p style={{ fontSize: '18px', marginBottom: '24px' }}>{t('cart_empty')}.</p>
            <button className="checkout-btn" style={{ maxWidth: '240px' }} onClick={() => navigate('/')}>
              {t('return_home')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* LEFT: Items */}
            <div style={{ flex: '2 1 480px', minWidth: 0 }}>
              {bundleActive ? (
                <div className="bundle-banner active" style={{ marginBottom: '20px' }}>{t('bundle_active')}</div>
              ) : totalItems === 2 ? (
                <div className="bundle-banner hint" style={{ marginBottom: '20px' }}>{t('bundle_hint')}</div>
              ) : null}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {cart.map((item) => {
                  const itemPrice = getCartUnitPrice(item, currency, exchangeRate);
                  const parsed = splitVariantTitle(item.title);
                  const selectedColor = item.selectedColor || parsed.color || '';
                  const selectedSize = normalizeSizeLabel(item.selectedSize || parsed.size || '');
                  const itemThumbnail = item.imageUrl || (Array.isArray(item.images) && item.images[0]) || null;
                  return (
                    <div
                      key={item.cartId || item.id}
                      style={{
                        display: 'flex', gap: '16px', alignItems: 'flex-start',
                        padding: '16px', background: '#0f0f0f',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px',
                      }}
                    >
                      {itemThumbnail && (
                        <img
                          loading="lazy"
                          decoding="async"
                          src={itemThumbnail}
                          alt={item.title}
                          style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, background: '#1a1a1a' }}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: '15px', lineHeight: 1.35 }}>{getCartDisplayTitle(item.title, locale)}</strong>
                        {(selectedColor || selectedSize) && (
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {selectedColor && <span>{localizeColorName(selectedColor, locale)}</span>}
                            {selectedColor && selectedSize && <span> · </span>}
                            {selectedSize && <span>{selectedSize}</span>}
                          </div>
                        )}
                        <div className="cart-qty-controls" style={{ marginTop: '12px' }}>
                          <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity - 1)}>−</button>
                          <span>{item.quantity}</span>
                          <button type="button" onClick={() => updateQuantity(item.cartId || `${item.id}`, item.quantity + 1)}>+</button>
                          <button type="button" className="remove-btn" onClick={() => removeFromCart(item.cartId || `${item.id}`)}>🗑</button>
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '16px', whiteSpace: 'nowrap', minWidth: '80px', textAlign: 'right' }}>
                        {curSym}{(itemPrice * item.quantity).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT: Summary */}
            <div style={{ flex: '1 1 320px', position: 'sticky', top: '24px', background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 20px', color: '#aaa' }}>
                {t('order_summary')}
              </h3>

              <CartDemandBanner locale={locale} totalItems={totalItems} />

              {totalItems > 0 && !isFreeShipping && (
                <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <p style={{ fontSize: '12px', margin: '0 0 8px', color: '#aaa' }}>{t('shipping_hint', { amount: `${curSym}${displayVal(amountToFreeShipping).toFixed(2)}` })}</p>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${freeShippingProgress}%`, background: '#fff', transition: 'width 0.4s' }} />
                  </div>
                </div>
              )}
              <div style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                {amountToBundleThreshold > 0 ? (
                  <p style={{ fontSize: '12px', margin: '0 0 8px', color: '#f3d7a2' }}>
                    {locale === 'he'
                      ? `הוסף עוד ${curSym}${displayVal(amountToBundleThreshold).toFixed(2)} כדי לנעול הנחת באנדל`
                      : `Add ${curSym}${displayVal(amountToBundleThreshold).toFixed(2)} more to unlock bundle savings`}
                  </p>
                ) : (
                  <p style={{ fontSize: '12px', margin: '0 0 8px', color: '#8dff9e' }}>
                    {locale === 'he' ? 'באנדל מחיר הופעל על הסל שלך 🎉' : 'Bundle pricing unlocked for your cart 🎉'}
                  </p>
                )}
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${bundleValueProgress}%`, background: '#ff6b35', transition: 'width 0.4s' }} />
                </div>
              </div>
              {isFreeShipping && (
                <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: '6px', textAlign: 'center', fontSize: '12px', color: '#4caf50', fontWeight: 600 }}>
                  🎉 {t('shipping_unlocked')}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#aaa' }}>
                <span>{t('subtotal')}</span>
                <span style={{ color: '#fff' }}>{curSym}{displayVal(baseSubtotal).toFixed(2)}</span>
              </div>

              {bundleDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#4caf50' }}>
                  <span>{t('bundle_deal', { sets: bundleSets })}</span>
                  <span>-{curSym}{displayVal(bundleDiscount).toFixed(2)}</span>
                </div>
              )}

              {couponDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#4caf50' }}>
                  <span>{t('coupon_label')} ({activeCoupon.code})</span>
                  <span>-{curSym}{displayVal(couponDiscount).toFixed(2)}</span>
                </div>
              )}

              {activeLeadPromo && leadPromoDiscount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', color: '#4caf50' }}>
                  <span>{t('promo_code')} ({activeLeadPromo.code})</span>
                  <span>-{curSym}{displayVal(leadPromoDiscount).toFixed(2)}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', color: isFreeShipping ? '#4caf50' : '#aaa' }}>
                <span>{t('shipping')}</span>
                <span>{isFreeShipping ? t('free') : `${curSym}${displayVal(shippingCost).toFixed(2)}`}</span>
              </div>

              <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '16px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '22px', marginBottom: '20px' }}>
                <span>{t('total')}</span>
                <span>{curSym}{displayVal(cartTotal).toFixed(2)}</span>
              </div>

              {/* Coupon entry */}
              <div style={{ padding: '14px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa', marginBottom: '10px' }}>
                  🎟️ {t('promo_code')}?
                </div>
                {!(activeLeadPromo || activeCoupon) ? (
                  <>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        placeholder="MENI-XXXX / DRP-XXXX"
                        style={{ flex: 1, minWidth: 0, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', fontSize: '14px' }}
                      />
                      <button
                        type="button"
                        onClick={applyLeadPromo}
                        disabled={isApplyingPromo || !promoInput.trim()}
                        style={{ padding: '10px 18px', background: '#fff', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.1em', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {isApplyingPromo ? '...' : t('promo_apply')}
                      </button>
                    </div>
                    {promoFeedback && (
                      <div style={{ marginTop: '8px', fontSize: '12px', color: (activeLeadPromo || activeCoupon) ? '#4caf50' : '#ff6b6b' }}>
                        {promoFeedback}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                    <span style={{ color: '#4caf50' }}>✓ {(activeLeadPromo && activeLeadPromo.code) || (activeCoupon && activeCoupon.code)} applied</span>
                    <button
                      type="button"
                      onClick={() => { setActiveLeadPromo(null); setActiveCoupon(null); setPromoInput(''); setPromoFeedback(''); }}
                      style={{ background: 'transparent', color: '#aaa', border: '1px solid #444', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <button type="button" className="checkout-btn" data-track="cart_page_checkout" style={{ width: '100%' }} onClick={proceedToCheckout} disabled={cart.length === 0}>
                {t('checkout')} →
              </button>

              <CartTrustSignals locale={locale} />

              <p style={{ fontSize: '11px', color: '#666', textAlign: 'center', marginTop: '12px' }}>
                Taxes and shipping calculated at checkout
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ ROUTE: CHECKOUT ============
  if (currentPath === '/checkout') {
    return (
      <>
        <Helmet>
          <title>Secure Checkout | Drip Street</title>
          <meta name="description" content="Complete your order securely at Drip Street checkout." />
          <link rel="canonical" href="https://dripstreetshop.com/checkout" />
          <meta property="og:title" content="Secure Checkout | Drip Street" />
          <meta property="og:description" content="Complete your order securely at Drip Street checkout." />
          <meta property="og:url" content="https://dripstreetshop.com/checkout" />
          <meta property="og:image" content={GLOBAL_OG_IMAGE_URL} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:image" content={GLOBAL_OG_IMAGE_URL} />
        </Helmet>
        <div className="container checkout-page">
          <div style={{ marginTop: '24px' }}><BackButton label="Back to Cart" fallback="/cart" /></div>
        <h1 style={{ marginTop: '16px' }}>{t('checkout_secure')}</h1>
        <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', marginTop: '32px' }}>
          <form className="contact-form" onSubmit={submitCheckout} style={{ flex: '1', minWidth: '300px' }}>
            <h3>{t('shipping_details')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                name="firstName"
                type="text"
                placeholder="First Name"
                autoComplete="given-name"
                required
                value={checkoutForm.firstName}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, firstName: e.target.value }))}
              />
              <input
                name="lastName"
                type="text"
                placeholder="Last Name"
                autoComplete="family-name"
                required
                value={checkoutForm.lastName}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, lastName: e.target.value }))}
              />
            </div>
            {locale === 'he' && (
              <p style={{ marginTop: '-4px', marginBottom: '12px', fontSize: '11px', color: '#888', textAlign: 'right' }}>
                יש להקליד שם באותיות באנגלית בלבד (לדוגמה: Israel Israeli)
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                name="customerEmail"
                type="email"
                placeholder="Email"
                autoComplete="email"
                required
                value={checkoutForm.customerEmail}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
                onBlur={handleEmailBlur}
              />
              <input
                name="phone"
                type="tel"
                placeholder="Phone (e.g. +972 50 123 4567)"
                autoComplete="tel"
                required
                value={checkoutForm.phone}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <input
              name="addressLine1"
              type="text"
              placeholder="Street address"
              autoComplete="address-line1"
              required
              value={checkoutForm.addressLine1}
              onChange={(e) => setCheckoutForm((prev) => ({ ...prev, addressLine1: e.target.value }))}
            />
            {locale === 'he' && (
              <p style={{ marginTop: '-4px', marginBottom: '12px', fontSize: '11px', color: '#888', textAlign: 'right' }}>
                יש להקליד כתובת באנגלית בלבד (לדוגמה: Herzl St 42)
              </p>
            )}
            <input
              name="addressLine2"
              type="text"
              placeholder="Apartment, suite, floor (optional)"
              autoComplete="address-line2"
              value={checkoutForm.addressLine2}
              onChange={(e) => setCheckoutForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                name="city"
                type="text"
                placeholder="City"
                autoComplete="address-level2"
                required
                value={checkoutForm.city}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, city: e.target.value }))}
              />
              <input
                name="region"
                type="text"
                placeholder={REGION_REQUIRED_FRONTEND.has(String(checkoutForm.country || '').toUpperCase()) ? 'State / Region' : 'State / Region (optional)'}
                autoComplete="address-level1"
                value={checkoutForm.region}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, region: e.target.value }))}
              />
            </div>
            {locale === 'he' && (
              <p style={{ marginTop: '-4px', marginBottom: '12px', fontSize: '11px', color: '#888', textAlign: 'right' }}>
                יש להקליד עיר באנגלית בלבד (לדוגמה: Tel Aviv)
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <input
                name="postalCode"
                type="text"
                placeholder="ZIP / Postal Code"
                autoComplete="postal-code"
                required
                value={checkoutForm.postalCode}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, postalCode: e.target.value }))}
              />
              <select
                name="country"
                required
                value={(checkoutForm.country || shippingCountry || 'IL').toUpperCase()}
                onChange={(e) => setCheckoutForm((prev) => ({ ...prev, country: e.target.value.toUpperCase() }))}
                style={{ width: '100%' }}
              >
                <option value="">— Select country —</option>
                <option value="IL">Israel</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="IT">Italy</option>
                <option value="ES">Spain</option>
                <option value="NL">Netherlands</option>
                <option value="BE">Belgium</option>
                <option value="SE">Sweden</option>
                <option value="NO">Norway</option>
                <option value="DK">Denmark</option>
                <option value="FI">Finland</option>
                <option value="CH">Switzerland</option>
                <option value="AT">Austria</option>
                <option value="IE">Ireland</option>
                <option value="PT">Portugal</option>
                <option value="PL">Poland</option>
                <option value="GR">Greece</option>
                <option value="NZ">New Zealand</option>
                <option value="JP">Japan</option>
                <option value="SG">Singapore</option>
                <option value="HK">Hong Kong</option>
                <option value="KR">South Korea</option>
                <option value="BR">Brazil</option>
                <option value="MX">Mexico</option>
                <option value="AR">Argentina</option>
                <option value="ZA">South Africa</option>
                <option value="AE">United Arab Emirates</option>
                <option value="IN">India</option>
              </select>
            </div>
            {shippingValidationMessage && (
              <p style={{ marginTop: '-6px', marginBottom: '10px', color: '#ff6b6b', fontSize: '0.9rem' }}>
                {shippingValidationMessage}
              </p>
            )}
            
            <h3 style={{ marginTop: '24px' }}>{t('payment_method')}</h3>
            <div style={{
              marginBottom: '12px',
              padding: '14px 16px',
              border: '1px solid #fff',
              borderRadius: '2px',
              background: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}>
              <span style={{
                fontSize: '11px',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#888',
                fontWeight: 700,
              }}>
                {locale === 'he' ? 'סה״כ לתשלום' : 'Total to pay'}
              </span>
              <span style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '0.02em', color: '#fff' }}>
                {curSym}{displayVal(cartTotal).toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {isMeshulamAvailable && (
                <label
                  data-track="payment_select_meshulam_card"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '14px', border: `1px solid ${paymentMethod === 'meshulam_card' ? '#fff' : '#333'}`, borderRadius: '2px', background: paymentMethod === 'meshulam_card' ? '#0a0a0a' : 'transparent' }}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="meshulam_card"
                    checked={paymentMethod === 'meshulam_card'}
                    onChange={() => setPaymentMethod('meshulam_card')}
                  />
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, letterSpacing: '0.02em' }}>{t('payment_meshulam_card')}</div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{t('payment_meshulam_card_sub')}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 6px', background: '#1a1f71', color: '#fff', borderRadius: '2px', fontSize: '10px', fontWeight: 700 }}>VISA</span>
                      <span style={{ padding: '2px 6px', background: '#eb001b', color: '#fff', borderRadius: '2px', fontSize: '10px', fontWeight: 700 }}>MC</span>
                      <span style={{ padding: '2px 6px', background: '#0a3d62', color: '#fff', borderRadius: '2px', fontSize: '10px', fontWeight: 700 }}>ISRACARD</span>
                      <span style={{ padding: '2px 6px', background: '#000', color: '#fff', borderRadius: '2px', fontSize: '10px', border: '1px solid #555', fontWeight: 700 }}>Pay</span>
                    </div>
                  </span>
                </label>
              )}
              {isMeshulamAvailable && (
                <label
                  data-track="payment_select_meshulam_bit"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '14px', border: `1px solid ${paymentMethod === 'meshulam_bit' ? '#fff' : '#333'}`, borderRadius: '2px', background: paymentMethod === 'meshulam_bit' ? '#0a0a0a' : 'transparent' }}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="meshulam_bit"
                    checked={paymentMethod === 'meshulam_bit'}
                    onChange={() => setPaymentMethod('meshulam_bit')}
                  />
                  <span style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span aria-hidden="true" style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '32px',
                        height: '20px',
                        background: '#0066ff',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 900,
                        letterSpacing: '0.04em',
                        borderRadius: '2px',
                      }}>BIT</span>
                      <span style={{ fontWeight: 700, letterSpacing: '0.02em' }}>{t('payment_meshulam_bit')}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{t('payment_meshulam_bit_sub')}</div>
                  </span>
                </label>
              )}
              {isStripeAvailable && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px', border: `1px solid ${paymentMethod === 'stripe' ? '#fff' : '#333'}`, borderRadius: '8px' }}>
                  <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} />
                  <span style={{ flex: 1 }}>
                    <div>{t('payment_card_apple_google')}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span style={{ padding: '2px 6px', background: '#1a1f71', color: '#fff', borderRadius: '3px', fontSize: '10px' }}>VISA</span>
                      <span style={{ padding: '2px 6px', background: '#eb001b', color: '#fff', borderRadius: '3px', fontSize: '10px' }}>MC</span>
                      <span style={{ padding: '2px 6px', background: '#000', color: '#fff', borderRadius: '3px', fontSize: '10px' }}>Pay</span>
                      <span style={{ padding: '2px 6px', background: '#4285f4', color: '#fff', borderRadius: '3px', fontSize: '10px' }}>G Pay</span>
                    </div>
                  </span>
                </label>
              )}
              {isPayPalAvailable && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px', border: `1px solid ${paymentMethod === 'paypal' ? '#fff' : '#333'}`, borderRadius: '8px' }}>
                  <input type="radio" name="payment" value="paypal" checked={paymentMethod === 'paypal'} onChange={() => setPaymentMethod('paypal')} />
                  <span>{t('payment_paypal')}</span>
                </label>
              )}
            </div>
            {paymentMethod === 'paypal' ? (
              isPayPalAvailable ? (
                <>
                <div className="premium-paypal-container" style={{
                  padding: '24px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                  marginBottom: '20px'
                }}>
                  <div style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#ffd24d',
                    textAlign: 'center',
                    marginBottom: '16px'
                  }}>
                    ⚡ {locale === 'he' ? 'קופת תשלום אקספרס מאובטחת' : 'Secure Express Checkout'} ⚡
                  </div>
                  <PayPalScriptProvider options={{ 'client-id': paypalClientId, currency, intent: 'capture', 'disable-funding': 'card,credit,paylater,venmo' }}>
                    <PayPalButtons
                      fundingSource="paypal"
                      style={{ layout: 'horizontal', label: 'checkout', height: 48, shape: 'rect' }}
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
                          showToast(locale === 'he' ? 'התשלום בוצע בהצלחה! 🎉' : 'Payment Successful! 🎉');
                          navigate('/success');
                        } catch (err) {
                          showToast(err.message || GLOBAL_ERROR_TOAST_HE);
                        } finally {
                          setIsPayPalProcessing(false);
                        }
                      }}
                      onError={() => {
                        showToast(GLOBAL_ERROR_TOAST_HE);
                      }}
                      disabled={isPayPalProcessing || !isCheckoutFormValid || cart.length === 0 || !isSelectedPaymentAvailable}
                    />
                  </PayPalScriptProvider>
                  <div style={{
                    marginTop: '16px',
                    fontSize: '11px',
                    color: '#888',
                    textAlign: 'center',
                    lineHeight: '1.4'
                  }}>
                    {locale === 'he'
                      ? '🔐 עיבוד נתונים מוצפן מקצה לקצה. כרטיסי אשראי ישראלים ובינלאומיים מתקבלים דרך פייפאל.'
                      : '🔐 Encrypted end-to-end processing. All major local & global credit cards accepted.'}
                  </div>
                </div>
                </>
              ) : (
                <p style={{ color: '#ff6b6b', marginBottom: '16px' }}>PayPal is not configured yet. Please try again in a moment.</p>
              )
            ) : (
              <button
                type="submit"
                className="checkout-btn"
                data-track={paymentMethod === 'meshulam_bit' ? 'checkout_submit_bit' : (paymentMethod === 'meshulam_card' ? 'checkout_submit_meshulam_card' : 'checkout_submit')}
                disabled={isMeshulamProcessing || !isCheckoutFormValid || cart.length === 0 || !isSelectedPaymentAvailable}
                style={{ opacity: isMeshulamProcessing ? 0.7 : 1 }}
              >
                {isMeshulamProcessing
                  ? t('payment_meshulam_processing')
                  : `${t('complete_order')} – ${curSym}${displayVal(cartTotal).toFixed(2)}`}
              </button>
            )}
          </form>
          
          <div style={{ flex: '1', minWidth: '300px', backgroundColor: '#111', padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
            <h3>{t('order_summary')}</h3>
            <CartUpsellRail
              items={jewelryUpsellCandidates}
              onQuickAdd={addUpsellToCart}
              curSym={curSym}
              displayVal={displayVal}
            />
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

            {activeLeadPromo && leadPromoDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#4caf50' }}>
                <span>{t('promo_code')} ({activeLeadPromo.code})</span>
                <span>-{curSym}{displayVal(leadPromoDiscount).toFixed(2)}</span>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '20px', marginBottom: '20px' }}>
              <span>{t('total')}</span>
              <span>{curSym}{displayVal(cartTotal).toFixed(2)}</span>
            </div>

            {/* Promo code input — same logic as cart drawer (DRP-* lead codes + MENI-* admin coupons) */}
            <div style={{ padding: '14px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa', marginBottom: '10px' }}>
                🎟️ {t('promo_code')}?
              </div>
              {!(activeLeadPromo || activeCoupon) ? (
                <>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      placeholder="MENI-XXXX / DRP-XXXX"
                      className="cart-promo-input"
                      style={{ flex: 1, minWidth: 0, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px', color: '#fff', fontSize: '14px' }}
                    />
                    <button
                      type="button"
                      onClick={applyLeadPromo}
                      disabled={isApplyingPromo || !promoInput.trim()}
                      style={{ padding: '10px 18px', background: '#fff', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.1em', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {isApplyingPromo ? '...' : t('promo_apply')}
                    </button>
                  </div>
                  {promoFeedback && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: (activeLeadPromo || activeCoupon) ? '#4caf50' : '#ff6b6b' }}>
                      {promoFeedback}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: '#4caf50' }}>
                    ✓ {(activeLeadPromo && activeLeadPromo.code) || (activeCoupon && activeCoupon.code)} applied
                  </span>
                  <button
                    type="button"
                    onClick={() => { setActiveLeadPromo(null); setActiveCoupon(null); setPromoInput(''); setPromoFeedback(''); }}
                    style={{ background: 'transparent', color: '#aaa', border: '1px solid #444', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  const bestSellerProducts = (() => {
    const inStockProducts = products.filter((product) => Number(product.stock ?? 1) !== 0);
    const shirtCandidates = inStockProducts.filter((product) => deriveProductCategory(product) === 'Shirts');
    const source = shirtCandidates.length >= 4 ? shirtCandidates : inStockProducts;
    return source.slice(0, 4);
  })();

  const hardwareProducts = products
    .filter((product) => [17, 18, 19, 20, 21].includes(Number(product.id)))
    .sort((a, b) => Number(a.id) - Number(b.id));

  const homeContent = (
    <>
      {activeCoupon && (
        <motion.div 
          initial={{ y: -50 }} animate={{ y: 0 }} 
          className="promo-banner"
        >
          {t('flash_sale', { code: activeCoupon.code, discount: activeCoupon.discount_pct })}
        </motion.div>
      )}

      <section className="hero">
        <div className="container hero-content">
          <motion.span className="hero-eyebrow" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            DRIP STREET SIGNATURE DROP
          </motion.span>
          <motion.h1 className="hero-value-prop" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            PREMIUM STREETWEAR. ZERO GUESSWORK FIT.
          </motion.h1>
          <motion.p className="hero-vibe-subtitle" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
            Heavyweight essentials engineered for daily city movement, late-night edge, and effortless rotation.
          </motion.p>
          <motion.ul className="hero-bullets" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
            <li>Premium heavyweight cotton that keeps its shape.</li>
            <li>Relaxed street fit with clean shoulder structure.</li>
            <li>High-definition print that stays sharp wash after wash.</li>
            <li>Built for day-to-night outfits without overthinking it.</li>
          </motion.ul>
          <motion.div className="hero-cta-group" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}>
            <button className="hero-cta-primary drip-cta" onClick={() => { setActiveCategory('All'); const elem = document.querySelector('.categories-nav'); if(elem) elem.scrollIntoView({ behavior: 'smooth' }); }}>
              Shop The Drop
            </button>
            <button className="hero-cta-secondary drip-cta" onClick={() => { setActiveCategory('Shirts'); const elem = document.querySelector('.categories-nav'); if(elem) elem.scrollIntoView({ behavior: 'smooth' }); }}>
              Explore Best Sellers
            </button>
          </motion.div>

          <motion.div 
            className="featured-jewelry-banner" 
            initial={{ scale: 0.95, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }} 
            transition={{ delay: 0.5 }}
            onClick={() => navigate('/product/16')}
            style={{
              cursor: 'pointer',
              marginTop: '40px',
              padding: '20px 24px',
              background: '#050505',
              border: '1px solid rgba(255,255,255,0.26)',
              borderRadius: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              maxWidth: '680px',
              marginInline: 'auto',
              textAlign: 'left'
            }}
          >
            <div>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#f3f4f6', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                {locale === 'he' ? '✨ קולקציה חדשה: תכשיטי פרימיום' : '✨ NEW COLLECTION: PREMIUM JEWELRY'}
              </span>
              <h4 style={{ margin: '4px 0', fontSize: '16px', fontWeight: 700, color: '#f3f4f6', letterSpacing: '-0.01em' }}>
                {locale === 'he' ? 'שרשרת קובנית עם ליטוש 6 פיאות' : 'Six-sided Grinding Cuban Link Chain'}
              </h4>
              <p style={{ margin: 0, fontSize: '13px', color: '#d1d5db', maxWidth: '480px' }}>
                {locale === 'he' 
                  ? 'נחתכה במיוחד עם שש פיאות שטוחות ללכידת אור מירבית. פלדת אל-חלד מוצקה בציפוי זהב עמוק.'
                  : 'Meticulously faceted with six flat-cut facets per link. Solid stainless steel plated in deep gold.'}
              </p>
            </div>
            <button style={{
              padding: '8px 16px',
              background: '#f3f4f6',
              color: '#050505',
              border: '1px solid #f3f4f6',
              borderRadius: '2px',
              fontWeight: 700,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}>
              {locale === 'he' ? 'גלה עכשיו' : 'Discover'}
            </button>
          </motion.div>
        </div>
      </section>

      {!isLoading && hardwareProducts.length > 0 && (
        <section className="hardware-section">
          <div className="container">
            <div className="hardware-head">
              <h2>HARDWARE</h2>
              <p>Five precision jewelry statements built for brutal everyday rotation.</p>
            </div>
            <div className="hardware-grid">
              {hardwareProducts.map((product) => {
                const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / exchangeRate)) : product.price;
                return (
                  <article key={`hardware-${product.id}`} className="hardware-card">
                    <button type="button" className="hardware-image-btn" onClick={() => navigate(`/product/${product.id}`)}>
                      <img src={product.imageUrl} alt={getProductTitle(product.title, locale)} loading="lazy" onError={(e) => setImageFallback(e)} />
                    </button>
                    <div className="hardware-meta">
                      <h3>{getProductTitle(product.title, locale)}</h3>
                      <span>{curSym}{displayPrice.toFixed(2)}</span>
                    </div>
                    <button type="button" className="hardware-cta" onClick={() => navigate(`/product/${product.id}`)}>
                      View Item
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {!isLoading && bestSellerProducts.length > 0 && (
        <section className="best-sellers-section container">
          <div className="best-sellers-head">
            <h2>Best Sellers</h2>
            <p className="text-gray-300">Most-loved pieces customers keep reordering for fit, quality, and everyday styling.</p>
          </div>
          <div className="best-sellers-grid">
            {bestSellerProducts.map((product) => {
              const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / exchangeRate)) : product.price;
              return (
                <article key={`bestseller-${product.id}`} className="best-seller-card">
                  <button type="button" className="best-seller-image-btn" onClick={() => navigate(`/product/${product.id}`)}>
                    <img loading="lazy" src={product.imageUrl} alt={getProductTitle(product.title, locale)} onError={(e) => setImageFallback(e)} />
                  </button>
                  <div className="best-seller-content">
                    <h3>{getProductTitle(product.title, locale)}</h3>
                    <span>{curSym}{displayPrice.toFixed(2)}</span>
                    <div className="best-seller-actions">
                      <button type="button" className="quick-add-btn" onClick={() => openQuickAdd(product)}>Quick Add</button>
                      <button type="button" className="best-seller-link-btn" onClick={() => navigate(`/product/${product.id}`)}>View Product</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <main className="container">
        <div className="categories-nav">
          {categories.map(cat => {
            const catKeys = {
              'All': 'all',
              'New Arrivals': 'new_arrivals',
              'Hoodies': 'hoodies',
              'Shirts': 'tshirts',
              'Tank Tops': 'tank_tops',
              'Jewelry': 'jewelry'
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
              <>
                <div className="drip-spinner" style={{ gridColumn: '1 / -1' }}>
                  <div className="drip-spinner-dot" />
                  <div className="drip-spinner-dot" />
                  <div className="drip-spinner-dot" />
                </div>
                {Array.from({length: 4}).map((_, i) => (
                  <div key={`skel-${i}`} className="product-card skeleton-card">
                    <div className="skeleton skeleton-image"></div>
                    <div style={{ marginTop: '16px' }}>
                      <div className="skeleton skeleton-text"></div>
                      <div className="skeleton skeleton-text" style={{ width: '40%' }}></div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              filteredProducts.map((product, productIndex) => {
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
                      onClick={() => navigate(`/product/${product.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <img loading={productIndex === 0 ? 'eager' : 'lazy'} src={product.imageUrl} alt={getProductTitle(product.title, locale)} className="product-image front-img" onError={(e) => setImageFallback(e)} />
                      {product.backImageUrl && (
                        <img loading="lazy" src={product.backImageUrl} alt={`${getProductTitle(product.title, locale)} — back view`} className="product-image back-img" onError={(e) => setImageFallback(e, product.imageUrl || GLOBAL_IMAGE_FALLBACK)} />
                      )}
                      {isTeeProduct(product) && <PromoDealBadge locale={locale} curSym={curSym} displayVal={displayVal} />}
                      <img src="/brand/drip-mark.png" aria-hidden="true" className="product-card-watermark" alt="" draggable="false" />
                    </div>
                    <div className="product-card-content">
                      <div className="product-info">
                        <h3 
                          className="product-title" 
                          onClick={() => navigate(`/product/${product.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          {getProductTitle(product.title, locale)}
                        </h3>
                        <span className="product-price">{curSym}{displayPrice.toFixed(2)}</span>
                      </div>
                      <div className="product-card-actions">
                        <button className="add-to-cart" data-track="grid_add_to_cart" aria-label={`${t('add_to_cart')} ${getProductTitle(product.title, locale)}`} onClick={() => openQuickAdd(product)}>
                          {t('add_to_cart')}
                        </button>
                        <div className="product-card-signals" aria-label="Material and shipping highlights">
                          <div className="product-card-signal-block">
                            <strong>Material & Fit</strong>
                            <ul>
                              <li>Premium Heavyweight Cotton</li>
                              <li>Relaxed Street Fit</li>
                            </ul>
                          </div>
                          <div className="product-card-signal-block">
                            <strong>Shipping & Returns</strong>
                            <ul>
                              <li>Tracked Shipping</li>
                              <li>Easy 14-Day Returns</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      {/* ─── Trending Now ─── */}
      {!isLoading && products.length > 0 && (
        <section className="trending-section container">
          <h2 className="trending-title">{t('trending_title')}</h2>
          <div className="trending-scroll">
            {products.slice(0, 6).map((product) => {
              const displayPrice = currency === 'USD' ? (product.priceUSD || (product.price / exchangeRate)) : product.price;
              return (
                <button
                  key={`trend-${product.id}`}
                  type="button"
                  className="trending-card"
                  onClick={() => navigate(`/product/${product.id}`)}
                >
                  <div className="trending-card-img-wrap">
                    <img loading="lazy" src={product.imageUrl} alt={getProductTitle(product.title, locale)} onError={(e) => setImageFallback(e)} />
                  </div>
                  <div className="trending-card-info">
                    <span className="trending-card-title">{getProductTitle(product.title, locale)}</span>
                    <span className="trending-card-price">{curSym}{displayPrice.toFixed(2)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Why DRIP STREET ─── */}
      <section className="why-section container">
        <h2 className="why-title">{t('why_title')}</h2>
        <div className="why-grid">
          <div className="why-card">
            <div className="why-icon">🌍</div>
            <strong>{t('why_shipping')}</strong>
            <p>{t('why_shipping_desc')}</p>
          </div>
          <div className="why-card">
            <div className="why-icon">🔒</div>
            <strong>{t('why_secure')}</strong>
            <p>{t('why_secure_desc')}</p>
          </div>
          <div className="why-card">
            <div className="why-icon">👕</div>
            <strong>{t('why_quality')}</strong>
            <p>{t('why_quality_desc')}</p>
          </div>
          <div className="why-card">
            <div className="why-icon">↩️</div>
            <strong>{t('why_returns')}</strong>
            <p>{t('why_returns_desc')}</p>
          </div>
        </div>
      </section>
    </>
  );

  return (
    <>
      {/* Hidden SVG host providing the gooey filter referenced by .drip-spinner-dot */}
      <svg className="goo-filter-host" aria-hidden="true" focusable="false">
        <defs>
          <filter id="drip-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
        <div className="announcement-bar">
        {t('announcement')}
      </div>

      <header className={`header container storefront-header${isHeaderScrolled ? ' scrolled' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="header-leading">
          <button className="nav-toggle" type="button" aria-label="Open navigation" onClick={openMobileNav}>
            <span />
            <span />
            <span />
          </button>
          <a href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '10px' }} onClick={(e) => { e.preventDefault(); navigate('/'); }}><img src="/brand/drip-mark.png" alt="" aria-hidden="true" className="brand-mark" style={{ height: '42px', width: '42px', objectFit: 'contain', display: 'block' }} /><img src="/logo-wordmark.svg" alt={t('logo')} className="logo-image" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/logo.svg'; }} style={{ height: '38px', width: 'auto', display: 'block' }} /></a>
        </div>
        <div className="search-bar">
          <input 
            type="text"
            dir="ltr"
            placeholder={t('search_placeholder')} 
            value={searchQuery}
            aria-label={t('search_aria')}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="lang-toggle-btn hide-on-mobile" onClick={toggleLocale}>
            {locale === 'he' ? 'EN' : 'עב'}
          </button>
          <button className="cart-btn cart-btn-pill" aria-label={t('open_cart_aria')} onClick={() => navigate('/cart')}>
            <span>🛒 {t('cart')}</span>
            {totalItems > 0 && <span className={`cart-badge ${cartBadgePulse ? 'pulse' : ''}`}>{totalItems}</span>}
          </button>
        </div>
      </header>

      <div className={`side-nav-overlay ${isMobileNavOpen ? 'open' : ''}`} onClick={closeMobileNav}>
        <aside className="side-nav-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="side-nav-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <img src="/brand/drip-mark.png" alt="" aria-hidden="true" style={{ height: '28px', width: '28px', objectFit: 'contain' }} />
              <strong>{t('logo')}</strong>
            </span>
            <button type="button" className="side-nav-close" onClick={closeMobileNav} aria-label="Close navigation">×</button>
          </div>
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
                {cat === 'All' ? t('all') : cat === 'New Arrivals' ? t('new_arrivals') : cat === 'Hoodies' ? t('hoodies') : cat === 'Shirts' ? t('tshirts') : cat === 'Tank Tops' ? t('tank_tops') : cat === 'Jewelry' ? t('jewelry') : cat}
              </button>
            ))}
            <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="button" className="side-nav-link" onClick={() => { toggleLocale(); closeMobileNav(); }} style={{ textAlign: locale === 'he' ? 'right' : 'left', display: 'flex', alignItems: 'center', gap: '8px', color: '#888' }}>
                🌐 {locale === 'he' ? 'English (EN)' : 'עברית (HE)'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      <Routes>
        <Route path="/" element={homeContent} />
        <Route path="/cart" element={homeContent} />
        <Route path="/product/:productId" element={
          <ProductDetailRoute
            addToCart={addToCart}
            goToCheckout={goToCheckoutNow}
            showToast={showToast}
            t={t}
            currency={currency}
            curSym={curSym}
            locale={locale}
            cartCount={totalItems}
            onOpenCart={() => navigate('/cart')}
          />
        } />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/refund" element={<RefundPolicy />} />
        <Route path="/shipping" element={<Shipping />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={
          <div className="container legal-page" style={{textAlign: 'center', padding: '100px 20px'}}>
            <h1 style={{ fontSize: '36px', textTransform: 'uppercase', marginBottom: '16px' }}>{t('not_found_title')}</h1>
            <button className="checkout-btn" style={{ maxWidth: '200px', marginTop: '24px' }} onClick={() => navigate('/')}>{t('return_home')}</button>
          </div>
        } />
      </Routes>

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
                    key={`${quickAddColor}-${quickAddActiveImage}`}
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
                    <button type="button" className="quick-config-primary" data-track="quick_add_to_cart" onClick={submitQuickAdd}>{t('add_selected_to_cart')}</button>
                  </div>

                  <div className="quick-config-trust">
                    <div>
                      <strong>Material & Fit</strong>
                      <span>Premium Heavyweight Cotton · Relaxed Street Fit</span>
                    </div>
                    <div>
                      <strong>Shipping & Returns</strong>
                      <span>Tracked Delivery · Easy 14-Day Returns</span>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>



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
                        <img loading="lazy" decoding="async" src={product.imageUrl} alt={product.title} onError={(e) => setImageFallback(e)} />
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
            {shirtsInCart > 0 && (
              <div className="bundle-progress cart-footer-progress" style={{ marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
                {shirtsToNextBundle === 0 ? (
                  <p className="shipping-unlocked" style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: '0 0 4px 0', fontWeight: '600' }}>
                    {locale === 'he' ? '🎉 מבצע חולצות (3 ב-229 ₪) פעיל בסל!' : '🎉 3-shirt bundle deal active!'}
                  </p>
                ) : (
                  <>
                    <p className="shipping-hint" style={{ fontSize: '13px', margin: '0 0 8px 0', color: '#999' }}>
                      {locale === 'he'
                        ? `הוסף עוד ${shirtsToNextBundle} ${shirtsToNextBundle === 1 ? 'חולצה' : 'חולצות'} לקבלת מבצע 3 ב-229 ₪ (חיסכון של 40 ₪!)`
                        : `Add ${shirtsToNextBundle} more T-shirt${shirtsToNextBundle > 1 ? 's' : ''} to get 3 for 229 ₪ (Save 40 ₪!)`}
                    </p>
                    <div className="progress-bar-bg" style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '999px', overflow: 'hidden' }}>
                      <motion.div 
                        className="progress-bar-fill"
                        style={{ background: 'rgba(255,255,255,0.4)', height: '100%' }}
                        initial={{ width: 0 }}
                        animate={{ width: `${bundleProgressPercent}%` }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            {totalItems > 0 && (
              <div className="shipping-progress cart-footer-progress">
                {isFreeShipping ? (
                  <p className="shipping-unlocked">{t('shipping_unlocked')}</p>
                ) : (
                  <>
                    <p className="shipping-hint">{t('shipping_hint', { amount: `${curSym}${displayVal(amountToFreeShipping).toFixed(2)}` })}</p>
                    <div className="progress-bar-bg">
                      <motion.div 
                        className="progress-bar-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${freeShippingProgress}%` }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="shipping-progress cart-footer-progress" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
              {amountToBundleThreshold > 0 ? (
                <p className="shipping-hint">
                  {locale === 'he'
                    ? `הוסף עוד ${curSym}${displayVal(amountToBundleThreshold).toFixed(2)} כדי לנעול הנחת באנדל`
                    : `Add ${curSym}${displayVal(amountToBundleThreshold).toFixed(2)} more to unlock bundle savings`}
                </p>
              ) : (
                <p className="shipping-unlocked">{locale === 'he' ? 'הנחת באנדל פעילה 🎉' : 'Bundle savings active 🎉'}</p>
              )}
              <div className="progress-bar-bg">
                <motion.div
                  className="progress-bar-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${bundleValueProgress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>
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
              <span>
                {activeLeadPromo && leadPromoDiscount > 0 && (
                  <span className="cart-total-old">{curSym}{displayVal(subtotalAfterDiscounts + shippingCost).toFixed(2)}</span>
                )}
                {curSym}{displayVal(cartTotal).toFixed(2)}
              </span>
            </div>

            <p className="cart-taxes-note">{t('taxes_shipping_note')}</p>
            <button className="checkout-btn" data-track="drawer_checkout" onClick={proceedToCheckout} disabled={cart.length === 0} style={{ opacity: cart.length === 0 ? 0.5 : 1 }}>
              {t('checkout')}
            </button>
            <div className="cart-payment-icons" aria-label={t('payment_icons_label')}>
              <svg viewBox="0 0 38 24" width="38" height="24" aria-label="Visa" role="img"><rect width="38" height="24" rx="4" fill="#1a1f71"/><text x="6" y="17" fontFamily="Arial" fontWeight="bold" fontSize="11" fill="#fff">VISA</text></svg>
              <svg viewBox="0 0 38 24" width="38" height="24" aria-label="Mastercard" role="img"><rect width="38" height="24" rx="4" fill="#252525"/><circle cx="15" cy="12" r="7" fill="#eb001b"/><circle cx="23" cy="12" r="7" fill="#f79e1b"/><path d="M19 6.8a7 7 0 0 1 0 10.4A7 7 0 0 1 19 6.8z" fill="#ff5f00"/></svg>
              <svg viewBox="0 0 38 24" width="38" height="24" aria-label="PayPal" role="img"><rect width="38" height="24" rx="4" fill="#003087"/><text x="5" y="16" fontFamily="Arial" fontWeight="bold" fontSize="9" fill="#009cde">Pay</text><text x="17" y="16" fontFamily="Arial" fontWeight="bold" fontSize="9" fill="#fff">Pal</text></svg>
            </div>
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
      <AnimatePresence>
        <LeadCapturePopup t={t} currentPath={currentPath} />
      </AnimatePresence>
      <Footer locale={locale} />
      <CookieConsent />
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <MainApp />
      </Router>
    </ErrorBoundary>
  )
}
