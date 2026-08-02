const STORAGE_KEY = 'ds_behavior';
const SCHEMA_VERSION = '1.1';
const DECAY_DAYS = 7;

// ── In-memory session state (clears on page refresh) ──────────
const _viewedThisSession = new Map(); // productId → timestamp of last recorded view
let _lastAddTimestamp = 0;

// ── Schema helpers ─────────────────────────────────────────────

function createEmptyStore() {
  return {
    version: SCHEMA_VERSION,
    products: {},
    profile: { jewelryViews: 0, streetwearViews: 0, totalViews: 0 },
    sessions: 0,
    lastUpdated: Date.now(),
  };
}

function migrateStore(old) {
  const store = createEmptyStore();
  if (old.products && typeof old.products === 'object') {
    for (const [id, data] of Object.entries(old.products)) {
      if (typeof data === 'object' && data !== null) {
        store.products[id] = {
          views: data.views || 0,
          addToCart: data.addToCart || 0,
          timeSpent: data.timeSeconds || data.timeSpent || 0,
          lastInteraction: old.lastUpdated || Date.now(),
        };
      }
    }
  }
  if (old.profile && typeof old.profile === 'object') {
    store.profile = {
      jewelryViews: old.profile.jewelryViews || 0,
      streetwearViews: old.profile.streetwearViews || 0,
      totalViews: old.profile.totalViews || 0,
    };
  }
  store.sessions = old.sessions || 0;
  return store;
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyStore();
    const parsed = JSON.parse(raw);
    return parsed.version === SCHEMA_VERSION ? parsed : migrateStore(parsed);
  } catch {
    return createEmptyStore();
  }
}

function writeStore(data) {
  try {
    data.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

// ── One-time session counter (guarded by sessionStorage) ───────
try {
  if (!sessionStorage.getItem('ds_si')) {
    sessionStorage.setItem('ds_si', '1');
    const s = readStore();
    s.sessions = (s.sessions || 0) + 1;
    writeStore(s);
  }
} catch {}

// ── Recency decay ──────────────────────────────────────────────

function getRecencyMultiplier(lastInteraction) {
  if (!lastInteraction) return 1.0;
  const daysSince = (Date.now() - lastInteraction) / 86400000;
  if (daysSince < 1) return 1.2;
  if (daysSince < 3) return 1.0;
  if (daysSince < DECAY_DAYS) return 0.7;
  return 0.5;
}

// ── Public API ─────────────────────────────────────────────────

export function recordProductView(productId, category) {
  try {
    const now = Date.now();
    // Dedup: same product viewed within 10 s in the same session = ignored
    const lastView = _viewedThisSession.get(productId);
    if (lastView && now - lastView < 10000) return;
    _viewedThisSession.set(productId, now);

    const store = readStore();
    if (!store.products[productId]) {
      store.products[productId] = { views: 0, addToCart: 0, timeSpent: 0, lastInteraction: now };
    }
    const p = store.products[productId];
    p.views += 1;
    p.lastInteraction = now;

    const profile = store.profile;
    profile.totalViews = (profile.totalViews || 0) + 1;
    if (category === 'jewelry') profile.jewelryViews = (profile.jewelryViews || 0) + 1;
    else profile.streetwearViews = (profile.streetwearViews || 0) + 1;

    writeStore(store);
  } catch {}
}

export function recordAddToCart(productId) {
  try {
    _lastAddTimestamp = Date.now();
    const store = readStore();
    if (!store.products[productId]) {
      store.products[productId] = { views: 0, addToCart: 0, timeSpent: 0, lastInteraction: Date.now() };
    }
    store.products[productId].addToCart += 1;
    store.products[productId].lastInteraction = Date.now();
    writeStore(store);
  } catch {}
}

export function recordTimeOnProduct(productId, seconds) {
  try {
    if (!seconds || seconds <= 0) return;
    const store = readStore();
    if (!store.products[productId]) {
      store.products[productId] = { views: 0, addToCart: 0, timeSpent: 0, lastInteraction: Date.now() };
    }
    const p = store.products[productId];
    p.timeSpent = Math.min((p.timeSpent || 0) + seconds, 300);
    writeStore(store);
  } catch {}
}

function computeScore(data) {
  const recency = getRecencyMultiplier(data.lastInteraction);
  const viewScore = Math.log((data.views || 0) + 1) * 1.5;
  const cartScore = (data.addToCart || 0) * 3.0;
  const timeScore = Math.min((data.timeSpent || 0) / 10, 5) * 0.5;
  return (viewScore + cartScore + timeScore) * recency;
}

export function getSmartProductOrder(products) {
  try {
    const store = readStore();
    const productData = store.products || {};
    const empty = { views: 0, addToCart: 0, timeSpent: 0, lastInteraction: 0 };
    return [...products].sort((a, b) =>
      computeScore(productData[String(b.id)] || empty) -
      computeScore(productData[String(a.id)] || empty)
    );
  } catch {
    return products;
  }
}

export function getUserProfile() {
  try {
    const store = readStore();
    const p = store.profile;
    if (!p || p.totalViews < 3) return 'explorer';
    const ratio = (p.jewelryViews || 0) / p.totalViews;
    if (ratio > 0.6) return 'jewelry';
    if (ratio < 0.4) return 'streetwear';
    return 'explorer';
  } catch {
    return 'explorer';
  }
}

export function getConversionIntent(signals) {
  try {
    const { timeOnPage = 0, scrollDepth = 0, ctaHovered = false } = signals;
    const store = readStore();
    const isRapidAdd = _lastAddTimestamp > 0 && Date.now() - _lastAddTimestamp < 60000;
    const isReturnVisitor = (store.sessions || 0) > 1;

    let score = 0;
    if (timeOnPage > 30) score++;
    if (scrollDepth > 60) score++;
    if (ctaHovered) score++;
    if (isRapidAdd) score += 2;
    if (isReturnVisitor) score++;

    if (score >= 3) return 'high';
    if (score <= 0) return 'low';
    return 'neutral';
  } catch {
    return 'neutral';
  }
}
