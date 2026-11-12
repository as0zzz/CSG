"""Local acceptance check: capture and compare API data across a container restart.

Usage from repository root: python scripts/check-persistence.py before|after
Uses only the Python standard library and the local .env demo account.
"""
import hashlib
import http.cookiejar
import json
import sys
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None):
    raw = json.dumps(body).encode() if body is not None else None
    response = opener.open(urllib.request.Request('http://localhost:8080/api' + path, data=raw, headers={'Content-Type': 'application/json'}), timeout=20)
    return response.read()


request('/auth/login', {'email': 'planner@demo.local', 'password': config['DEMO_PASSWORD']})
projects = json.loads(request('/projects'))
project = next(p for p in projects if p['code'] == 'DEMO-01')
state = json.loads(request(f'/projects/{project["id"]}/state'))
snapshot = {'works': sorted(state['works'], key=lambda w: w['id']),
            'inspections': sorted(state['inspections'], key=lambda i: i['id']),
            'media': {m['id']: hashlib.sha256(request(f'/media/{m["id"]}/content')).hexdigest() for m in state['media']},
            'audit_count': len(state['audit'])}
baseline = root / '.codex-review' / 'persistence-before.json'
if sys.argv[1:] == ['before']:
    baseline.parent.mkdir(exist_ok=True)
    baseline.write_text(json.dumps(snapshot, ensure_ascii=False, sort_keys=True), encoding='utf8')
    print(f'Captured: {len(snapshot["works"])} works, {len(snapshot["inspections"])} inspections, {len(snapshot["media"])} media objects.')
elif sys.argv[1:] == ['after']:
    expected = json.loads(baseline.read_text(encoding='utf8'))
    assert snapshot == expected, 'Data changed across restart; inspect baseline and current API state.'
    print('PASS: works, inspections, audit count and all media SHA-256 values preserved across restart.')
else:
    raise SystemExit('Usage: python scripts/check-persistence.py before|after')
