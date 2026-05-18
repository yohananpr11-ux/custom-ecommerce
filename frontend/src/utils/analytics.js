/**
 * Analytics utility – GA4 + Meta Pixel
 * Replace placeholder IDs before going to production:
 *   GA4:       G-XXXXXXXXXX
 *   Meta Pixel: PIXEL_ID_HERE
 */

const GA4_ID = (import.meta.env.VITE_GA4_ID || 'G-XXXXXXXXXX').trim();
const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID || 'PIXEL_ID_HERE').trim();

const isPlaceholderId = (value) => !value || /^(G-XXXXXXXXXX|PIXEL_ID_HERE|null|undefined)$/i.test(value);

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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call once on app bootstrap.
 */
export function initAnalytics() {
  try {
    injectGA4();
    injectMetaPixel();
  } catch (err) {
    console.warn('[analytics] init failed:', err);
  }
}

/**
 * Fire a pageview for the given path.
 * @param {string} path - e.g. '/', '/product/42'
 */
export function trackPageView(path) {
  try {
    if (isPlaceholderId(GA4_ID)) return;
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', { page_path: path });
    }
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'PageView');
    }
  } catch (err) {
    console.warn('[analytics] pageview failed:', err);
  }
}

/**
 * Fire a view_item event when a product page mounts.
 * @param {{ id: number|string, title: string, price: number }} product
 * @param {string} currency - 'ILS' | 'USD'
 */
export function trackViewItem(product, currency) {
  try {
    if (isPlaceholderId(GA4_ID)) return;
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'view_item', {
        currency,
        value: Number(product.price) || 0,
        items: [
          {
            item_id: String(product.id),
            item_name: product.title,
            price: Number(product.price) || 0,
            currency,
          },
        ],
      });
    }
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'ViewContent', {
        content_ids: [String(product.id)],
        content_name: product.title,
        content_type: 'product',
        value: Number(product.price) || 0,
        currency,
      });
    }
  } catch (err) {
    console.warn('[analytics] view_item failed:', err);
  }
}
