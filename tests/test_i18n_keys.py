"""Dictionary completeness (spec §6.4): every source text the page can show has exactly one Chinese entry
and one English entry, and the page scripts write no Chinese of their own outside UII18n.t("…").

Source text: tests/i18n_keys.py. Needs node (the dictionaries are read as the browser reads them)."""
import re
import shutil

import pytest

from i18n_keys import CHINESE, SCRIPTS, dictionaries, source_keys

pytestmark = pytest.mark.skipif(shutil.which('node') is None, reason='needs node')
PLACEHOLDER = re.compile(r'\{(\w+)\}')
# the language picker names each language in its own script, in every language
ENDONYMS = {'简体中文', '繁體中文'}
# Chinese the page writes outside t(): only on Chinese pages, or to read an older updater's message
CHINESE_ONLY = {
    "const WEEK = '日一二三四五六';   // Chinese weekday characters by getDay()",
    "const WEEK = '日一二三四五六';   // Chinese weekday characters by getDay() (both scripts write them the same)",
    ': `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`;',
    ': `${d.getMonth() + 1}月${d.getDate()}日${gap}星期${WEEK[d.getDay()]}`;',
    "const needsReboot = job => (typeof job.reboot === 'boolean' ? job.reboot : /重启设备后生效/.test(job.message || ''));",
}
T_CALL = re.compile(r'UII18n\.t\("(?:[^"\\]|\\.)*"')
# the wake word as it is said: 小麦小麦, 小麦同学, or the name 小麦 alone
WAKE = re.compile('小麦(?:小麦|同学)?')


def wake_ok(key, value):
    """spec §6.3: an English value keeps every wake phrase of its key verbatim, and no other Chinese."""
    return sorted(WAKE.findall(value)) == sorted(WAKE.findall(key)) and not CHINESE.search(WAKE.sub('', value))
COMMENT = re.compile(r'(?<![:\'"\\])//.*$')


def test_every_source_text_has_one_chinese_entry():
    keys, d = source_keys(), dictionaries()
    hant, hans = set(d['UI_ZH_HANT']), set(d['UI_ZH_HANS'])
    assert hant & hans == set()
    assert sorted(keys - hant - hans) == [], 'missing from zh-Hant.js'
    assert sorted((hant | hans) - keys) == [], 'zh-Hant.js entries no source shows'


def test_english_has_exactly_the_source_texts():
    keys, en = source_keys(), set(dictionaries()['UI_EN'])
    assert sorted(keys - en) == [], 'missing from en.js'
    assert sorted(en - keys) == [], 'en.js entries no source shows'


def test_values_keep_placeholders_and_english_has_no_chinese():
    d = dictionaries()
    for name, catalog in d.items():
        for k, v in catalog.items():
            assert v.strip(), (name, k)
            assert set(PLACEHOLDER.findall(v)) == set(PLACEHOLDER.findall(k)), (name, k, v)
    for k, v in d['UI_EN'].items():
        assert v == k if k in ENDONYMS else wake_ok(k, v), (k, v)


def test_wake_word_rule_catches_a_changed_or_untranslated_value():
    key = '说「小麦小麦」开始聊天'
    assert wake_ok(key, 'Say “小麦小麦” (xiǎo mài xiǎo mài) to start')
    assert not wake_ok(key, 'Say “小麦” to start')                # shortened
    assert not wake_ok(key, 'Say the wake word to start')          # dropped
    assert not wake_ok(key, key)                                   # left in Chinese
    assert not wake_ok('设置', 'Settings 小麦')                      # added


def test_page_scripts_write_chinese_only_through_t():
    stray = []
    for path in SCRIPTS:
        for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            code = COMMENT.sub('', T_CALL.sub('T', line)).strip()
            if CHINESE.search(code) and line.strip() not in CHINESE_ONLY:
                stray.append(f'{path.parent.name}/{path.name}:{i}: {line.strip()}')
    assert stray == []
