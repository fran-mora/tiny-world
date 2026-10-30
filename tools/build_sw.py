#!/usr/bin/env python3
"""Generate sw.js with a precache list of every game file and a content-hash version.
Run from the repo root:  python3 tools/build_sw.py"""
import hashlib, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE_DIRS = ['css', 'js', 'vendor', 'icons']
INCLUDE_FILES = ['index.html', 'manifest.webmanifest']
SKIP = {'models-stub.js'}

files = list(INCLUDE_FILES)
for d in INCLUDE_DIRS:
    for dp, _, fns in os.walk(os.path.join(ROOT, d)):
        for fn in sorted(fns):
            if fn.startswith('.') or fn in SKIP or fn.endswith('LICENSE'):
                continue
            files.append(os.path.relpath(os.path.join(dp, fn), ROOT).replace(os.sep, '/'))
files = sorted(set(files))
h = hashlib.sha256()
for f in files:
    with open(os.path.join(ROOT, f), 'rb') as fh:
        h.update(f.encode()); h.update(fh.read())
version = h.hexdigest()[:10]

template = open(os.path.join(ROOT, 'tools', 'sw.template.js')).read()
out = template.replace('__VERSION__', version).replace('__ASSETS__', json.dumps(['./'] + files, indent=2))
with open(os.path.join(ROOT, 'sw.js'), 'w') as fh:
    fh.write(out)
print(f'sw.js written: {len(files)} files, version {version}')
