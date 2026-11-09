"""Set the README's first heading from config/site.yaml (display_name).

The display name lives only in config/site.yaml. Run after a rename:
    python3 scripts/sync_title.py
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
site = (root / "config" / "site.yaml").read_text(encoding="utf-8")
name = re.search(r'^display_name:\s*"?([^"\n]+?)"?\s*$', site, re.M).group(1)
readme = root / "README.md"
text = readme.read_text(encoding="utf-8")
readme.write_text(re.sub(r"\A# .*", f"# {name}", text, count=1), encoding="utf-8")
print(f"README title set to: {name}")
