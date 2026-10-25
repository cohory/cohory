"""Check relative markdown links and heading anchors across the Cohory doc set.

Usage: python3 check-links.py [repo-root]
Prints one line per defect and exits 1 when any is found.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
SKIP_DIRS = {".git", "node_modules", ".agents", ".learnings", "superpowers"}


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
                if name.endswith(".md"):
                    yield os.path.join(dirpath, name)


def anchors(path):
    out = set()
    with open(path, encoding="utf8") as fh:
        for line in fh:
            m = re.match(r"^#{1,6}\s+(.*)", line)
            if m:
                text = re.sub(r"[`*_]", "", m.group(1).strip())
                out.add(re.sub(r"[^\w\s-]", "", text.lower()).strip().replace(" ", "-"))
    return out


defects = 0
for path in sorted(doc_files()):
    rel = os.path.relpath(path, ROOT)
    folder = os.path.dirname(path)
    with open(path, encoding="utf8") as fh:
        for number, line in enumerate(fh, 1):
            for m in re.finditer(r"\]\(([^)\s]+)\)", line):
                link = m.group(1)
                if link.startswith(("http://", "https://", "mailto:")):
                    continue
                target_part, _, anchor = link.partition("#")
                target = os.path.normpath(os.path.join(folder, target_part)) if target_part else path
                if not os.path.exists(target):
                    print(f"{rel}:{number} MISSING {link}")
                    defects += 1
                elif anchor and target.endswith(".md") and anchor not in anchors(target):
                    print(f"{rel}:{number} NOANCHOR {link}")
                    defects += 1

print(f"check-links: {defects} defect(s)")
sys.exit(1 if defects else 0)
