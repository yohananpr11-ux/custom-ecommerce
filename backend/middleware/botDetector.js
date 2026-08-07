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
 * Detects whether an incoming HTTP request originates from a bot or crawler.
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
 * Express middleware that attaches `req.isBot` and `req.botReason`.
 */
function botDetectorMiddleware(req, res, next) {
  const result = detectBot(req);
  req.isBot = result.isBot;
  req.botReason = result.botReason;
  if (typeof next === 'function') {
    next();
  }
}

module.exports = { detectBot, botDetectorMiddleware };
