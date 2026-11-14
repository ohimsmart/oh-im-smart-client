// Run with: node --test tests/test_i18n.cjs (no npm dependencies).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small English dictionary: these tests are about the runtime, en.js about the words (test_i18n_keys.py)
const EN = {'设置': 'Settings', '有 {n} 条待汇报': '{n} reports waiting', '错过了 {time} 的{kind}': 'Missed the {kind} at {time}',
            '闹钟': 'alarm'};

function load(language, saved, blocked = false, search = '', {english = EN} = {}) {
  const values = new Map(saved ? [['thinksmart.uiLocale', saved]] : []);
  const picker = {value: '', addEventListener(event, fn) { this[event] = fn; }};
  const context = {navigator: {language}, URLSearchParams,
    localStorage: {getItem(k) { if (blocked) throw Error('disabled'); return values.get(k); }, setItem(k,v) { values.set(k,v); }},
    location: {search, reload() { this.reloaded = true; }},
    NodeFilter: {SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2},
    document: {documentElement: {}, body: {}, title: '小麦',
      createTreeWalker() {return {nextNode() {return null;}};},
      querySelectorAll(selector) {return selector === '[data-language-picker]' ? [picker] : [];}}
  };
  context.window = context;
  const root = path.join(__dirname, '..', 'web');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'zh-Hant.js'), 'utf8'), context);
  if (english) context.UI_EN = english;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8'), context);
  return {context, api: context.UII18n, values, picker};
}

test('traditional locale aliases and explicit saved preferences', () => {
  for (const language of ['zh-TW','zh-HK','zh-MO','zh-Hant','zh-Hant-TW']) {
    assert.equal(load(language).api.locale, 'zh-Hant');
  }
  assert.equal(load('zh-TW', 'zh-Hans').api.locale, 'zh-Hans');
  assert.equal(load('en-US', 'zh-Hant').api.locale, 'zh-Hant');
  assert.equal(load('zh-CN').api.locale, 'zh-Hans');
});

test('known UI copy is translated; arbitrary content and prototype names remain unchanged', () => {
  const {api} = load('zh-TW');
  assert.equal(api.t('设置'), '設定');
  assert.equal(api.t('软件更新'), '軟體更新');
  assert.equal(api.t('我的WiFi名称：设置网络'), '我的WiFi名称：设置网络');
  assert.equal(api.t('用户说：明天北京天气怎么样？'), '用户说：明天北京天气怎么样？');
  assert.equal(api.t('toString'), 'toString');
});

test('storage-disabled browsers can still load and translate', () => {
  assert.equal(load('zh-TW', null, true).api.t('设置'), '設定');
});

// spec §6.2: the kiosk adds ?lang on every load, so ?lang beats the saved value; an unknown ?lang is ignored
test('bookmarked locale initializes new devices and wins over a saved preference', () => {
  assert.equal(load('en-US', null, false, '?lang=zh-Hant').api.locale, 'zh-Hant');
  assert.equal(load('en-US', 'zh-Hans', false, '?lang=zh-Hant').api.locale, 'zh-Hant');
  assert.equal(load('en-US', null, false, '?lang=invalid').api.locale, 'en');
  assert.equal(load('zh-TW', 'zh-Hans', false, '?lang=invalid').api.locale, 'zh-Hans');
});

test('selector persists preference and document language is accessible', () => {
  const {api,context,picker,values} = load('zh-TW');
  api.init();
  assert.equal(context.document.documentElement.lang, 'zh-Hant');
  assert.equal(picker.value, 'zh-Hant');
  picker.value = 'zh-Hans'; picker.change();
  assert.equal(values.get('thinksmart.uiLocale'), 'zh-Hans');
  assert.equal(context.location.reloaded, true);
});

test('English: English browsers, ?lang=en and a saved en; zh-* stays Chinese, en-HK is English', () => {
  for (const language of ['en-US', 'en-HK', 'fr-FR', 'ja', '']) assert.equal(load(language).api.applied, 'en');
  assert.equal(load('zh-TW', null, false, '?lang=en').api.applied, 'en');
  assert.equal(load('zh-CN', 'en').api.applied, 'en');
  assert.equal(load('zh-SG').api.applied, 'zh-Hans');
  assert.equal(load('en-US').api.t('设置'), 'Settings');
});

test('without an English dictionary the page stays in Simplified Chinese', () => {
  const {api} = load('en-US', null, false, '', {english: null});
  assert.equal(api.locale, 'en');
  assert.equal(api.applied, 'zh-Hans');
  assert.equal(api.t('设置'), '设置');
});

test('templates: t() fills after translating; text() renders keyed answers, nested keys translated, plain values as given', () => {
  const {api} = load('en-US');
  assert.equal(api.t('有 {n} 条待汇报', {n: 3}), '3 reports waiting');
  assert.equal(api.t('不在字典里 {x}', {x: 'a'}), '不在字典里 a');
  assert.equal(api.text('设置'), 'Settings');
  assert.equal(api.text({msg_key: '错过了 {time} 的{kind}', msg_params: {time: '07:00', kind: {msg_key: '闹钟'}}}),
               'Missed the alarm at 07:00');
  assert.equal(api.text({msg_key: '错过了 {time} 的{kind}', msg_params: {time: '设置', kind: '闹钟'}}),
               'Missed the 闹钟 at 设置');
  assert.equal(api.text(null), '');
});

test('choosing a language replaces ?lang (the old one would win); the shell may refuse', async () => {
  const {api, context, values} = load('en-US', null, false, '?lang=zh-Hans&demo=1');
  assert.equal(await api.choose('en'), true);
  assert.equal(values.get('thinksmart.uiLocale'), 'en');
  assert.equal(new URLSearchParams(context.location.search).get('lang'), 'en');
  assert.equal(new URLSearchParams(context.location.search).get('demo'), '1');

  const refused = load('en-US', null, false, '?lang=zh-Hans');
  const asked = [];
  refused.api.setBeforeSwitch(lang => { asked.push(lang); return Promise.resolve(false); });
  assert.equal(await refused.api.choose('zh-Hant'), false);
  assert.deepEqual(asked, ['zh-Hant']);
  assert.equal(refused.values.get('thinksmart.uiLocale'), 'zh-Hans');   // what the bookmark saved, unchanged
  assert.equal(refused.context.location.search, '?lang=zh-Hans');

  for (const hook of [() => { throw Error('shell gone'); }, () => Promise.reject(Error('no reply'))]) {
    const broken = load('en-US', null, false, '?lang=zh-Hans');
    broken.api.setBeforeSwitch(hook);
    assert.equal(await broken.api.choose('zh-Hant'), false);
    assert.equal(broken.context.location.search, '?lang=zh-Hans');
  }

  assert.equal(await load('en-US').api.choose('fr'), false);
  assert.equal(await load('en-US', null, false, '', {english: null}).api.choose('en'), false);
});
