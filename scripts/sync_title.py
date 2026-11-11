"""Set the README's title and subtitle from config/site.yaml (display_name, subtitle).

Both live only in config/site.yaml. Run after a rename:
    python3 scripts/sync_title.py
The README starts with "# <display_name>", a blank line, then "*<subtitle>*".
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
site = (root / "config" / "site.yaml").read_text(encoding="utf-8")


def key(name: str) -> str:
    return re.search(rf'^{name}:\s*"?([^"\n]+?)"?\s*$', site, re.M).group(1)


name, subtitle = key("display_name"), key("subtitle")
readme = root / "README.md"
text = readme.read_text(encoding="utf-8")
head = f"# {name}\n\n*{subtitle}*\n"
readme.write_text(re.sub(r"\A# [^\n]*\n(\n\*[^\n]*\*\n)?", lambda _: head, text, count=1), encoding="utf-8")
print(f"README title set to: {name} / {subtitle}")
