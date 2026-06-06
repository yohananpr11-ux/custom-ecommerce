/**
 * Analytics + Marketing Pixels utility.
 *
 * Three providers, one bootstrap:
 *   - GA4         (gtag)
 *   - Meta Pixel  (fbq)
 *   - TikTok Pixel(ttq)
 *
 * Init is fully conditional: a provider's script is only loaded if its env var
 * is set to a real ID (not a placeholder). All event helpers are no-ops when
 * the corresponding provider isn't initialized — safe to call from anywhere.
 *
 * Env vars (frontend/.env):
 *   VITE_GA4_ID
 *   VITE_META_PIXEL_ID
 *   VITE_TIKTOK_PIXEL_ID
 *
 * Dev-mode console logging: every event is logged with the [pixel] prefix
 * when import.meta.env.DEV is true, regardless of whether real IDs are set.
 */

const GA4_ID = (import.meta.env.VITE_GA4_ID || 'G-XXXXXXXXXX').trim();
const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID || 'PIXEL_ID_HERE').trim();
const TIKTOK_PIXEL_ID = (import.meta.env.VITE_TIKTOK_PIXEL_ID || 'TIKTOK_PIXEL_ID_HERE').trim();

const isPlaceholderId = (value) => !value || /^(G-XXXXXXXXXX|PIXEL_ID_HERE|TIKTOK_PIXEL_ID_HERE|null|undefined)$/i.test(value);

const isDev = Boolean(import.meta.env.DEV);
const devLog = (...args) => { if (isDev) console.log('[pixel]', ...args); };

// ─── GA4 ─────────────────────────────────────────────────────────────────────

function injectGA4() {
  if (isPlaceholderId(GA4_ID)) return;
  if (document.getElementById('ga4-script')) return;

  const script1 = document.createElement('script');
  script1.id = 'ga4-script';
  script1.async = true;
  script1.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(script1);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID, { send_page_view: false });
}

// ─── Meta Pixel ──────────────────────────────────────────────────────────────

function injectMetaPixel() {
  if (isPlaceholderId(META_PIXEL_ID)) return;
  if (window.fbq || document.getElementById('meta-pixel-script')) return;

  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.id = 'meta-pixel-script';
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', META_PIXEL_ID);
}

// ─── TikTok Pixel ────────────────────────────────────────────────────────────

function injectTikTokPixel() {
  if (isPlaceholderId(TIKTOK_PIXEL_ID)) return;
  if (window.ttq || document.getElementById('tiktok-pixel-script')) return;

  // Standard TikTok Pixel base code (lightly normalized for readability).
  /* eslint-disable */
  !function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = w[t] = w[t] || [];
    ttq.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) {
      for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
      return e;
    };
    ttq.load = function (e, n) {
      var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      var o = n && n.partner;
      ttq._i = ttq._i || {};
      ttq._i[e] = [];
      ttq._i[e]._u = r;
      ttq._t = ttq._t || {};
      ttq._t[e] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[e] = n || {};
      n = document.createElement('script');
      n.type = 'text/javascript';
      n.async = !0;
      n.id = 'tiktok-pixel-script';
      n.src = r + '?sdkid=' + e + '&lib=' + t;
      var s = document.getElementsByTagName('script')[0];
      s.parentNode.insertBefore(n, s);
    };
    ttq.load(TIKTOK_PIXEL_ID);
    ttq.page();
  }(window, document, 'ttq');
  /* eslint-enable */
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call once on app bootstrap.
 */
export function initAnalytics() {
  try {
    injectGA4();
    injectMetaPixel();
    injectTikTokPixel();
    devLog('init', {
      ga4: !isPlaceholderId(GA4_ID),
      meta: !isPlaceholderId(META_PIXEL_ID),
      tiktok: !isPlaceholderId(TIKTOK_PIXEL_ID),
    });
  } catch (err) {
    console.warn('[analytics] init failed:', err);
  }
}

/**
 * Fire a PageView for the given path on every provider.
 */
export function trackPageView(path) {
  try {
    devLog('PageView', { path });
    if (!isPlaceholderId(GA4_ID) && typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', { page_path: path });
    }
    if (!isPlaceholderId(META_PIXEL_ID) && typeof window.fbq === 'function') {
      window.fbq('track', 'PageView');
    }
    if (!isPlaceholderId(TIKTOK_PIXEL_ID) && window.ttq && typeof window.ttq.page === 'function') {
      window.ttq.page();
    }
  } catch (err) {
    console.warn('[analytics] pageview failed:', err);
  }
}

/**
 * ViewContent — fires on PDP mount.
 * @param {{ id: number|string, title: string, price: number }} product
 * @param {string} currency - 'ILS' | 'USD'
 */
export function trackViewItem(product, currency) {
  try {
    const value = Number(product.price) || 0;
    const id = String(product.id);
    const activeCurrency = 'USD';
    devLog('ViewContent', { id, title: product.title, value, currency: activeCurrency });

    if (!isPlaceholderId(GA4_ID) && typeof window.gtag === 'function') {
      window.gtag('event', 'view_item', {
        currency: activeCurrency,
        value,
        items: [{ item_id: id, item_name: product.title, price: value, currency: activeCurrency }],
      });
    }
    if (!isPlaceholderId(META_PIXEL_ID) && typeof window.fbq === 'function') {
      window.fbq('track', 'ViewContent', {
        content_ids: [id],
        content_name: product.title,
        content_type: 'product',
        value,
        currency: activeCurrency,
      });
    }
    if (!isPlaceholderId(TIKTOK_PIXEL_ID) && window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('ViewContent', {
        content_id: id,
        content_name: product.title,
        content_type: 'product',
        value,
        currency: activeCurrency,
      });
    }
  } catch (err) {
    console.warn('[analytics] view_item failed:', err);
  }
}

/**
 * AddToCart — fires when the user adds an item to their cart.
 * @param {{ id, title, price, quantity? }} product
 * @param {string} currency
 */
export function trackAddToCart(product, currency) {
  try {
    const quantity = Math.max(1, Number(product.quantity) || 1);
    const unitPrice = Number(product.price) || 0;
    const value = unitPrice * quantity;
    const id = String(product.id);
    const activeCurrency = 'USD';
    devLog('AddToCart', { id, title: product.title, quantity, value, currency: activeCurrency });

    if (!isPlaceholderId(GA4_ID) && typeof window.gtag === 'function') {
      window.gtag('event', 'add_to_cart', {
        currency: activeCurrency,
        value,
        items: [{ item_id: id, item_name: product.title, price: unitPrice, quantity, currency: activeCurrency }],
      });
    }
    if (!isPlaceholderId(META_PIXEL_ID) && typeof window.fbq === 'function') {
      window.fbq('track', 'AddToCart', {
        content_ids: [id],
        content_name: product.title,
        content_type: 'product',
        contents: [{ id, quantity, item_price: unitPrice }],
        value,
        currency: activeCurrency,
      });
    }
    if (!isPlaceholderId(TIKTOK_PIXEL_ID) && window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('AddToCart', {
        content_id: id,
        content_name: product.title,
        content_type: 'product',
        quantity,
        price: unitPrice,
        value,
        currency: activeCurrency,
      });
    }
  } catch (err) {
    console.warn('[analytics] add_to_cart failed:', err);
  }
}

/**
 * InitiateCheckout — fires when the user enters the checkout flow.
 * @param {{ value: number, currency: string, itemCount?: number }} info
 */
export function trackInitiateCheckout(info) {
  try {
    const value = Number(info && info.value) || 0;
    const activeCurrency = 'USD';
    const itemCount = Number(info && info.itemCount) || 0;
    devLog('InitiateCheckout', { value, currency: activeCurrency, itemCount });

    if (!isPlaceholderId(GA4_ID) && typeof window.gtag === 'function') {
      window.gtag('event', 'begin_checkout', { currency: activeCurrency, value });
    }
    if (!isPlaceholderId(META_PIXEL_ID) && typeof window.fbq === 'function') {
      window.fbq('track', 'InitiateCheckout', {
        value,
        currency: activeCurrency,
        num_items: itemCount,
      });
    }
    if (!isPlaceholderId(TIKTOK_PIXEL_ID) && window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('InitiateCheckout', { value, currency: activeCurrency, quantity: itemCount });
    }
  } catch (err) {
    console.warn('[analytics] initiate_checkout failed:', err);
  }
}

/**
 * Purchase — fires on the order success page after payment confirmation.
 * @param {{ orderId: string|number, value: number, currency: string }} info
 */
export function trackPurchase(info) {
  try {
    const orderId = String((info && info.orderId) || '');
    const value = Number(info && info.value) || 0;
    const activeCurrency = 'USD';
    devLog('Purchase', { orderId, value, currency: activeCurrency });

    if (!isPlaceholderId(GA4_ID) && typeof window.gtag === 'function') {
      window.gtag('event', 'purchase', {
        transaction_id: orderId,
        currency: activeCurrency,
        value,
      });
    }
    if (!isPlaceholderId(META_PIXEL_ID) && typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', {
        value,
        currency: activeCurrency,
        content_type: 'product',
      });
    }
    if (!isPlaceholderId(TIKTOK_PIXEL_ID) && window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('CompletePayment', { value, currency: activeCurrency, order_id: orderId });
    }
  } catch (err) {
    console.warn('[analytics] purchase failed:', err);
  }
}
