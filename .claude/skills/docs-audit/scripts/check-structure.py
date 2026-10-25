"""Check the structural rules of the Cohory docs.

1. Every doc under docs/ (except README files and decision records) ends with a
   "Decisions and open questions" section that holds labeled bullets.
2. Every decision record has a status line, and the index in docs/decisions/README.md
   lists it with the same status word.
3. The current release number (from package.json) appears only where it may:
   CHANGELOG.md, decision records, the decisions log, dated reviews, research,
   env examples, and code blocks.
4. Every doc under docs/ is linked from at least one other doc.

Usage: python3 check-structure.py [repo-root]
Prints one line per defect and exits 1 when any is found.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
SKIP_DIRS = {".git", "node_modules", ".agents", ".learnings", "superpowers"}
LABELS = ("Confirmed", "Recommendation", "Assumption", "Open question")
VERSION_ALLOWED = ("CHANGELOG.md", "docs/decisions/", "docs/product/decisions-log.md", "docs/security/review-", "docs/research/")
defects = 0


def report(message):
    global defects
    defects += 1
    print(message)


def walk_md(base):
    top = os.path.join(ROOT, base)
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.endswith(".md"):
                yield os.path.join(dirpath, name)


def read(path):
    with open(path, encoding="utf8") as fh:
        return fh.read()


docs = sorted(walk_md("docs"))

for path in docs:
    rel = os.path.relpath(path, ROOT)
    if os.path.basename(path) == "README.md" or rel.startswith("docs/decisions/"):
        continue
    text = read(path)
    headings = re.findall(r"^##+ .*$", text, re.M)
    if not headings or "Decisions and open questions" not in headings[-1]:
        report(f"{rel}: last heading is not 'Decisions and open questions' ({headings[-1] if headings else 'no headings'})")
        continue
    tail = text[text.rindex(headings[-1]):]
    if not any(f"**{label}" in tail or f"| {label}" in tail or f"{label}:" in tail for label in LABELS):
        report(f"{rel}: Decisions section has no labeled statement")

index_path = os.path.join(ROOT, "docs/decisions/README.md")
index = read(index_path) if os.path.exists(index_path) else ""
for path in docs:
    rel = os.path.relpath(path, ROOT)
    name = os.path.basename(path)
    if not rel.startswith("docs/decisions/") or not re.match(r"\d{4}-", name):
        continue
    m = re.search(r"^- ADR status: (Proposed|Accepted|Superseded)", read(path), re.M)
    if not m:
        report(f"{rel}: no status line of the form '- ADR status: Proposed|Accepted|Superseded'")
        continue
    row = re.search(r"^\| \[(\d{4})\]\(" + re.escape(name) + r"\) \|.*\| *(Proposed|Accepted|Superseded)[^|]*\|\s*$", index, re.M)
    if not row:
        report(f"{rel}: not in docs/decisions/README.md with a status column")
    elif row.group(2) != m.group(1):
        report(f"{rel}: status line says {m.group(1)} but the index says {row.group(2)}")

package = os.path.join(ROOT, "package.json")
version = json.load(open(package, encoding="utf8")).get("version") if os.path.exists(package) else None
if version:
    pattern = re.compile(r"(?<![\d.])" + re.escape(version) + r"(?![\d.])")
    candidates = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "GOVERNANCE.md", "LICENSING.md"]
    candidates = [os.path.join(ROOT, c) for c in candidates if os.path.exists(os.path.join(ROOT, c))]
    candidates += docs + list(walk_md(".github")) + [os.path.join(ROOT, ".claude/skills/README.md")]
    for path in candidates:
        if not os.path.exists(path):
            continue
        rel = os.path.relpath(path, ROOT)
        if any(rel.startswith(a) for a in VERSION_ALLOWED):
            continue
        in_fence = False
        for number, raw in enumerate(read(path).split("\n"), 1):
            if raw.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            if pattern.search(re.sub(r"`[^`]*`", "", raw)):
                report(f"{rel}:{number}: current release number {version} outside CHANGELOG, records, and dated files")

linked = set()
for path in docs + [os.path.join(ROOT, "README.md"), os.path.join(ROOT, "AGENTS.md")]:
    if not os.path.exists(path):
        continue
    folder = os.path.dirname(path)
    for m in re.finditer(r"\]\(([^)#\s]+\.md)", read(path)):
        linked.add(os.path.normpath(os.path.join(folder, m.group(1))))
for path in docs:
    rel = os.path.relpath(path, ROOT)
    if rel.startswith("docs/decisions/") or os.path.basename(path) == "README.md":
        continue
    if os.path.normpath(path) not in linked:
        report(f"{rel}: not linked from any other doc")

print(f"check-structure: {defects} defect(s)")
sys.exit(1 if defects else 0)
