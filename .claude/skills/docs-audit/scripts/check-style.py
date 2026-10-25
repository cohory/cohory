"""Check the house style rules that a script can judge: no dashes as punctuation,
no curly quotes, no emojis, outside code blocks, code spans, and tables.

Usage: python3 check-style.py [repo-root]
Prints one line per defect and exits 1 when any is found.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
SKIP_DIRS = {".git", "node_modules", ".agents", ".learnings", "superpowers"}
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐✅❌]")


def third_party_skills():
    lock = os.path.join(ROOT, "skills-lock.json")
    if not os.path.exists(lock):
        return set()
    with open(lock, encoding="utf8") as fh:
        return set(json.load(fh).get("skills", {}))


def doc_files():
    skip_skills = third_party_skills()
    for base in ("", "docs", ".github", ".claude/skills"):
        top = os.path.join(ROOT, base)
        if not os.path.isdir(top):
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            rel_dir = os.path.relpath(dirpath, ROOT)
            if base == "" and rel_dir != ".":
                dirnames[:] = []
                continue
            if rel_dir.startswith(".claude/skills/") and rel_dir.split("/")[2] in skip_skills:
                dirnames[:] = []
                continue
            for name in filenames:
                if name.endswith(".md") and name != "CODE_OF_CONDUCT.md":
                    yield os.path.join(dirpath, name)


defects = 0
for path in sorted(doc_files()):
    rel = os.path.relpath(path, ROOT)
    in_fence = False
    with open(path, encoding="utf8") as fh:
        for number, raw in enumerate(fh, 1):
            if raw.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            line = re.sub(r"`[^`]*`", "", raw)
            hits = []
            if "–" in line or "—" in line:
                hits.append("dash")
            if re.search(r"\S - \S", line) and not line.lstrip().startswith("|") and not re.match(r"^## \[", line):
                hits.append("spaced hyphen")
            if re.search("[‘’“”]", line):
                hits.append("curly quote")
            if EMOJI.search(line):
                hits.append("emoji")
            for hit in hits:
                print(f"{rel}:{number} {hit}: {raw.strip()[:100]}")
                defects += 1

print(f"check-style: {defects} defect(s)")
sys.exit(1 if defects else 0)
