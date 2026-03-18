/**
 * i18n Translation System
 * 
 * Usage:
 *   const { t, getLang, setLang } = require('./locales');
 *   const text = t('welcome', lang, { shopName: 'CloudX' });
 */
const vi = require('./vi');
const en = require('./en');

const locales = { vi, en };
const SUPPORTED_LANGS = ['vi', 'en'];
const DEFAULT_LANG = 'vi';

// In-memory cache for user language preferences
const langCache = new Map();

/**
 * Get translated string by key + language, with parameter interpolation.
 * 
 * @param {string} key - Translation key (e.g. 'welcome', 'order_title')
 * @param {string} lang - Language code ('vi' or 'en')
 * @param {Object} [params] - Parameters to interpolate: { shopName: 'X' }
 * @returns {string} Translated string
 */
function t(key, lang, params) {
  const locale = locales[lang] || locales[DEFAULT_LANG];
  let str = locale[key];

  // Fallback to default lang if key not found
  if (str === undefined) {
    str = locales[DEFAULT_LANG][key];
  }

  // If still not found, return key itself
  if (str === undefined) {
    console.warn(`[i18n] Missing translation key: "${key}" for lang: "${lang}"`);
    return key;
  }

  // Interpolate {param} placeholders
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }

  return str;
}

/**
 * Get user's language from cache or DB.
 * @param {number} userId - Telegram user ID
 * @param {Function} [dbGetter] - Optional DB lookup function
 * @returns {string} Language code
 */
function getLang(userId, dbGetter) {
  if (langCache.has(userId)) {
    return langCache.get(userId);
  }

  // Try DB lookup
  if (dbGetter) {
    try {
      const lang = dbGetter(userId);
      if (lang && SUPPORTED_LANGS.includes(lang)) {
        langCache.set(userId, lang);
        return lang;
      }
    } catch (err) {
      console.warn('[i18n] DB lookup failed:', err.message);
    }
  }

  return DEFAULT_LANG;
}

/**
 * Set user's language (cache + indicates DB save needed)
 * @param {number} userId
 * @param {string} lang
 */
function setLang(userId, lang) {
  if (SUPPORTED_LANGS.includes(lang)) {
    langCache.set(userId, lang);
  }
}

/**
 * Check if user has a language preference set
 * @param {number} userId
 * @returns {boolean}
 */
function hasLangPreference(userId) {
  return langCache.has(userId);
}

/**
 * Clear language cache for a user (e.g. on language change)
 * @param {number} userId
 */
function clearLangCache(userId) {
  langCache.delete(userId);
}

module.exports = {
  t,
  getLang,
  setLang,
  hasLangPreference,
  clearLangCache,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
};
