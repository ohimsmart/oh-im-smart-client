// The page's own helpers in English and Simplified Chinese (web/v2/app.js): node --test tests/test_i18n_page.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const APP = fs.readFileSync(path.join(WEB, 'v2', 'app.js'), 'utf8');
const CHINESE = /[　-〿一-鿿＀-￯]/;

// the helpers' source, cut out of app.js the way tests/test_welcome.py does
function piece(re) {
  const m = APP.match(re);
  assert.ok(m, `not found in web/v2/app.js: ${re}`);
  return m[0];
}
const HELPERS = [
  piece(/^const WEEK = .*$/m),
  piece(/^function longDate\(.*?\n}\n/ms),
  piece(/^function weekdayName\(.*?\n}\n/ms),
  piece(/^const reason = .*$/m),
  piece(/^function repeatText\(.*?\n}\n/ms),
  piece(/^const updMsg = .*$/m),
  piece(/^const needsReboot = .*$/m),
  piece(/^const updFail = .*$/m),
].join('\n') + '\nthis.page = { longDate, weekdayName, reason, repeatText, updMsg, needsReboot, updFail };';

function page(language) {
  const context = {navigator: {language}, URLSearchParams, localStorage: {getItem() {}, setItem() {}},
                   location: {search: ''}};
  context.window = context;
  for (const f of ['zh-Hant.js', 'en.js', 'i18n.js']) vm.runInNewContext(fs.readFileSync(path.join(WEB, f), 'utf8'), context);
  vm.runInNewContext(HELPERS, context);
  return context.page;
}

test('dates follow the language: English word order, the Chinese format unchanged', () => {
  const day = new Date(2026, 10, 14);   // a Saturday
  assert.equal(page('en-US').longDate(day), 'Saturday, November 14');
  assert.equal(page('zh-CN').longDate(day), '11月14日 星期六');
  assert.equal(page('zh-CN').longDate(day, '  '), '11月14日  星期六');
  assert.deepEqual([1, 3, 7].map(page('en-US').weekdayName), ['Mon', 'Wed', 'Sun']);
  assert.deepEqual([1, 3, 7].map(page('zh-CN').weekdayName), ['一', '三', '日']);
});

test('alarm repeat rules in English', () => {
  const {repeatText} = page('en-US');
  for (const rule of [{type: 'daily'}, {type: 'workdays'}, {type: 'weekly', days: [1, 3]}, {type: 'monthly', day: 31}]) {
    assert.doesNotMatch(repeatText(rule), CHINESE, JSON.stringify(rule));
  }
  assert.equal(repeatText({type: 'weekly', days: [1, 3]}), 'Every Mon, Wed');
  assert.equal(page('zh-CN').repeatText({type: 'weekly', days: [1, 3]}), '每周一、三');
});

test("the updater's keyed messages and reboot flag; an older updater's plain message still works", () => {
  const en = page('en-US');
  const job = {message: '已更新到 1.0.1', msg_key: '错过了 {time} 的{kind}', msg_params: {time: '07:00', kind: {msg_key: '闹钟'}}};
  assert.equal(en.updMsg(job), 'Missed: Alarm at 07:00');
  assert.equal(en.updMsg({message: '设置'}), 'Settings');
  assert.equal(en.updMsg({}), '');
  assert.equal(en.needsReboot({reboot: true}), true);
  assert.equal(en.needsReboot({reboot: false, message: '系统层已更新到 1.0.1，部分改动重启设备后生效'}), false);
  assert.equal(en.needsReboot({message: '系统层已更新到 1.0.1，部分改动重启设备后生效'}), true);
  assert.equal(en.needsReboot({message: '已更新到 1.0.1'}), false);
});

test('error answers: the gateway\'s {msg_key, msg_params}, else the error text, else our fallback', () => {
  const {reason} = page('en-US');
  const keyed = {ok: false, error: '配置里没有 X', msg_key: '配置里没有 {name}', msg_params: {name: 'X'}};
  assert.equal(reason(keyed, 'fallback'), keyed);
  assert.equal(reason({ok: false, error: '设置'}, 'fallback'), '设置');
  assert.equal(reason({ok: false}, 'fallback'), 'fallback');
  assert.equal(reason(null, 'fallback'), 'fallback');
});

test('/v1 asks the kiosk shell with set_language and switches only on its ok', async () => {
  const v1 = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const bridge = v1.match(/^function languageBridge\(.*?\n}\n/ms);
  assert.ok(bridge, 'languageBridge not found in web/app.js');
  const sent = [], toasts = [];
  const context = {UII18n: {t: s => s}, toast: (text, kind) => toasts.push([text, kind]), setTimeout: () => 0, JSON};
  context.window = context;
  vm.runInNewContext(bridge[0] + '\nthis.bridge = languageBridge;', context);
  const ask = context.bridge({postMessage: m => sent.push(JSON.parse(m))});

  const yes = ask('en');
  assert.deepEqual(sent[0], {id: 1, cmd: 'set_language', lang: 'en'});
  context.thinksmartReply({id: 1, ok: true});
  assert.equal(await yes, true);
  assert.deepEqual(toasts, []);

  const no = ask('zh-Hant');
  context.thinksmartReply({id: 2, ok: false, reason: 'failed'});
  assert.equal(await no, false);
  assert.deepEqual(toasts, [['没能切换界面语言', 'error']]);
});

test("the updater's messages in English and Traditional Chinese, nested reasons too", () => {
  const en = page('en'), hant = page('zh-Hant');
  const rollback = {state: 'rolled_back', message: '系统层 0.2.0 没装成功（屏幕界面没有启动起来），已退回 0.1.0',
    msg_key: '系统层 {version} {why}，已退回 {old}',
    msg_params: {version: '0.2.0', old: '0.1.0',
      why: {msg_key: '没装成功（{why}）', msg_params: {why: {msg_key: '屏幕界面没有启动起来', msg_params: {}}}}}};
  assert.equal(en.updMsg(rollback), 'System layer 0.2.0: installation failed (the screen interface did not start); went back to 0.1.0');
  assert.equal(hant.updMsg(rollback), '系統層 0.2.0 沒裝成功（螢幕介面沒有啟動起來），已退回 0.1.0');
  const offline = {msg_key: '连不上更新服务器', msg_params: {}};   // the page shows check_error_msg the same way
  assert.equal(en.updMsg(offline), 'Can’t reach the update server');
  assert.equal(hant.updMsg(offline), '連不上更新伺服器');
});

test('a failed client after a system layer that needs a restart still says restart', () => {
  const en = page('en');
  const failed = {state: 'failed', message: '连不上更新服务器', msg_key: '连不上更新服务器', msg_params: {}};
  const withRestart = en.updFail({...failed, reboot: true});
  assert.ok(withRestart.startsWith('Can’t reach the update server'), withRestart);
  assert.ok(withRestart.endsWith('Some system layer changes take effect after a restart'), withRestart);
  assert.equal(en.updFail({...failed, reboot: false}), 'Can’t reach the update server');
  assert.equal(en.updFail({state: 'failed', message: '下载失败'}), en.updMsg({message: '下载失败'}));   // an older updater
});
