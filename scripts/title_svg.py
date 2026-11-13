"""Render the display name (config/site.yaml) as outlined SVG paths in the owner's licensed title font.

Only the outlines of the letters in the name are written, never the font file: the BN Type EULA allows static output
("outlined vector") and forbids uploading the font to a public repository or serving it as a webfont without the
upgrade. Re-run after changing the name:  uv run --with fonttools --with uharfbuzz --with pyyaml python scripts/title_svg.py
Output: web/src/title.svg (generated; do not hand-edit). Without it the page falls back to plain text."""
from __future__ import annotations

import sys
from pathlib import Path

import uharfbuzz as hb
import yaml
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path(sys.argv[1] if len(sys.argv) > 1 else "/Library/Fonts/BNHillman.otf")


def main() -> None:
    name = yaml.safe_load((ROOT / "config/site.yaml").read_text())["display_name"]
    data = FONT.read_bytes()
    font = TTFont(FONT)
    upm = font["head"].unitsPerEm
    hbf = hb.Font(hb.Face(data))
    buf = hb.Buffer(); buf.add_str(name); buf.guess_segment_properties()
    hb.shape(hbf, buf, {"kern": True, "liga": True})
    glyphs, order = font.getGlyphSet(), font.getGlyphOrder()
    asc, desc = font["hhea"].ascent, font["hhea"].descent
    x, parts = 0, []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(glyphs)
        glyphs[order[info.codepoint]].draw(TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, asc - pos.y_offset)))
        if d := pen.getCommands():
            parts.append(d)
        x += pos.x_advance
    h = asc - desc
    svg = (f'<svg class="title-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x} {h}" role="img" aria-label="{name}">'
           f'<path fill="currentColor" d="{" ".join(parts)}"/></svg>\n')
    out = ROOT / "web/src/title.svg"
    out.write_text(svg)
    print(f"title_svg: {name!r}, {len(parts)} glyph outlines, {len(svg) / 1024:.1f} KB, aspect {x / h:.2f} (units per em {upm})")


if __name__ == "__main__":
    main()
