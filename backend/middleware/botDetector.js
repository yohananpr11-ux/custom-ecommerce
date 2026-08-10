'use strict';

/**
 * Known Bot / Crawler / Scraper User-Agent Keywords
 */
const BOT_UA_PATTERNS = [
  'bot', 'spider', 'crawler', 'slurp', 'googlebot', 'bingbot', 'yandexbot',
  'baiduspider', 'duckduckbot', 'facebookexternalhit', 'twitterbot',
  'linkedinbot', 'embedly', 'quora link preview', 'showyoubot', 'outbrain',
  'pinterest', 'slackbot', 'vkshare', 'w3c_validator', 'whatsapp',
  'python', 'curl', 'wget', 'axios', 'postman', 'insomnia', 'headless',
  'chrome-lighthouse', 'ahrefs', 'semrush', 'bytespider', 'gtmetrix',
  'uptimerobot', 'pingdom', 'statuscake', 'screaming frog', 'scrape'
];

/**
 * Known (reputable) crawlers that should be tracked in analytics but
 * should NEVER trigger a Telegram visit alert.
 */
const KNOWN_BOT_PATTERN = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|petalbot|chrome-lighthouse|lighthouse|vercelbot|gtmetrix|pingdom|uptimerobot/i;

const SUSPICIOUS_PATTERN = /headlesschrome|phantomjs|selenium|puppeteer|playwright|scrapy|python-requests|python-httpx|go-http-client/i;

/**
 * Layer-1 + Layer-2 classification:
 * Returns 'human' | 'known_bot' | 'suspicious'
 */
function classifyVisitor(ua, acceptLang, accept) {
  if (!ua || ua.trim() === '') return 'suspicious';

  const uaL = ua.toLowerCase();

  if (KNOWN_BOT_PATTERN.test(ua)) return 'known_bot';
  if (SUSPICIOUS_PATTERN.test(ua)) return 'suspicious';

  // Generic bot substring match
  for (const pattern of BOT_UA_PATTERNS) {
    if (uaL.includes(pattern)) return 'known_bot';
  }

  // Missing standard browser headers
  if (!acceptLang && (!accept || accept === '*/*' || accept === 'application/json')) {
    return 'suspicious';
  }

  return 'human';
}

function getDevice(ua) {
  if (!ua) return 'Unknown';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/tablet/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

/**
 * Detects whether an incoming HTTP request originates from a bot or crawler.
 * Kept for backward compatibility.
 *
 * @param {import('express').Request} req
 * @returns {{ isBot: boolean, botReason: string|null }}
 */
function detectBot(req) {
  if (!req || typeof req !== 'object') {
    return { isBot: false, botReason: null };
  }

  const headers = req.headers || {};
  const userAgent = String(headers['user-agent'] || '').toLowerCase();

  // Missing User-Agent header
  if (!userAgent || userAgent.trim() === '') {
    return { isBot: true, botReason: 'missing_user_agent' };
  }

  // Known Bot User-Agent substring match
  for (const pattern of BOT_UA_PATTERNS) {
    if (userAgent.includes(pattern)) {
      return { isBot: true, botReason: `ua_${pattern.replace(/\s+/g, '_')}` };
    }
  }

  // Missing standard browser headers (Accept-Language is present in virtually all real browsers)
  const acceptLang = headers['accept-language'];
  const accept = headers['accept'];
  if (!acceptLang && (!accept || accept === '*/*' || accept === 'application/json')) {
    return { isBot: true, botReason: 'missing_browser_headers' };
  }

  // Explicit payload flag (e.g. from load simulation or bot client)
  if (req.body && typeof req.body === 'object') {
    if (req.body.source === 'load-test-bot' || req.body.isBot === true) {
      return { isBot: true, botReason: 'explicit_bot_payload' };
    }
  }

  return { isBot: false, botReason: null };
}

/**
 * Express middleware — two-layer classification.
 * Attaches req.isBot, req.botReason (backward compat) AND
 * req.visitorType ('human'|'known_bot'|'suspicious'), req.visitorDevice.
 *
 * Downstream Telegram handlers must check req.visitorType:
 *   'human'      → send alert (LOW+ priority depending on funnel stage)
 *   'known_bot'  → analytics only, NO Telegram
 *   'suspicious' → log to suspicious_traffic, NO Telegram
 */
function botDetectorMiddleware(req, res, next) {
  const headers = req.headers || {};
  const ua = String(headers['user-agent'] || '');
  const acceptLang = headers['accept-language'];
  const accept = headers['accept'];

  req.visitorType = classifyVisitor(ua, acceptLang, accept);
  req.visitorDevice = getDevice(ua);

  // Backward-compat fields
  const legacyResult = detectBot(req);
  req.isBot = legacyResult.isBot || req.visitorType !== 'human';
  req.botReason = legacyResult.botReason || (req.visitorType !== 'human' ? req.visitorType : null);

  if (typeof next === 'function') {
    next();
  }
}

module.exports = { detectBot, botDetectorMiddleware, classifyVisitor, getDevice };
