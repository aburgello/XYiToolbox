#!/usr/bin/env python3
"""
aep_screens.py -- recover a bespoke screen's LAYOUT from its template .aep,
without opening After Effects.

Uses py-aep, which parses the .aep RIFX binary directly, exactly as
aep_layers.py does for the master check. Same interpreter, same venv.

READ-ONLY, DELIBERATELY. py-aep can modify and save projects. Nothing here
imports, calls or goes near `.save()`, and nothing is ever written inside the
tree being scanned -- results go to stdout as JSON for the panel to consume.
This is the whole reason the enrichment can exist at all: CLAUDE.md's first
constraint forbids opening a studio master as its own editable project, and
this never opens anything.

Usage
-----
    python aep_screens.py --paths-from <file-of-aep-paths>   [--quiet]
    python aep_screens.py <aep> [<aep> ...]

Emits ONE JSON object on stdout:

    {"results": [
       {"path": "...", "ok": true, "comp": "...", "width": 7200, "height": 1240,
        "duration": 60.0, "depth": 1,
        "reference": "/Volumes/.../VorlageScreens_Welle.png",
        "slots": [{"name":"...","x":0,"y":0,"w":900,"h":1240,"rotation":0}, ...]},
       {"path": "...", "ok": false, "error": "Missing dwga chunk"}
    ]}

A file that cannot be parsed is REPORTED, never silently dropped -- roughly a
third of the estate is on an AE version py-aep cannot read yet, and a template
that vanishes from a report with no explanation is the exact failure mode this
studio has been bitten by before.
"""

import argparse
import json
import os
import re
import sys

try:
    import py_aep
except ImportError:
    sys.exit("py-aep isn't installed in this interpreter.\n"
             "    python3 -m venv aepenv && ./aepenv/bin/pip install py-aep")


SIZE_RE = re.compile(r"(?<![0-9])(\d{2,5})\s*[xX]\s*(\d{2,5})(px)?(?![0-9])")

# Anything image-shaped is a CANDIDATE...
IMG_EXT = (".jpg", ".jpeg", ".png", ".psd", ".tif", ".tiff", ".gif", ".webp")
# ...but only these can actually be painted by the panel. CEP is Chromium: it
# cannot render a PSD or a TIFF, so `Insitu.psd` scored top, was filed as the
# reference, and then showed as a broken image. Renderable formats are ranked
# above the rest rather than filtered out, so a PSD-only template still reports
# something and the panel can say why it cannot show it.
RENDERABLE_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp")

# Words that mark a footage item as the SCREEN REFERENCE -- the diagram or
# in-situ photo an artist traces over. Taken from the real estate: Vorlage is
# German for "template", Abbildung for "figure".
REF_WORDS = ("insitu", "in_situ", "in-situ", "vorlage", "abbildung", "ref",
             "reference", "spec", "mask", "screen", "layout", "plan", "grid")
# ...and words that mark one as definitely NOT it, however big it is.
NOT_REF_WORDS = ("logo", "frontcard", "endcard", "font", "texture", "grain",
                 "lut", "matte_source", "audio")


def val(prop, default=None):
    """py-aep property -> its value, or the default."""
    if prop is None:
        return default
    return getattr(prop, "value", default)


def pick_main_comp(app, path):
    """Which comp IS the screen?

    aep_layers.py's heuristic, and for the same reason: falling back to "the
    comp with the most layers" picks a component precomp or a 1920x1080 in-situ
    mockup and then measures it against the filename. Order:
      1. the comp named exactly like the file (the studio convention)
      2. the same, ignoring case
      3. a ROOT comp -- not used as a layer anywhere -- whose size matches the
         filename
      4. any root comp
    """
    comps = list(app.project.compositions)
    if not comps:
        return None
    stem = os.path.splitext(os.path.basename(path))[0]

    for c in comps:
        if getattr(c, "name", "") == stem:
            return c
    for c in comps:
        if str(getattr(c, "name", "")).lower() == stem.lower():
            return c

    used = set()
    for c in comps:
        for layer in (list(getattr(c, "layers", [])) or []):
            src = getattr(layer, "source", None)
            if src is not None:
                used.add(id(src))
    roots = [c for c in comps if id(c) not in used]

    m = SIZE_RE.search(stem)
    if m:
        want = (int(m.group(1)), int(m.group(2)))
        for c in roots:
            if (getattr(c, "width", 0), getattr(c, "height", 0)) == want:
                return c
    return roots[0] if roots else comps[0]


def layer_rects(comp):
    """Every layer as a comp-space rectangle.

    x/y is the TOP-LEFT, which is what Bespoke's regions use -- AE gives
    position relative to the anchor point, so the anchor has to be subtracted
    at the layer's own scale.
    """
    out = []
    for layer in (list(getattr(comp, "layers", [])) or []):
        tr = getattr(layer, "transform", None)
        if tr is None:
            continue
        pos = val(getattr(tr, "position", None)) or [0, 0, 0]
        anc = val(getattr(tr, "anchor_point", None)) or [0, 0, 0]
        scl = val(getattr(tr, "scale", None)) or [100, 100, 100]
        rot = val(getattr(tr, "rotation", None)) or 0
        src = getattr(layer, "source", None)
        sw = getattr(src, "width", None) or getattr(layer, "width", 0) or 0
        sh = getattr(src, "height", None) or getattr(layer, "height", 0) or 0
        fx = (scl[0] if len(scl) > 0 else 100) / 100.0
        fy = (scl[1] if len(scl) > 1 else 100) / 100.0
        out.append({
            "name": str(getattr(layer, "name", "") or ""),
            "x": pos[0] - anc[0] * fx,
            "y": pos[1] - anc[1] * fy,
            "w": sw * fx,
            "h": sh * fy,
            "rotation": rot,
            "source": src,
            "enabled": bool(getattr(layer, "enabled", True)),
        })
    return out


def _fills(r, cw, ch, tol=3):
    return abs(r["w"] - cw) < tol and abs(r["h"] - ch) < tol


# Layer names that are treatment, not a screen region. Measured, not guessed:
# without this, 51 of 210 templates reported exactly 15 "slots" -- the recursion
# had landed in an artwork comp and was counting Noise, Optical_Flare and four
# Diamond_* adjustment layers as regions.
FX_WORDS = ("noise", "flare", "fade", "chromatic", "aberration", "grade", "grain",
            "vignette", "glow", "blur", "adjustment", "control", "null",
            "maintainscale", "guide", "bg", "background", "matte", "light",
            "camera", "audio", "logo", "frontcard", "endcard",
            # The studio's own rig layers, which sit in a lot of these files.
            "gradient", "mainscale", "over_ride", "override", "scale_control")


def _is_region(r, cw, ch):
    """Would a person call this rectangle one of the screen's panels?

    Three tests, all learned from the real estate:
      - not named like a treatment layer
      - not disabled
      - substantially INSIDE the canvas. The Nile City FX comp had layers at
        y=-1135 measuring 6880x3870 against a 6880x1600 screen; the Printworks
        template has a genuine 2x2 grid of 960x540 panels plus one 3840x1920
        backdrop hanging off the edges, and only the grid is the layout.
    """
    if not r.get("enabled", True):
        return False
    low = r["name"].lower()
    for w in FX_WORDS:
        if w in low:
            return False
    if not cw or not ch:
        return True
    # Allow a small bleed, reject anything mostly off-canvas or oversized.
    if r["w"] > cw * 1.05 or r["h"] > ch * 1.05:
        return False
    margin_x, margin_y = cw * 0.1, ch * 0.1
    if r["x"] < -margin_x or r["y"] < -margin_y:
        return False
    if r["x"] + r["w"] > cw + margin_x or r["y"] + r["h"] > ch + margin_y:
        return False
    return True


def find_slots(comp, depth=0, max_depth=3):
    """The screen's regions, descending through wrapper precomps.

    The Welle template is why this recurses: its top level is three layers that
    each fill 7200x1240 (a nested comp, a duplicate and a white solid) and the
    eight actual panels live one precomp down. So while EVERY layer at this
    level fills the canvas, step into the first one that is a comp.

    A level qualifies as a layout only if at least two layers do NOT fill the
    canvas -- one region is not a bespoke screen, it is a full-frame master.
    """
    cw = getattr(comp, "width", 0) or 0
    ch = getattr(comp, "height", 0) or 0
    rects = [r for r in layer_rects(comp) if r["w"] > 0 and r["h"] > 0]
    if not rects:
        return [], depth

    filling = [r for r in rects if _fills(r, cw, ch)]
    if depth < max_depth and len(filling) == len(rects):
        for r in filling:
            src = r["source"]
            if src is not None and hasattr(src, "layers"):
                got, d = find_slots(src, depth + 1, max_depth)
                if got:
                    return got, d

    partial = [r for r in rects if not _fills(r, cw, ch) and _is_region(r, cw, ch)]
    if len(partial) < 2:
        return [], depth
    return partial, depth


def score_reference(name, path, w, h, cw, ch):
    """How likely is this footage item to be the screen reference?

    Size alone is not enough -- only 13% of templates hold an image at exactly
    the comp's pixel size, and 'largest image' happily returns the XYi logo.
    Name evidence carries most of the weight, and the studio is consistent
    about it: Insitu, Vorlage, Abbildung, Mask, Ref.
    """
    hay = (str(name) + " " + str(path)).lower()
    for bad in NOT_REF_WORDS:
        if bad in hay:
            return -1
    score = 0
    for word in REF_WORDS:
        if word in hay:
            score += 40
            break
    if cw and ch:
        if (w, h) == (cw, ch):
            score += 60
        elif w and h:
            # Same shape as the screen, even at a different resolution, is
            # strong evidence -- a spec drawing is usually a scaled copy.
            want = float(cw) / ch
            got = float(w) / h
            if abs(want - got) / max(want, 0.0001) < 0.02:
                score += 30
    # Bigger is a mild tiebreak, never the deciding factor.
    score += min(10, (w * h) / 4000000.0)
    # A format the panel cannot paint is still a candidate, but never the
    # preferred one while a renderable file exists.
    if not path.lower().endswith(RENDERABLE_EXT):
        score -= 100
    return score


# Folder names that hold the CLIENT'S OWN spec material, sitting beside the
# template rather than inside it: Bio_Rex_Tripla/{AE_template, Specs}. Nothing
# in the .aep ever points at these, so no amount of parsing finds them.
SPEC_DIR_WORDS = ("spec", "specs", "specsheet", "specsheets", "specification",
                  "specifications")

# How far up from the .aep to look for one. The estate is 19 templates at
# Country/x.aep and the rest one to three levels deeper, and the NEAREST spec
# folder wins -- walking to the top would hang every screen in a country off
# the same shared folder.
SPEC_WALK_UP = 3
SPEC_MAX_FILES = 60

# A disk find loses a tie with something the artist actually linked inside the
# template. Every file in a Specs folder scores the +40 for the word "spec" in
# its path, deserved or not, so without this a stray photo in Specs would
# outrank a real in-situ image in the .aep.
SPEC_TIEBREAK = -5


def _u16(b, i, big):
    return (b[i] << 8 | b[i + 1]) if big else (b[i + 1] << 8 | b[i])


def image_size(path):
    """(width, height) from the file HEADER, or (0, 0).

    Worth the parsing: size is 90 points of the reference score, and a spec
    drawing is usually a scaled copy of the screen, which the aspect-ratio test
    catches. Reading the header beats opening the image, and these live on a
    network share.
    """
    try:
        with open(path, "rb") as fh:
            head = fh.read(262144)
    except Exception:
        return (0, 0)
    if len(head) < 24:
        return (0, 0)
    try:
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return (_u16(head, 18, True) | head[16] << 24 | head[17] << 16,
                    _u16(head, 22, True) | head[20] << 24 | head[21] << 16)
        if head[:3] == b"GIF":
            return (_u16(head, 6, False), _u16(head, 8, False))
        if head[:2] == b"\xff\xd8":
            i = 2
            while i + 9 < len(head):
                if head[i] != 0xFF:
                    i += 1
                    continue
                marker = head[i + 1]
                # SOF0-SOF15 carry the dimensions; DHT/JPG/DAC do not.
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    return (_u16(head, i + 7, True), _u16(head, i + 5, True))
                seg = _u16(head, i + 2, True)
                if seg <= 0:
                    break
                i += 2 + seg
            return (0, 0)
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            if head[12:16] == b"VP8X":
                w = head[24] | head[25] << 8 | head[26] << 16
                h = head[27] | head[28] << 8 | head[29] << 16
                return (w + 1, h + 1)
            if head[12:16] == b"VP8 ":
                return (_u16(head, 26, False) & 0x3FFF, _u16(head, 28, False) & 0x3FFF)
    except Exception:
        return (0, 0)
    return (0, 0)


def _spec_dirs_near(aep_path):
    """The nearest spec folder(s) above the .aep, or []."""
    here = os.path.dirname(os.path.abspath(aep_path))
    for _ in range(SPEC_WALK_UP + 1):
        found = []
        try:
            for entry in os.scandir(here):
                if not entry.is_dir():
                    continue
                name = entry.name
                if name.startswith("_") or name.startswith("."):
                    continue
                flat = re.sub(r"[^a-z0-9]", "", name.lower())
                if flat in SPEC_DIR_WORDS:
                    found.append(entry.path)
        except OSError:
            return []
        if found:
            return found
        parent = os.path.dirname(here)
        if parent == here:
            return []
        here = parent
    return []


def find_spec_images(aep_path, cw, ch):
    """Every plausible reference sitting in a Specs folder BESIDE the template.

    The scoring is the same one the in-.aep candidates go through, because the
    question is the same one: is this the diagram an artist can trace over?
    Files are ranked, never filtered on the folder alone -- a Specs folder holds
    the resolution PDF, the client's deck and the odd render as readily as it
    holds the screen drawing.
    """
    out = []
    for spec_dir in _spec_dirs_near(aep_path):
        for root, dirs, files in os.walk(spec_dir):
            # Same convention as the rest of the toolbox: _Old, _Archive and
            # Auto-Save folders are not part of any scan.
            dirs[:] = [d for d in dirs if not d.startswith("_") and not d.startswith(".")
                       and "auto-save" not in d.lower()]
            if root[len(spec_dir):].count(os.sep) >= 2:
                dirs[:] = []
            for name in files:
                if name.startswith("."):
                    continue
                if not name.lower().endswith(IMG_EXT):
                    continue
                path = os.path.join(root, name)
                w, h = image_size(path)
                score = score_reference(name, path, w, h, cw, ch)
                if score <= 0:
                    continue
                out.append({"path": path, "width": w, "height": h,
                            "renderable": name.lower().endswith(RENDERABLE_EXT),
                            "source": "specs", "score": score + SPEC_TIEBREAK})
                if len(out) >= SPEC_MAX_FILES:
                    return out
    return out


def merge_references(*lists):
    """One ranked list, best first, each path appearing once."""
    everything = []
    for lst in lists:
        everything.extend(lst)
    everything.sort(key=lambda r: -r["score"])
    seen, out = set(), []
    for r in everything:
        try:
            key = os.path.normcase(os.path.realpath(r["path"]))
        except Exception:
            key = os.path.normcase(r["path"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"path": r["path"], "width": r["width"], "height": r["height"],
                    "renderable": r["renderable"], "source": r.get("source", "aep")})
    return out


def find_references(app, comp):
    """EVERY plausible reference, best first.

    One pick was not enough: the scoring is heuristic and gets it wrong often
    enough that the artist needs to be able to step to the next candidate
    rather than give up on the screen. Returning the ranked list costs nothing
    -- they are already enumerated -- and turns a wrong guess into one click.
    """
    cw = getattr(comp, "width", 0) or 0
    ch = getattr(comp, "height", 0) or 0
    scored = []
    for item in app.project.footages:
        path = str(getattr(item, "file", "") or "")
        if not path.lower().endswith(IMG_EXT):
            continue
        w = getattr(item, "width", 0) or 0
        h = getattr(item, "height", 0) or 0
        s = score_reference(getattr(item, "name", ""), path, w, h, cw, ch)
        # Below zero is a blocklisted name (logo, frontcard); it is not a
        # reference at any position in the list.
        if s <= 0:
            continue
        scored.append((s, path, w, h))
    scored.sort(key=lambda t: -t[0])

    seen, out = set(), []
    for s, path, w, h in scored:
        if path in seen:
            continue
        seen.add(path)
        out.append({"path": path, "width": w, "height": h,
                    "renderable": path.lower().endswith(RENDERABLE_EXT),
                    "source": "aep", "score": s})
    return out


def read_one(path):
    try:
        app = py_aep.parse(path)
    except Exception as exc:
        # STILL WORTH ANSWERING. Roughly one template in fifteen is on an AE
        # version py-aep cannot read, and those screens have never had a
        # reference of any kind -- but the Specs folder beside them is just
        # files on disk. The row stays ok:false, because the .aep genuinely
        # was not read and the count must keep saying so.
        return {"path": path, "ok": False, "error": "%s: %s" % (type(exc).__name__, exc),
                "references": merge_references(find_spec_images(path, 0, 0))}
    try:
        comp = pick_main_comp(app, path)
        if comp is None:
            return {"path": path, "ok": False, "error": "no compositions"}
        slots, depth = find_slots(comp)
        cw = getattr(comp, "width", 0) or 0
        ch = getattr(comp, "height", 0) or 0
        refs = merge_references(find_references(app, comp),
                                find_spec_images(path, cw, ch))
        return {
            "path": path,
            "ok": True,
            "comp": str(getattr(comp, "name", "") or ""),
            "width": cw,
            "height": ch,
            "duration": getattr(comp, "duration", 0) or 0,
            "depth": depth,
            # `reference` stays the single best pick; `references` is the ranked
            # list the panel lets the artist step through.
            "reference": refs[0]["path"] if refs else "",
            "references": refs,
            "slots": [{
                "name": s["name"],
                "x": int(round(s["x"])), "y": int(round(s["y"])),
                "w": int(round(s["w"])), "h": int(round(s["h"])),
                "rotation": int(round(s["rotation"])) % 360,
            } for s in slots],
        }
    except Exception as exc:
        return {"path": path, "ok": False, "error": "%s: %s" % (type(exc).__name__, exc),
                "references": merge_references(find_spec_images(path, 0, 0))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("aeps", nargs="*")
    ap.add_argument("--paths-from", default="")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    paths = list(args.aeps)
    if args.paths_from:
        with open(args.paths_from, "r") as fh:
            paths += [ln.strip() for ln in fh if ln.strip()]

    results = []
    for i, p in enumerate(paths):
        if not args.quiet:
            sys.stderr.write("[%d/%d] %s\n" % (i + 1, len(paths), os.path.basename(p)))
            sys.stderr.flush()
        results.append(read_one(p))

    json.dump({"results": results}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
