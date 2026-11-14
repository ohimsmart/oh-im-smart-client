"""The page's source text: every dictionary key the client can show (spec §6.4).

Shared by tests/test_i18n_keys.py; run directly to print the keys missing from a dictionary."""
import ast
import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'web'
PAGES = [WEB / 'index.html', WEB / 'v2' / 'index.html']
SCRIPTS = [WEB / 'app.js', WEB / 'v2' / 'app.js']
ATTRS = ('title', 'aria-label', 'placeholder', 'data-kb-enter')
SKIP = ('script', 'style', 'textarea')
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
# Chinese in every test: CJK ideographs, CJK punctuation, full-width forms
CHINESE = re.compile('[　-〿一-鿿＀-￯]')
T_CALL = re.compile(r'UII18n\.t\(("(?:[^"\\]|\\.)*")')


class _Page(HTMLParser):
    """Text nodes and attributes the way i18n.js init() walks them."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.keys = [], set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        skip = tag in SKIP or 'data-no-i18n' in attrs or (self.stack and self.stack[-1])
        for name in ATTRS:
            if attrs.get(name):
                self.keys.add(attrs[name])
        if tag not in VOID:
            self.stack.append(bool(skip))

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if data.strip() and not (self.stack and self.stack[-1]):
            self.keys.add(data.strip())


def html_keys():
    keys = set()
    for page in PAGES:
        p = _Page()
        p.feed(page.read_text(encoding='utf-8'))
        keys |= p.keys
    return {k for k in keys if CHINESE.search(k)}


def script_keys():
    return {json.loads(m) for path in SCRIPTS for m in T_CALL.findall(path.read_text(encoding='utf-8'))}


def _consts(node):
    return {n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and CHINESE.search(n.value)}


def python_keys():
    """What the client's Python sends the page: toast texts, 'error' answers, msg_key templates,
    alarm kinds (nested in msg_params) and ring-tone names."""
    keys = set()
    pkg = ROOT / 'thinksmart_client'
    for name in ('app.py', 'web.py', 'alarms.py'):
        for node in ast.walk(ast.parse((pkg / name).read_text(encoding='utf-8'))):
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if isinstance(k, ast.Constant) and k.value in ('text', 'error', 'msg_key'):
                        keys |= _consts(v)
    for node in ast.walk(ast.parse((pkg / 'alarms.py').read_text(encoding='utf-8'))):
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') in ('TONES', 'KINDS') for t in node.targets):
            keys |= _consts(node.value)
    return keys


def fixture_keys():
    """Keys other repos send the page: the gateway's /kiosk/llm/use and /kiosk/chat/clear answers, with the
    vendor labels it nests in them through label() (gateway_kiosk_keys.json), and the updater's messages
    (updater_keys.json, filled by the updater plan)."""
    keys = set()
    for name in ('gateway_kiosk_keys.json', 'updater_keys.json'):
        keys |= set(json.loads((ROOT / 'tests' / name).read_text(encoding='utf-8')))
    return keys


def source_keys():
    return html_keys() | script_keys() | python_keys() | fixture_keys()


def dictionaries():
    """{name: dict} from web/zh-Hant.js and web/en.js, read by node exactly as the browser would."""
    node = shutil.which('node') or 'node'
    code = ("const vm=require('vm'),fs=require('fs');const c={};c.window=c;"
            "for (const f of process.argv.slice(1)) if (fs.existsSync(f)) vm.runInNewContext(fs.readFileSync(f,'utf8'),c);"
            "process.stdout.write(JSON.stringify({UI_ZH_HANT:c.UI_ZH_HANT||{},UI_ZH_HANS:c.UI_ZH_HANS||{},UI_EN:c.UI_EN||{}}))")
    out = subprocess.run([node, '-e', code, str(WEB / 'zh-Hant.js'), str(WEB / 'en.js')],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


if __name__ == '__main__':
    keys, d = source_keys(), dictionaries()
    print(len(keys), 'source keys;', {k: len(v) for k, v in d.items()})
    zh = set(d['UI_ZH_HANT']) | set(d['UI_ZH_HANS'])
    print('not in either zh dictionary:', sorted(keys - zh))
    print('zh entries no longer in the source:', sorted(zh - keys))
