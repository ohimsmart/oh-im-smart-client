/* Translate application-owned copy only. Conversation text, SSIDs and user input are never converted. */
window.UII18n = (() => {
  const key = 'thinksmart.uiLocale';
  const LOCALES = ['zh-Hans', 'zh-Hant', 'en'];
  const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  // zh-* with Hant/TW/HK/MO → Traditional; other zh → Simplified; everything else (including en-HK) → English
  const normalize = value => !/^zh(?:-|$)/i.test(value || '') ? 'en'
    : /^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(value) ? 'zh-Hant' : 'zh-Hans';
  let saved;
  try { saved = localStorage.getItem(key); } catch (_) { /* Private browsing may disable storage. */ }
  const requested = new URLSearchParams(location.search).get('lang');
  // The kiosk adds ?lang from its language file on every load, so it beats the remembered value;
  // an unknown ?lang is ignored (spec §6.2).
  const locale = LOCALES.includes(requested) ? requested
    : LOCALES.includes(saved) ? saved : normalize(navigator.language);
  if (!LOCALES.includes(saved) && requested === locale) {
    try { localStorage.setItem(key, locale); } catch (_) { /* The URL still supplies this visit's locale. */ }
  }
  const catalogs = { 'zh-Hant': window.UI_ZH_HANT, 'zh-Hans': window.UI_ZH_HANS, en: window.UI_EN };
  // Never switch to a locale whose dictionary is missing or empty (e.g. en.js failed to load or parse)
  const available = l => l.startsWith('zh-') || Object.keys(catalogs[l] || {}).length > 0;
  const applied = available(locale) ? locale : 'zh-Hans';
  const catalog = catalogs[applied] || {};
  // Plain string parameters are names, numbers or third-party text and are shown exactly as given;
  // an object parameter is another {msg_key, msg_params} and is translated first.
  const param = value => (value && typeof value === 'object' ? text(value) : value === null || value === undefined ? '' : String(value));
  // t(key) translates; t(key, params) also fills {name} placeholders after translating the template.
  const t = (source, params) => {
    const s = has(catalog, source) ? catalog[source] : source;
    return params ? s.replace(/\{(\w+)\}/g, (whole, name) => (has(params, name) ? param(params[name]) : whole)) : s;
  };
  const msg = obj => (obj && typeof obj === 'object' && typeof obj.msg_key === 'string' ? t(obj.msg_key, obj.msg_params || {}) : null);
  // A backend value: a string (translated if it is ours) or a {msg_key, msg_params} object.
  const text = value => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return t(value);
    const m = msg(value);
    return m === null ? String(value) : m;
  };
  // The voice client's page sets this: the kiosk shell writes its language file first (spec §6.2)
  let beforeSwitch = null;
  const go = value => {
    let stored = true;
    try { localStorage.setItem(key, value); } catch (_) { stored = false; }
    const params = new URLSearchParams(location.search);
    if (stored && !params.has('lang')) { location.reload(); return true; }   // the saved value decides
    params.set('lang', value);   // an old ?lang in the address would win over the choice
    location.search = '?' + params.toString();
    return true;
  };
  // Resolves true once the page is switching; false when the value is unknown or the shell refused.
  function choose(value) {
    if (!LOCALES.includes(value) || !available(value)) return Promise.resolve(false);
    if (!beforeSwitch) return Promise.resolve(go(value));
    // a hook that throws or rejects counts as a refusal: the page stays as it is
    return new Promise(resolve => resolve(beforeSwitch(value))).then(ok => ok === true && go(value), () => false);
  }
  function init() {
    document.documentElement.lang = applied;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement.closest('script,style,textarea,[data-no-i18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.textContent.trim();
      if (txt) node.textContent = node.textContent.replace(txt, () => t(txt));   // a function: no $& patterns
    }
    document.title = t(document.title);
    document.querySelectorAll('[title],[aria-label],[placeholder],[data-kb-enter]').forEach(el => {
      for (const attr of ['title', 'aria-label', 'placeholder', 'data-kb-enter']) {
        if (el.hasAttribute(attr)) el.setAttribute(attr, t(el.getAttribute(attr)));
      }
    });
    document.querySelectorAll('[data-language-picker]').forEach(select => {
      for (const option of select.options || []) option.disabled = !available(option.value);
      select.value = applied;
      select.addEventListener('change', () => {
        choose(select.value).then(ok => { if (!ok) select.value = applied; });
      });
    });
  }
  return { t, msg, text, init, choose, setBeforeSwitch: fn => { beforeSwitch = fn; }, locale, applied, normalize };
})();
