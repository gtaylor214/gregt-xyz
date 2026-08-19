#!/usr/bin/env python3
"""Static checks for the site. Stdlib only — no npm, no install.

    python3 test/check.py

Replaces what `zola build` used to catch. The last three checks are specific
to this project: nearly every bug this codebase has had was a mistyped custom
property or a cabinet panel that did not meet its neighbour, and neither an
HTML validator nor a CSS linter would have found either.
"""

import html.parser
import pathlib
import struct
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOID = {"meta", "link", "br", "hr", "img", "input", "source", "wbr"}
fails: list[str] = []


def fail(where: str, msg: str) -> None:
    fails.append(f"{where}: {msg}")


# ---------------------------------------------------------------- html shape
class Shape(html.parser.HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path, self.stack = path, []
        self.ids, self.hrefs, self.classes, self.styles = [], [], set(), []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.append(a["id"])
        if a.get("href"):
            self.hrefs.append(a["href"])
        if a.get("style"):
            self.styles.append(a["style"])
        self.classes.update((a.get("class") or "").split())
        if tag not in VOID:
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            fail(self.path, f"stray </{tag}> at line {self.getpos()[0]}")
        elif self.stack[-1][0] != tag:
            open_tag, line = self.stack[-1]
            fail(self.path, f"</{tag}> at line {self.getpos()[0]} closes <{open_tag}> opened at line {line}")
            self.stack.pop()
        else:
            self.stack.pop()


def read(rel):
    return (ROOT / rel).read_text()


pages = {}
for rel in ("index.html", "slopcade/index.html"):
    p = Shape(rel)
    p.feed(read(rel))
    for tag, line in p.stack:
        fail(rel, f"<{tag}> opened at line {line} is never closed")
    pages[rel] = p

# ----------------------------------------------------------------- css shape
sheets = {}
for rel in ("css/site.css", "slopcade/arcade.css"):
    css = re.sub(r"/\*.*?\*/", "", read(rel), flags=re.S)
    sheets[rel] = css
    for open_c, close_c in (("{", "}"), ("(", ")")):
        if css.count(open_c) != css.count(close_c):
            fail(rel, f"unbalanced {open_c}{close_c}: {css.count(open_c)} vs {css.count(close_c)}")

# --------------------------------------------------- custom property defined?
# A var() with no definition and no fallback silently invalidates whatever
# property it feeds. That is how the cabinets went transparent once already.
defined = set()
for css in sheets.values():
    defined.update(re.findall(r"(--[\w-]+)\s*:", css))
for page in pages.values():
    for style in page.styles:
        defined.update(re.findall(r"(--[\w-]+)\s*:", style))

used = set()
for css in sheets.values():
    used.update(re.findall(r"var\(\s*(--[\w-]+)\s*\)", css))  # no fallback given
for name in sorted(used - defined):
    fail("css", f"var({name}) is never defined and has no fallback")

# ------------------------------------------------------------- classes exist?
styled = set()
for css in sheets.values():
    styled.update(re.findall(r"\.([A-Za-z][\w-]*)", css))
for rel, page in pages.items():
    for cls in sorted(page.classes - styled):
        fail(rel, f'class "{cls}" has no rule in any stylesheet')

# ---------------------------------------------------------------- links land?
for rel, page in pages.items():
    for href in page.hrefs:
        if href.startswith(("http://", "https://", "mailto:")):
            continue
        if href.startswith("#"):
            if href[1:] not in page.ids:
                fail(rel, f'href "{href}" has no matching id on the page')
        else:
            target = ROOT / href.lstrip("/")
            if not (target.exists() or (target / "index.html").exists()):
                fail(rel, f'href "{href}" does not resolve to a file')

# ------------------------------------------------------- cabinet geometry
# The elevation must be continuous and nothing may sit forward of the control
# box, or you get the gaps we spent a day chasing: a floating control panel, a
# marquee overhanging the sides, the lit interior visible under the screen.
block = re.search(r"\.cab\s*\{(.*?)\n\}", sheets["slopcade/arcade.css"], re.S)
decls = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block.group(1))) if block else {}


def value(name, seen=()):
    """Resolve a custom property through calc()/var() to a number."""
    if name in seen:
        raise ValueError(f"{name} is defined in terms of itself")
    expr = decls[name].strip()
    expr = re.sub(r"var\(\s*(--[\w-]+)[^)]*\)",
                  lambda m: f"({value(m.group(1), seen + (name,))})", expr)
    expr = expr.replace("calc", "")
    return eval(expr, {"__builtins__": {}}, {})  # noqa: S307 - arithmetic only


if not decls:
    fail("slopcade/arcade.css", "no .cab rule found — geometry unchecked")
else:
    try:
        g = {k: value(k) for k in decls if not decls[k].strip().startswith(("#", "var(--hue"))}
        bands = [("kick top", g["--base-h"]), ("control lip", g["--cpf-z"]),
                 ("alcove sill", g["--cpb-z"]), ("marquee sill", g["--alc-z1"]),
                 ("top", g["--H"])]
        for (an, av), (bn, bv) in zip(bands, bands[1:]):
            if not av < bv:
                fail("geometry", f"{an} ({av:.1f}) is not below {bn} ({bv:.1f})")
        if abs(g["--cpb-y"] - (g["--hd"] - g["--cp-in"])) > 1e-6:
            fail("geometry", "alcove back does not sit at the control panel's rear edge")
        if abs(g["--side-w"] - (g["--D"] + g["--cp-out"])) > 1e-6:
            fail("geometry", "side panels are too narrow to wrap the control box")
        if not g["--cpf-y"] > g["--hd"]:
            fail("geometry", "control box does not stand proud of the front face")
    except Exception as exc:  # noqa: BLE001
        fail("geometry", f"could not resolve .cab variables: {exc}")

# ------------------------------------------------------- preview aspect
# A preview is captured at the tube's viewport, not resized to it: the game
# lays itself out for whatever width it is given, so a wide screenshot scaled
# down is a picture of a different rendering. Aspect is the part that can be
# checked from here.
def image_size(path):
    d = path.read_bytes()
    if d[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", d[16:24])
    i = 2
    while i < len(d) - 9:
        if d[i] != 0xFF:
            i += 1
            continue
        marker = d[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB):
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack(">H", d[i + 2:i + 4])[0]
    return None


screen = re.search(r"\.cab \.screen\s*\{(.*?)\n\}", sheets["slopcade/arcade.css"], re.S)
tube_w = tube_h = None
if screen:
    m = re.search(r"--w:\s*([\d.]+);\s*--h:\s*([\d.]+);", screen.group(1))
    if m:
        tube_w, tube_h = float(m.group(1)), float(m.group(2))

pw = re.search(r"--pw:\s*(\d+)", read("slopcade/index.html"))
for shot in sorted(ROOT.glob("slopcade/*/preview.*")):
    if shot.suffix.lower() not in (".jpg", ".jpeg", ".png"):
        continue
    size = image_size(shot)
    rel = shot.relative_to(ROOT)
    if not size:
        fail(str(rel), "could not read image dimensions")
    elif tube_w:
        w, h = size
        want, got = tube_w / tube_h, w / h
        if abs(got - want) / want > 0.02:
            fail(str(rel), f"is {w}x{h} (aspect {got:.3f}) but the tube is {want:.3f} — "
                           f"capture at {int(pw.group(1))}x{round(int(pw.group(1)) * tube_h / tube_w)}")
        elif pw and w < int(pw.group(1)):
            fail(str(rel), f"is {w}x{h}, narrower than the {pw.group(1)}px viewport it stands in for")

# --------------------------------------------------- nested frames reset?
# --x/--y/--z/--rot/--tilt all inherit. A frame that does not declare them
# re-applies its parent's offset, which is how the joystick shaft ended up at
# double its x. .grp must reset every one it reads.
grp = re.search(r"\.grp\s*\{(.*?)\n\}", sheets["slopcade/arcade.css"], re.S)
if not grp:
    fail("slopcade/arcade.css", "no .grp rule found — frame resets unchecked")
else:
    own = set(re.findall(r"(--[\w-]+)\s*:", grp.group(1)))
    for name in re.findall(r"var\(\s*(--[\w-]+)\s*(?:,|\))", grp.group(1)):
        if name not in own:
            fail("slopcade/arcade.css",
                 f".grp reads {name} without resetting it — nested frames will "
                 f"inherit their parent's value and apply it twice")

# ------------------------------------------------------------------- report
if fails:
    print(f"FAIL — {len(fails)} problem(s)\n")
    for f in fails:
        print(f"  {f}")
    sys.exit(1)
print("ok — html, css, custom properties, links and cabinet geometry all check out")
