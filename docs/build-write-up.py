"""Print docs/write-up.html to docs/AnyWay-Chat-Write-up.pdf (A4, tagged for screen readers, with bookmarks).

Needs Google Chrome and PyMuPDF:  python3 docs/build-write-up.py
"""
import html
import os
import re
import subprocess
import tempfile

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'write-up.html')
OUT = os.path.join(HERE, 'AnyWay-Chat-Write-up.pdf')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

with tempfile.TemporaryDirectory() as profile:
    subprocess.run([
        CHROME, '--headless=new', '--disable-gpu', f'--user-data-dir={profile}', '--no-first-run',
        '--no-pdf-header-footer', '--export-tagged-pdf', '--generate-pdf-document-outline',
        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=20000',
        f'--print-to-pdf={OUT}', f'file://{SRC}',
    ], check=True, stderr=subprocess.DEVNULL)

# Chrome drops the space where a heading wraps ("readerunderstands"), so the bookmarks are rebuilt from the headings.
src = open(SRC, encoding='utf-8').read()
heads = [' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', h)).split()) for h in re.findall(r'<h[1-3][^>]*>(.*?)</h[1-3]>', src, re.S)]
key = lambda t: re.sub(r'\s+', '', t)
fix = {key(h): h for h in heads}

doc = fitz.open(OUT)
toc = [[lvl, fix[key(t)], pg] for lvl, t, pg in doc.get_toc() if key(t) in fix]
toc = [[1 if (i == 0 or lvl <= 2) else 2, t, pg] for i, (lvl, t, pg) in enumerate(toc)]
doc.set_toc(toc)
doc.set_metadata({**doc.metadata,
                  'title': 'AnyWay Chat: write-up for the Nexconn Build Challenge 2026',
                  'subject': 'One chat where deaf, blind and non-speaking people, and older people losing their sight or hearing, talk with anyone, each in their own way.',
                  'keywords': 'Nexconn, accessibility, sign language, ISL, blind, deaf, AAC, older adults'})
tmp = OUT + '.tmp'
doc.save(tmp, garbage=0, deflate=True)
doc.close()
os.replace(tmp, OUT)
print(f'{OUT}: {fitz.open(OUT).page_count} pages')
