#!/usr/bin/env python3
"""Ice branding of Chromium's UI strings: "Chromium" -> "Ice".

Usage: ice-rebrand.py <chromium src dir>

Run by core-build/ice-hook.sh after the Ice patches. For each *_chromium_strings.grd
below, replaces the product name in the English messages (grd + its grdp parts) and in
every translation (.xtb). A translation is keyed by a fingerprint of the English text, so
the script parses the grd with the tree's own grit before and after the change and moves
each translation to its message's new ID; otherwise every changed message would fall
back to English. Credits / copyright ("The Chromium Authors", "Chromium open source
project", ...) are kept. Idempotent: a second run changes nothing.
"""
import glob, os, re, sys

GRDS = [
    'chrome/app/chromium_strings.grd',
    'components/components_chromium_strings.grd',
]
NAME = 'Ice'
# English: whole word only. Kept: credits/copyright and "Chromium OS".
KEEP = r'(?! (?:Authors|OS|open[ -]source|project|Project|team|developers))'
EN_RE = re.compile(r'\bChromium\b' + KEEP)
# Translations: also inflected forms (bs "Chromiuma", "Chromiumom" -> "Ice").
TR_RE = re.compile(r'\bChromium[^\W\d_]*' + KEEP)
TRANSLATION_RE = re.compile(r'(<translation id=")(\d+)(")(.*?)(</translation>)', re.S)


def message_ids(grit, grd):
    from grit import grd_reader
    from grit.node import message
    root = grd_reader.Parse(grd, dir=os.path.dirname(grd), skip_validation_checks=True)
    out = []
    for node in root.Preorder():
        if isinstance(node, message.MessageNode):
            out.append((node.attrs['name'], node.GetCliques()[0].GetId()))
    return root, out


def main():
    src = os.path.abspath(sys.argv[1])
    sys.path.insert(0, os.path.join(src, 'tools/grit'))
    total_msgs = total_tr = 0
    for rel in GRDS:
        grd = os.path.join(src, rel)
        if not os.path.isfile(grd):
            print(f'[ice] rebrand: {rel} not found, skipped')
            continue
        root, before = message_ids(None, grd)
        sources = [grd] + [os.path.join(os.path.dirname(grd), p.attrs['file'])
                           for p in root.Preorder() if p.name == 'part']
        xtbs = [os.path.join(os.path.dirname(grd), f.attrs['path'])
                for f in root.Preorder() if f.name == 'file' and f.attrs.get('path', '').endswith('.xtb')]
        for path in sources:
            text = open(path, encoding='utf-8').read()
            # Only message bodies, not attributes or comments.
            new = re.sub(r'(<message\b[^>]*>)(.*?)(</message>)',
                         lambda m: m.group(1) + EN_RE.sub(NAME, m.group(2)) + m.group(3),
                         text, flags=re.S)
            if new != text:
                open(path, 'w', encoding='utf-8').write(new)
        _, after = message_ids(None, grd)
        if [n for n, _ in before] != [n for n, _ in after]:
            sys.exit(f'[ice] rebrand: message list of {rel} changed while rebranding')
        id_map = {old: new for (_, old), (_, new) in zip(before, after) if old != new}
        total_msgs += len(id_map)
        for xtb in xtbs:
            if not os.path.isfile(xtb):
                continue
            text = open(xtb, encoding='utf-8').read()
            have = {m.group(2) for m in TRANSLATION_RE.finditer(text)}

            def fix(m):
                tid = id_map.get(m.group(2), m.group(2))
                # Never create a duplicate ID (an identical English message already
                # has a translation under the new ID).
                if tid != m.group(2) and tid in have:
                    tid = m.group(2)
                return m.group(1) + tid + m.group(3) + TR_RE.sub(NAME, m.group(4)) + m.group(5)

            new = TRANSLATION_RE.sub(fix, text)
            if new != text:
                total_tr += 1
                open(xtb, 'w', encoding='utf-8').write(new)
    print(f'[ice] rebrand: {total_msgs} message(s) renamed to "{NAME}", {total_tr} translation file(s) updated')


if __name__ == '__main__':
    main()
