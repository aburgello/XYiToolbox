// =============================================================================
// src/js/main/tools/InsituBoard.tsx
// -----------------------------------------------------------------------------
// The third kind of build: the deliverable on the wall, in a photo of the site.
//
// A FACE IS A STRIP OF SEGMENTS, and curvature belongs to a SEGMENT rather than
// to the face. A wall can run straight for two panels and bow on the third, and
// asking the whole face to be one or the other is what made the first version
// awkward: buttons disabled each other, Smooth answered "make this curve" by
// multiplying four handles into thirty-two, and adding a point split whichever
// span happened to be longest instead of the one being pointed at.
//
// So: click a segment, then act on it. Point splits THAT segment. Bezier curves
// THAT segment, giving it four handles. Smooth curves every segment through the
// ribs already placed and adds none.
//
// AE IS WRITTEN TO, NEVER READ. Corner Pin and Bezier Warp points both throw on
// read in 26.2 (see src/jsx/aeft/insitu.ts), so this panel is the only copy of
// the shape.
// =============================================================================
import React, { useEffect, useRef, useState } from "react";
import {
    ArrowLeft, Image as ImageIcon, Plus, Trash2, Hammer, Copy, RotateCcw,
    MousePointer2, Spline, CircleDashed, Cylinder, Library, Save,
} from "lucide-react";
import { csi, evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import ScreenLibrary, { ScreenEntry } from "./ScreenLibrary";
import { detectShapes } from "../lib/detectShapes";
import "./InsituBoard.scss";

export interface InsituMaster { path: string; name: string; width: number; height: number }
export interface ProjectPick {
    id: number; name: string; kind: string;
    width: number; height: number; duration: number; isStill: boolean; path: string;
}

/**
 * A cell's curvature, edge by edge.
 *
 * `t` is EIGHT tangents, two per edge, in edge order: top (left to right),
 * right (top to bottom), bottom (LEFT TO RIGHT, not the direction Bezier Warp
 * wants), left (bottom to top). `edges` says which of those four are actually
 * bent; the rest are computed as straight thirds at build time.
 *
 * Four editable edges rather than two, because nobody knows in advance which
 * sides of a screen are curved -- a ribbon wrapping a corner bends on the
 * verticals, a bowed facade on the horizontals, and a dome on all four.
 */
export interface Segment {
    curved: boolean;
    t: [number, number][];
    edges: boolean[];
}

type Edge = 0 | 1 | 2 | 3;      // top, right, bottom, left
const EDGE_NAMES = ["top", "right", "bottom", "left"];

type Corner = "ul" | "ur" | "ll" | "lr";
type Pt = [number, number];
type Side = "top" | "bottom" | "left" | "right";

export interface Face {
    id: number;
    name: string;
    /** grid[row][col]. Two by two is the flat quad; columns divide the screen
     *  along its length, rows down its height. */
    grid: Pt[][];
    /** cells[row][col], one per quad between four grid points. */
    cells: Segment[][];
    sourceId: number;
    sourceName: string;
    masterPath: string;
    /** 0 for a flat wall, else how much of a drum this face shows. */
    wrapDeg: number;
    bulge: number;
    cylinder: boolean;
    cylinderRadius: number;
    cylinderRotation: number;
    /** How many degrees of the drum the artwork covers. */
    cylinderWrap: number;
    /** The real outline, when Detect found one worth keeping. Built as a mask
     *  rather than a warped quad -- see insitu.ts. */
    outline: [number, number][];
    opacity: number;
    blend: string;
}

const rows = (f: Face) => f.grid.length;
const cols = (f: Face) => (f.grid[0] ? f.grid[0].length : 0);
const corner = (f: Face, c: Corner): Pt => {
    const r = rows(f) - 1;
    const k = cols(f) - 1;
    if (c === "ul") return f.grid[0][0];
    if (c === "ur") return f.grid[0][k];
    if (c === "ll") return f.grid[r][0];
    return f.grid[r][k];
};

interface Props {
    masters: InsituMaster[] | null;
    suggestions?: { path: string; name: string }[];
    defaultName?: string;
    /** THE SAME LIBRARY BESPOKE USES. One screen, one card: an in-situ laid
     *  out here is stored on the entry a Bespoke layout already uses, so both
     *  show up in the same place with the same filtering. */
    templates?: ScreenEntry[];
    onReloadTemplates?: () => void;
    onBack: () => void;
}

const fileUrl = (fsPath: string): string => {
    if (!fsPath) return "";
    let raw = fsPath;
    try { raw = decodeURI(fsPath); } catch { /* a literal % in the name */ }
    return "file://" + encodeURI(raw).replace(/#/g, "%23").replace(/\?/g, "%3F");
};

const leaf = (p: string) => p.substring(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || p;

const lerp = (p: number[], q: number[], k: number): [number, number] =>
    [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];

/** One cell per gap, whatever just happened to the grid. */
function fixCells(f: Face): Face {
    const wantR = Math.max(1, rows(f) - 1);
    const wantC = Math.max(1, cols(f) - 1);
    const cells: Segment[][] = [];
    for (let r = 0; r < wantR; r++) {
        const row: Segment[] = [];
        for (let c = 0; c < wantC; c++) {
            const was = f.cells[r] && f.cells[r][c] ? f.cells[r][c] : flatCell();
            row.push(was);
        }
        cells.push(row);
    }
    return { ...f, cells };
}

/** A cell's four tangents at the thirds of its own top and bottom edges, so
 *  turning the curve on changes nothing until a handle is moved. */
function straightTangents(f: Face, r: number, c: number): Pt[] {
    const ul = f.grid[r][c];
    const ur = f.grid[r][c + 1];
    const ll = f.grid[r + 1][c];
    const lr = f.grid[r + 1][c + 1];
    return [
        lerp(ul, ur, 1 / 3), lerp(ul, ur, 2 / 3),      // top
        lerp(ur, lr, 1 / 3), lerp(ur, lr, 2 / 3),      // right
        lerp(ll, lr, 1 / 3), lerp(ll, lr, 2 / 3),      // bottom, left to right
        lerp(ll, ul, 1 / 3), lerp(ll, ul, 2 / 3),      // left, bottom to top
    ];
}

/** The four corners of a cell, in UL, UR, LR, LL order. */
function cellCorners(f: Face, r: number, c: number): [Pt, Pt, Pt, Pt] {
    return [f.grid[r][c], f.grid[r][c + 1], f.grid[r + 1][c + 1], f.grid[r + 1][c]];
}

/**
 * One cell, bowed by `bulge`, with no tiling at all.
 *
 * THIS IS WHAT "CURVED" SHOULD ALWAYS HAVE BEEN. Cutting a bend into eight
 * tiles put a visible seam between every pair and gave the artist eight things
 * to adjust instead of one number. A single Bezier Warp bends the top and
 * bottom edges of ONE layer, so there is nothing to seam.
 *
 * Tiles remain for the shape a single cubic cannot express -- an S-curve turns
 * twice -- under "Shape it by hand".
 */
function bowedCell(f: Face, bulge: number): Face {
    const ul = corner(f, "ul");
    const ur = corner(f, "ur");
    const ll = corner(f, "ll");
    const lr = corner(f, "lr");

    const bow = (a: Pt, b: Pt): Pt[] => {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        // A cubic sits inside its handles, so the sagitta is scaled by 4/3 to
        // land the middle of the curve on the bow the artist asked for.
        const k = len * bulge * (4 / 3);
        const at = (t: number): Pt => [
            a[0] + dx * t + nx * k * 4 * t * (1 - t),
            a[1] + dy * t + ny * k * 4 * t * (1 - t),
        ];
        return [at(1 / 3), at(2 / 3)];
    };

    const top = bow(ul, ur);
    const bottom = bow(ll, lr);
    const base: Face = { ...f, cylinder: false, bulge, grid: [[ul, ur], [ll, lr]], cells: [[flatCell()]] };
    const straight = straightTangents(base, 0, 0);
    return {
        ...base,
        cells: [[{
            curved: true,
            edges: [true, false, true, false],
            t: [
                top[0], top[1],
                straight[2], straight[3],
                bottom[0], bottom[1],
                straight[6], straight[7],
            ] as Pt[],
        }]],
    };
}

function retangent(f: Face): Face {
    return {
        ...f,
        cells: f.cells.map((row, r) => row.map((sg, c) =>
            (sg.curved && sg.t.length < 8 ? { ...sg, t: straightTangents(f, r, c) } : sg))),
    };
}

const flatCell = (): Segment => ({ curved: false, t: [], edges: [false, false, false, false] });

/** The edge a highlighted side means for a cell. Null means every edge, which
 *  is the sensible reading of "curve this" with nothing highlighted. */
function sideEdge(side: Side | null): Edge | null {
    if (side === "top") return 0;
    if (side === "right") return 1;
    if (side === "bottom") return 2;
    if (side === "left") return 3;
    return null;
}

/**
 * Bends one edge of one cell, or all four when no side is highlighted.
 *
 * PER EDGE, because which sides of a screen are curved is not knowable in
 * advance: a ribbon wrapping a corner bends on the verticals, a bowed facade
 * on the horizontals, a dome on all four. Turning an edge off leaves its
 * tangents alone so it can be turned back on unchanged.
 */
function curveEdge(f: Face, r: number, c: number, edge: Edge | null): Face {
    const cells = f.cells.map((row, ri) => row.map((sg, ci) => {
        if (ri !== r || ci !== c) return sg;
        const edges = (sg.edges || [false, false, false, false]).slice();
        if (edge === null) {
            const anyOn = edges[0] || edges[1] || edges[2] || edges[3];
            for (let i = 0; i < 4; i++) edges[i] = !anyOn;
        } else {
            edges[edge] = !edges[edge];
        }
        const curved = edges[0] || edges[1] || edges[2] || edges[3];
        return { curved, edges, t: sg.t };
    }));
    return retangent({ ...f, cells });
}

function newFace(id: number, w: number, h: number, name: string): Face {
    const x = w * 0.3;
    const y = h * 0.3;
    const cw = w * 0.4;
    const ch = h * 0.4;
    return {
        id, name,
        grid: [[[x, y], [x + cw, y]], [[x, y + ch], [x + cw, y + ch]]],
        cells: [[flatCell()]],
        sourceId: 0, sourceName: "", masterPath: "",
        wrapDeg: 0, bulge: 0.14,
        cylinder: false, cylinderRadius: 100, cylinderRotation: 0, cylinderWrap: 180,
        outline: [],
        opacity: 100, blend: "normal",
    };
}

/** A column inserted after `c`, i.e. every row gains a point. Splitting one
 *  row's edge and leaving the others behind would tear the mesh. */
function addColumn(f: Face, c: number): Face {
    const grid = f.grid.map((row) => {
        const next = row.slice();
        next.splice(c + 1, 0, lerp(row[c], row[c + 1], 0.5));
        return next;
    });
    const cells = f.cells.map((row) => {
        const next = row.slice();
        const was = row[c] || flatCell();
        next.splice(c, 1, { ...was, t: [] }, { ...was, t: [] });
        return next;
    });
    return retangent(fixCells({ ...f, grid, cells }));
}

/** A row inserted after `r`. */
function addRow(f: Face, r: number): Face {
    const grid = f.grid.slice();
    const mid = f.grid[r].map((p, i) => lerp(p, f.grid[r + 1][i], 0.5));
    grid.splice(r + 1, 0, mid);
    const cells = f.cells.slice();
    const wasRow = f.cells[r] || [];
    const copy = () => wasRow.map((sg) => ({ ...sg, t: [] as Pt[] }));
    cells.splice(r, 1, copy(), copy());
    return retangent(fixCells({ ...f, grid, cells }));
}

function removeColumn(f: Face, c: number): Face {
    if (cols(f) <= 2 || c <= 0 || c >= cols(f) - 1) return f;
    const grid = f.grid.map((row) => row.filter((_, i) => i !== c));
    const cells = f.cells.map((row) => row.filter((_, i) => i !== c));
    return retangent(fixCells({ ...f, grid, cells }));
}

function removeRow(f: Face, r: number): Face {
    if (rows(f) <= 2 || r <= 0 || r >= rows(f) - 1) return f;
    const grid = f.grid.filter((_, i) => i !== r);
    const cells = f.cells.filter((_, i) => i !== r);
    return retangent(fixCells({ ...f, grid, cells }));
}

/**
 * Curves every cell through the points ALREADY PLACED, adding none.
 *
 * The first version subdivided instead, which turned four handles into
 * thirty-two and was unusable. Tangents come from the neighbouring columns, a
 * Catmull-Rom tangent scaled to a third of the span, so joins stay smooth
 * across a whole wall.
 */
function smoothed(f: Face): Face {
    const nc = cols(f);
    const cells = f.cells.map((row, r) => row.map((_, c) => {
        const at = (i: number) => f.grid[r][Math.max(0, Math.min(nc - 1, i))];
        const bt = (i: number) => f.grid[r + 1][Math.max(0, Math.min(nc - 1, i))];
        const p0 = at(c - 1);
        const p1 = at(c);
        const p2 = at(c + 1);
        const p3 = at(c + 2);
        const q0 = bt(c - 1);
        const q1 = bt(c);
        const q2 = bt(c + 1);
        const q3 = bt(c + 2);
        const straight = straightTangents(f, r, c);
        return {
            curved: true,
            edges: [true, false, true, false],
            t: [
                [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
                [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
                straight[2], straight[3],
                [q1[0] + (q2[0] - q0[0]) / 6, q1[1] + (q2[1] - q0[1]) / 6],
                [q2[0] - (q3[0] - q1[0]) / 6, q2[1] - (q3[1] - q1[1]) / 6],
                straight[6], straight[7],
            ] as Pt[],
        };
    }));
    return { ...f, cells };
}

/**
 * The columns laid on an arc between the two ends, every row bowing with them.
 *
 * Placing eight columns by hand around a curved screen is slow and slightly
 * wrong every time; the shape is known, so it is generated and then nudged.
 * The bow is parabolic rather than a true circular arc, within a pixel at
 * these sagittas and with no centre to find.
 */
function arced(f: Face, bulge: number, count: number): Face {
    const k = cols(f) - 1;
    const a = f.grid[0][0];
    const b = f.grid[0][k];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const sag = len * bulge;

    const grid: Pt[][] = f.grid.map((row) => {
        const first = row[0];
        const last = row[row.length - 1];
        const out: Pt[] = [];
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            const bow = 4 * t * (1 - t) * sag;
            out.push([
                first[0] + (last[0] - first[0]) * t + nx * bow,
                first[1] + (last[1] - first[1]) * t + ny * bow,
            ]);
        }
        return out;
    });
    return retangent(fixCells({ ...f, grid, bulge }));
}

/** One cell's outline: a cubic for every bent edge, a line for the rest. */
function cellPath(f: Face, r: number, c: number): string {
    const [ul, ur, lr, ll] = cellCorners(f, r, c);
    const sg = f.cells[r] ? f.cells[r][c] : null;
    const p = (v: number[]) => `${v[0]},${v[1]}`;
    if (!sg || !sg.curved || sg.t.length < 8) {
        return `M ${p(ul)} L ${p(ur)} L ${p(lr)} L ${p(ll)} Z`;
    }
    const t = sg.t;
    const on = sg.edges || [];
    // The bottom and left tangents are stored left-to-right and bottom-to-top,
    // so they run backwards relative to the path's direction here.
    const top = on[0] ? `C ${p(t[0])} ${p(t[1])} ${p(ur)}` : `L ${p(ur)}`;
    const right = on[1] ? `C ${p(t[2])} ${p(t[3])} ${p(lr)}` : `L ${p(lr)}`;
    const bottom = on[2] ? `C ${p(t[5])} ${p(t[4])} ${p(ll)}` : `L ${p(ll)}`;
    const left = on[3] ? `C ${p(t[7])} ${p(t[6])} ${p(ul)}` : `L ${p(ul)}`;
    return `M ${p(ul)} ${top} ${right} ${bottom} ${left} Z`;
}

/** A point on a cubic. */
function onCubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
    const m = 1 - t;
    return [
        m * m * m * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * b[0],
        m * m * m * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * b[1],
    ];
}

/**
 * A cell sampled as a surface, for the preview.
 *
 * A Coons patch: the four boundary curves define the inside, which is exactly
 * what Bezier Warp does. Sampling it means the preview shows a cell bent on
 * ANY of its edges rather than only the horizontal ones.
 */
function cellSurface(f: Face, r: number, c: number, n: number): Pt[][] {
    const [ul, ur, lr, ll] = cellCorners(f, r, c);
    const sg = f.cells[r] ? f.cells[r][c] : null;
    const t = sg && sg.t.length >= 8 ? sg.t : straightTangents(f, r, c);
    const on = sg && sg.curved ? (sg.edges || []) : [];

    const top = (u: number) => (on[0] ? onCubic(ul, t[0], t[1], ur, u) : lerp(ul, ur, u));
    const bottom = (u: number) => (on[2] ? onCubic(ll, t[4], t[5], lr, u) : lerp(ll, lr, u));
    const left = (v: number) => (on[3] ? onCubic(ul, t[7], t[6], ll, v) : lerp(ul, ll, v));
    const right = (v: number) => (on[1] ? onCubic(ur, t[2], t[3], lr, v) : lerp(ur, lr, v));

    const out: Pt[][] = [];
    for (let i = 0; i <= n; i++) {
        const v = i / n;
        const row: Pt[] = [];
        for (let j = 0; j <= n; j++) {
            const u = j / n;
            const tp = top(u);
            const bt = bottom(u);
            const lf = left(v);
            const rt = right(v);
            // Two ruled surfaces minus the bilinear corner term.
            row.push([
                (1 - v) * tp[0] + v * bt[0] + (1 - u) * lf[0] + u * rt[0]
                - ((1 - u) * (1 - v) * ul[0] + u * (1 - v) * ur[0] + (1 - u) * v * ll[0] + u * v * lr[0]),
                (1 - v) * tp[1] + v * bt[1] + (1 - u) * lf[1] + u * rt[1]
                - ((1 - u) * (1 - v) * ul[1] + u * (1 - v) * ur[1] + (1 - u) * v * ll[1] + u * v * lr[1]),
            ]);
        }
        out.push(row);
    }
    return out;
}

/**
 * The CSS transform that maps a `sw` x `sh` box onto an arbitrary quad.
 *
 * A corner-pinned screen is a projective map, and CSS does exactly that with
 * matrix3d, so the panel can show the artwork warped into the real shape
 * rather than an outline to imagine through. Heckbert's closed form for the
 * unit square, pre-scaled by the box size.
 *
 * Ordering is UL, UR, LR, LL, and it matters: swapping two corners gives a
 * mirrored map that looks almost right.
 */
function quadTransform(ul: Pt, ur: Pt, lr: Pt, ll: Pt, sw: number, sh: number): string {
    const x0 = ul[0], y0 = ul[1];
    const x1 = ur[0], y1 = ur[1];
    const x2 = lr[0], y2 = lr[1];
    const x3 = ll[0], y3 = ll[1];

    const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;

    let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
        a = x1 - x0; b = x2 - x1; c = x0;
        d = y1 - y0; e = y2 - y1; f = y0;
        g = 0; h = 0;
    } else if (Math.abs(den) < 1e-9) {
        return "none";
    } else {
        g = (sx * dy2 - dx2 * sy) / den;
        h = (dx1 * sy - sx * dy1) / den;
        a = x1 - x0 + g * x1;
        b = x3 - x0 + h * x3;
        c = x0;
        d = y1 - y0 + g * y1;
        e = y3 - y0 + h * y3;
        f = y0;
    }
    const w = sw || 1;
    const t = sh || 1;
    return `matrix3d(${a / w}, ${d / w}, 0, ${g / w}, ${b / t}, ${e / t}, 0, ${h / t}, 0, 0, 1, 0, ${c}, ${f}, 0, 1)`;
}

/** Where each division sits along an edge, 0..1. Mirrors ribFractions in
 *  src/jsx/aeft/insitu.ts -- the preview has to slice the artwork the same way
 *  the build will, or it is a picture of a different thing. */
function fractions(points: Pt[], wrapDeg: number): number[] {
    const out = [0];
    const runs: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const dd = Math.sqrt(dx * dx + dy * dy);
        runs.push(dd);
        total += dd;
    }
    if (total <= 0) {
        for (let i = 1; i < points.length; i++) out.push(i / (points.length - 1));
        return out;
    }
    let acc = 0;
    for (let i = 0; i < runs.length; i++) { acc += runs[i]; out.push(acc / total); }
    if (!(wrapDeg > 0) || wrapDeg >= 360) return out;
    const aa = (wrapDeg / 2) * Math.PI / 180;
    const sinA = Math.sin(aa);
    if (!(sinA > 0)) return out;
    return out.map((u) => {
        const sPos = Math.max(-1, Math.min(1, (u * 2 - 1) * sinA));
        return (Math.asin(sPos) + aa) / (2 * aa);
    });
}

/**
 * The grid the PREVIEW paints, which is not always the grid that is stored.
 *
 * A Round face has four corners and an effect doing the wrapping, so drawing
 * it as one flat quad would show none of the wrap and leave "Round" looking
 * identical to "Flat" until Build. Here it is cut into nine columns whose
 * artwork is distributed by the same asin the drum has, which is close enough
 * to read at a glance.
 */
function previewGrid(f: Face): { grid: Pt[][]; us: number[]; vs: number[] } {
    // A single bowed cell builds as ONE Bezier Warp, but a flat quad cannot
    // draw a bend, so the preview samples the two cubics. Ten columns is
    // enough to read as a curve and they abut exactly, so there is no seam.
    // A single bent cell builds as ONE Bezier Warp, and a flat quad cannot draw
    // a bend, so the preview samples the patch its four edges describe. Eight
    // by eight reads as a curve and the pieces abut exactly, so there is no
    // seam to see.
    const only = f.cells[0] && f.cells[0].length === 1 && f.grid.length === 2 && f.cells[0][0];
    if (!f.cylinder && only && only.curved && only.t.length >= 8) {
        const n = 8;
        const surface = cellSurface(f, 0, 0, n);
        const us: number[] = [];
        const vs: number[] = [];
        for (let i = 0; i <= n; i++) { us.push(i / n); vs.push(i / n); }
        return { grid: surface, us, vs };
    }
    if (!f.cylinder) {
        return {
            grid: f.grid,
            us: fractions(f.grid[0], f.wrapDeg),
            vs: fractions(f.grid.map((row) => row[0]), 0),
        };
    }
    const n = 9;
    const ul = corner(f, "ul");
    const ur = corner(f, "ur");
    const ll = corner(f, "ll");
    const lr = corner(f, "lr");
    const top: Pt[] = [];
    const bot: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        top.push(lerp(ul, ur, t));
        bot.push(lerp(ll, lr, t));
    }
    // Radius decides how much of the drum is turned towards the camera.
    const wrap = Math.max(20, Math.min(180, f.cylinderWrap || 180));
    const a = (wrap / 2) * Math.PI / 180;
    const sinA = Math.sin(a);
    const us: number[] = [];
    for (let i = 0; i < n; i++) {
        const p = i / (n - 1);
        const sPos = Math.max(-1, Math.min(1, (p * 2 - 1) * sinA));
        us.push((Math.asin(sPos) + a) / (2 * a));
    }
    return { grid: [top, bot], us, vs: [0, 1] };
}

/**
 * The nearest thing worth landing on, or null.
 *
 * TWO FACES THAT MEET SHOULD MEET EXACTLY. A corner unit is two faces sharing
 * an edge, and getting a zero-pixel join by eye at 100% zoom is impossible --
 * the seam shows as a bright line of plate between them. Corners of other
 * faces win over edges, because sharing a corner is the stronger intent.
 */
function snapTarget(faces: Face[], selfIdx: number, p: Pt, tol: number,
                   plateW?: number, plateH?: number): Pt | null {
    let best: Pt | null = null;
    let bestD = tol;

    const consider = (q: Pt) => {
        const d = Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
        if (d < bestD) { bestD = d; best = [q[0], q[1]]; }
    };

    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        for (let r = 0; r < f.grid.length; r++) {
            for (let c = 0; c < f.grid[r].length; c++) {
                // Skip the point being dragged; snapping to itself pins it.
                if (i === selfIdx && Math.abs(f.grid[r][c][0] - p[0]) < 0.01
                    && Math.abs(f.grid[r][c][1] - p[1]) < 0.01) continue;
                consider(f.grid[r][c]);
            }
        }
    }
    if (best) return best;

    // Nothing to share a corner with, so try landing ON an edge.
    for (let i = 0; i < faces.length; i++) {
        if (i === selfIdx) continue;
        const f = faces[i];
        const edges: [Pt, Pt][] = [];
        for (let r = 0; r < f.grid.length; r++) {
            for (let c = 0; c < f.grid[r].length - 1; c++) edges.push([f.grid[r][c], f.grid[r][c + 1]]);
        }
        for (let r = 0; r < f.grid.length - 1; r++) {
            for (let c = 0; c < f.grid[r].length; c++) edges.push([f.grid[r][c], f.grid[r + 1][c]]);
        }
        for (let e = 0; e < edges.length; e++) {
            const a = edges[e][0];
            const b = edges[e][1];
            const vx = b[0] - a[0];
            const vy = b[1] - a[1];
            const len2 = vx * vx + vy * vy;
            if (len2 <= 0) continue;
            let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2;
            t = Math.max(0, Math.min(1, t));
            consider([a[0] + vx * t, a[1] + vy * t]);
        }
    }
    if (best) return best;

    // THE PLATE'S OWN EDGES, one axis at a time.
    //
    // A screen that runs off the top of the photograph should sit ON the top of
    // it, not two pixels over or under, and that is a job for the boundary
    // rather than for another face. Per axis on purpose: a corner pulled to the
    // left edge keeps whatever height it was dragged to, so this can be used to
    // fit a face to the plate's height without it also jumping sideways.
    if (!(plateW && plateH)) return null;
    let x = p[0];
    let y = p[1];
    let pulled = false;
    if (Math.abs(x) < tol) { x = 0; pulled = true; }
    else if (Math.abs(x - plateW) < tol) { x = plateW; pulled = true; }
    if (Math.abs(y) < tol) { y = 0; pulled = true; }
    else if (Math.abs(y - plateH) < tol) { y = plateH; pulled = true; }
    return pulled ? [x, y] : null;
}

/** The four outer sides, as polylines to click on. */
function sidePoints(f: Face, side: Side): Pt[] {
    const r = rows(f) - 1;
    const k = cols(f) - 1;
    if (side === "top") return f.grid[0];
    if (side === "bottom") return f.grid[r];
    if (side === "left") return f.grid.map((row) => row[0]);
    return f.grid.map((row) => row[k]);
}

const InsituBoard: React.FC<Props> = ({
    masters, suggestions = [], defaultName = "", templates = [], onReloadTemplates, onBack,
}) => {
    const [backdrop, setBackdrop] = useState("");
    const [plate, setPlate] = useState<{ w: number; h: number; still: boolean } | null>(null);
    const [faces, setFaces] = useState<Face[]>([]);
    const [sel, setSel] = useState(0);
    // WHAT IS BEING EDITED INSIDE THE FACE. A cell for curvature, a side for
    // where the next point goes. Selecting a side is the answer to "+ Point
    // only ever splits the horizontal edges": the side says which axis.
    const [selCell, setSelCell] = useState<[number, number]>([0, 0]);
    const [selSide, setSelSide] = useState<Side | null>(null);
    // The grid point last touched, so the arrow keys and the number fields
    // have something to act on. Dragging cannot land on an exact pixel: at fit
    // zoom one screen pixel is several plate pixels, so the last step of any
    // precise placement has to be typed or nudged, never dragged.
    const [selPoint, setSelPoint] = useState<[number, number] | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [compName, setCompName] = useState(defaultName ? `${defaultName}_INSITU` : "INSITU");
    const [secs, setSecs] = useState("10");

    const stageRef = useRef<HTMLDivElement | null>(null);
    const loupeRef = useRef<HTMLDivElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    // Measured, because the preview transform is in plate pixels and has to be
    // scaled onto however wide the panel happens to be.
    const [stageW, setStageW] = useState(0);
    const [loupeW, setLoupeW] = useState(0);
    // A screen wedged between a tree and a cornice is a hundred pixels wide at
    // fit-to-panel, and that is exactly when the corners have to land exactly.
    const [zoom, setZoom] = useState(1);
    // Where the pointer is over the plate, 0..1, for the loupe to centre on.
    const [look, setLook] = useState<{ x: number; y: number } | null>(null);
    const [loupe, setLoupe] = useState(true);
    const [snap, setSnap] = useState(true);
    // POINTS FIRST. Trace the screen on the plate, then fit a face inside what
    // was traced -- which is the order the work actually happens in, rather
    // than dropping a rectangle in the middle and hauling its corners out.
    // BOARD HISTORY, so Cmd+Z means "undo what I just did on the board".
    //
    // Nothing done here touches AE until Build, so AE's own undo stack still
    // has the LAST BUILD at the top of it however long you have been dragging
    // handles -- press Cmd+Z after an hour of tracing and AE dutifully removes
    // the comp, because that genuinely was the last thing anyone asked it to
    // do. The panel keeps its own history and claims the key while the board
    // has focus, so the shortcut lands where the work happened.
    const history = useRef<Face[][]>([]);
    const [marking, setMarking] = useState(false);
    const [marks, setMarks] = useState<Pt[]>([]);
    const [markRow, setMarkRow] = useState<Pt[] | null>(null);   // the finished top edge
    const LOUPE = 4;
    /** Kept in step with .ins-loupe's height in InsituBoard.scss. */
    const LOUPE_H = 190;
    const dragRef = useRef<{ face: number; handle: string; sx: number; sy: number; box: DOMRect; start: Face } | null>(null);

    const face = faces[sel] || null;
    const cell = face && face.cells[selCell[0]] ? face.cells[selCell[0]][selCell[1]] : null;

    const [handOpen, setHandOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    // Which library entry this board came from, so saving updates that screen
    // rather than making a second card for it.
    const [screen, setScreen] = useState<ScreenEntry | null>(null);
    // One rendered PNG per source item, so a face can be painted on the canvas
    // instead of outlined. Keyed by item id: two faces often carry the same
    // artwork and should not render it twice.
    const [thumbs, setThumbs] = useState<Record<number, { path: string; w: number; h: number }>>({});

    const say = (text: string, type: "success" | "error") => setStatus({ text, type });

    /** Called BEFORE a change, with the state that is about to be replaced. */
    const remember = (was: Face[]) => {
        history.current.push(JSON.parse(JSON.stringify(was)) as Face[]);
        if (history.current.length > 60) history.current.shift();
    };

    /** One plate pixel, ten with Shift. Not acceleration: these are traced
     *  against a photograph, so the move that matters is "off by one". */
    const nudge = (dx: number, dy: number) => {
        if (!face || !selPoint) return;
        const [r, c] = selPoint;
        edit((f) => {
            const grid = f.grid.map((row) => row.slice());
            const was = grid[r][c];
            grid[r][c] = [was[0] + dx, was[1] + dy];
            return { ...f, grid };
        });
    };

    const setPointAt = (axis: 0 | 1, value: number) => {
        if (!face || !selPoint) return;
        const [r, c] = selPoint;
        edit((f) => {
            const grid = f.grid.map((row) => row.slice());
            const was = grid[r][c];
            grid[r][c] = axis === 0 ? [value, was[1]] : [was[0], value];
            return { ...f, grid };
        });
    };

    const undo = () => {
        const was = history.current.pop();
        if (!was) { say("Nothing left to undo on the board.", "error"); return; }
        setFaces(was);
        setSel((n) => Math.min(n, Math.max(0, was.length - 1)));
        setSelCell([0, 0]);
    };

    /** Which of the three shapes a face is in. Derived rather than stored, so
     *  a face edited by hand still reads as what it actually is. */
    const shapeOf = (f: Face): string => {
        if (f.cylinder) return "cylinder";
        if (cols(f) > 2 || rows(f) > 2) return "curved";
        if (f.cells[0] && f.cells[0][0] && f.cells[0][0].curved) return "curved";
        return "flat";
    };

    /**
     * The whole shape decision, in one place.
     *
     * Flat is the four corners. Curved lays nine columns on an arc and curves
     * them, which is the wall this tool exists for. Round hands it to CC
     * Cylinder. Each keeps the corners where they are, so switching between
     * them never loses the placement.
     */
    const setShape = (kind: string) => {
        if (!face) return;
        if (kind === "cylinder") { patch({ cylinder: true }); return; }
        const flatten = (f: Face): Face => fixCells({
            ...f, cylinder: false,
            grid: [[corner(f, "ul"), corner(f, "ur")], [corner(f, "ll"), corner(f, "lr")]],
            cells: [[flatCell()]],
        });
        if (kind === "flat") {
            edit((f) => retangent({ ...flatten(f), wrapDeg: 0 }));
        } else {
            edit((f) => bowedCell(f, f.bulge || 0.14));
        }
        setSelCell([0, 0]);
        setSelSide(null);
    };
    const patch = (changes: Partial<Face>) => setFaces((prev) => {
        remember(prev);
        return prev.map((f, i) => (i === sel ? { ...f, ...changes } : f));
    });
    const edit = (fn: (f: Face) => Face) => setFaces((prev) => {
        remember(prev);
        return prev.map((f, i) => (i === sel ? fn(f) : f));
    });

    const loadBackdrop = async (path: string) => {
        setBusy(true);
        try {
            const r = (await evalTS("insituBackdropInfo", path)) as unknown as
                { success: boolean; error?: string; width?: number; height?: number; isStill?: boolean } | undefined;
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { say(r.error || "Couldn't read that file.", "error"); return; }
            setBackdrop(path);
            setPlate({ w: r.width || 1920, h: r.height || 1080, still: !!r.isStill });
            if (faces.length === 0) setFaces([newFace(1, r.width || 1920, r.height || 1080, "Face 1")]);
            setStatus(null);
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
        } finally {
            setBusy(false);
        }
    };

    const readSelection = async (): Promise<ProjectPick[]> => {
        try {
            const r = (await evalTS("insituProjectSelection")) as unknown as
                { success: boolean; error?: string; items?: ProjectPick[] } | undefined;
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { say(r.error || "Couldn't read the project panel.", "error"); return []; }
            return r.items || [];
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
            return [];
        }
    };

    const backdropFromProject = async () => {
        const items = await readSelection();
        const withFile = items.filter((i) => i.path);
        if (withFile.length === 0) {
            say("Select the plate in the project panel first — a still or a movie, not a comp.", "error");
            return;
        }
        await loadBackdrop(withFile[0].path);
    };

    const loadThumb = async (id: number) => {
        if (!id || thumbs[id]) return;
        try {
            const r = (await evalTS("insituSourceThumb", id)) as unknown as
                { success: boolean; path?: string; width?: number; height?: number } | undefined;
            if (r && r.success && r.path) {
                setThumbs((prev) => ({ ...prev, [id]: { path: r.path as string, w: r.width || 1, h: r.height || 1 } }));
            }
        } catch { /* no bridge; the outline still works */ }
    };

    const faceFromProject = async () => {
        const items = await readSelection();
        if (items.length === 0) { say("Nothing selected in the project panel.", "error"); return; }
        const it = items[0];
        patch({ sourceId: it.id, sourceName: it.name, masterPath: "" });
        loadThumb(it.id);
        say(`${it.name} on ${face?.name || "this face"}.`, "success");
    };

    const pick = async () => {
        try {
            const p = (await evalTS("insituPickBackdrop")) as unknown as string | null | undefined;
            if (p === undefined) throw new Error("no bridge");
            if (!p) return;
            await loadBackdrop(p);
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
        }
    };

    // --- dragging ---------------------------------------------------------
    // Mouse events, not pointer events: the macOS AE CEP host doesn't dispatch
    // Pointer Events reliably. Standing rule in CLAUDE.md.
    useEffect(() => {
        const move = (e: MouseEvent) => {
            // THE LOUPE FOLLOWS THE POINTER, INCLUDING MID-DRAG. Tracking this
            // on the stage element alone meant it stopped updating the moment
            // a drag left the stage's box or ran over a handle, so the one
            // time it mattered -- landing a corner -- it was showing where the
            // pointer used to be.
            const box = stageRef.current?.getBoundingClientRect();
            if (box && box.width > 0) {
                const nx = (e.clientX - box.left) / box.width;
                const ny = (e.clientY - box.top) / box.height;
                if (nx >= -0.2 && nx <= 1.2 && ny >= -0.2 && ny <= 1.2) {
                    setLook({
                        x: Math.max(0, Math.min(1, nx)),
                        y: Math.max(0, Math.min(1, ny)),
                    });
                }
            }
            const d = dragRef.current;
            if (!d || !plate) return;
            const dx = ((e.clientX - d.sx) / d.box.width) * plate.w;
            const dy = ((e.clientY - d.sy) / d.box.height) * plate.h;

            setFaces((prev) => prev.map((f, i) => {
                if (i !== d.face) return f;
                const h = d.handle;

                if (h === "all") {
                    return {
                        ...f,
                        grid: d.start.grid.map((row) => row.map((p) => [p[0] + dx, p[1] + dy] as Pt)),
                        cells: d.start.cells.map((row) => row.map((sg) => ({
                            ...sg,
                            t: sg.t.map((t) => [t[0] + dx, t[1] + dy] as Pt),
                        }))),
                    };
                }

                // "pt:<row>:<col>"
                if (h.indexOf("pt:") === 0) {
                    const bits = h.split(":");
                    const r = Number(bits[1]);
                    const c = Number(bits[2]);
                    const grid = d.start.grid.map((row) => row.slice());
                    const was = d.start.grid[r][c];
                    let to: Pt = [was[0] + dx, was[1] + dy];
                    if (snap && plate) {
                        // A constant distance ON SCREEN, so the pull feels the
                        // same zoomed in as zoomed out.
                        const tol = 9 * (stageW > 0 ? plate.w / stageW : 1);
                        const hit = snapTarget(prev, d.face, to, tol, plate.w, plate.h);
                        if (hit) to = hit;
                    }
                    grid[r][c] = to;
                    return { ...f, grid };
                }

                // "tan:<row>:<col>:<0..3>"
                if (h.indexOf("tan:") === 0) {
                    const bits = h.split(":");
                    const r = Number(bits[1]);
                    const c = Number(bits[2]);
                    const ti = Number(bits[3]);
                    const cells = d.start.cells.map((row) => row.map((sg) => ({
                        ...sg,
                        edges: (sg.edges || [false, false, false, false]).slice(),
                        t: (sg.t.length >= 8 ? sg.t.slice() : straightTangents(d.start, r, c)) as Pt[],
                    })));
                    const from = d.start.cells[r][c].t.length >= 8
                        ? d.start.cells[r][c].t
                        : straightTangents(d.start, r, c);
                    cells[r][c].t[ti] = [from[ti][0] + dx, from[ti][1] + dy];
                    // Moving a handle IS the request to bend that side.
                    cells[r][c].edges[Math.floor(ti / 2)] = true;
                    cells[r][c].curved = true;
                    return { ...f, cells };
                }
                return f;
            }));
        };
        const up = () => { dragRef.current = null; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [plate]);

    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const measure = () => setStageW(el.getBoundingClientRect().width);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [plate]);

    // MEASURED ON THE BOX, NOT THE MAGNIFIED CONTENT. getBoundingClientRect
    // reports the TRANSFORMED rectangle, so measuring the scaled inner gave a
    // width four times too big -- and since the offset is proportional to how
    // far down the plate the pointer is, the loupe tracked correctly at the top
    // edge and ran away towards the bottom.
    useEffect(() => {
        const el = loupeRef.current;
        if (!el) { setLoupeW(0); return; }
        const measure = () => setLoupeW(el.getBoundingClientRect().width);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [plate, loupe, look !== null]);

    // AE binds Cmd+Z to its own undo, so the board claims the combo only while
    // it holds focus -- click the board to arm, click away to release. Same
    // contract Bespoke's nudge keys use, and for the same reason: a panel that
    // grabbed a shortcut permanently would break it for the rest of the
    // session.
    const keyGrabRef = useRef<HTMLInputElement>(null);
    const [armed, setArmed] = useState(false);

    const claim = () => {
        try {
            const keys: Array<Record<string, unknown>> = [
                { keyCode: 90, metaKey: true },
                { keyCode: 90, ctrlKey: true },
            ];
            // Arrows, plain and shifted. AE binds these to nudging the selected
            // LAYER, so they are claimed only while the board holds focus.
            const arrows = [37, 38, 39, 40];
            for (let i = 0; i < arrows.length; i++) {
                keys.push({ keyCode: arrows[i], shiftKey: false });
                keys.push({ keyCode: arrows[i], shiftKey: true });
            }
            csi.registerKeyEventsInterest(JSON.stringify(keys));
        } catch { /* no host in preview */ }
        setArmed(true);
        // preventScroll, ALWAYS. The catcher sits at the wrap's top left, and
        // focusing an element inside a scrollable box scrolls it into view --
        // so arming the keys snapped a zoomed-in board back to its corner every
        // time the pointer re-entered it or a button took focus away.
        if (keyGrabRef.current) {
            try {
                keyGrabRef.current.focus({ preventScroll: true });
            } catch {
                keyGrabRef.current.focus();
            }
        }
    };
    const release = () => {
        try { csi.registerKeyEventsInterest("[]"); } catch { /* nothing to release */ }
        setArmed(false);
    };
    // Never leave AE without its own undo if the tool unmounts while armed.
    useEffect(() => () => { try { csi.registerKeyEventsInterest("[]"); } catch { /* no host */ } }, []);

    /**
     * KEEPS THE CATCHER FOCUSED, which is what actually delivers the keys.
     *
     * Two things have to hold at once for a shortcut to reach the panel:
     * registerKeyEventsInterest tells the host to route it, and a FOCUSED
     * editable element is what macOS AE hands it to. Clicking any button in the
     * board takes focus off the catcher and satisfies only the first, so the
     * arrows went back to AE and moved the playhead or shifted panels instead.
     *
     * It stands down whenever something genuinely editable has focus, or the
     * caret would be pulled out of a field being typed in several times a
     * second (CLAUDE.md section 4).
     */
    useEffect(() => {
        if (!armed) return;
        const keepFocus = () => {
            const el = document.activeElement as HTMLElement | null;
            if (el && el !== keyGrabRef.current) {
                const tag = el.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return;
            }
            if (el === keyGrabRef.current) return;
            if (!keyGrabRef.current) return;
            try {
                keyGrabRef.current.focus({ preventScroll: true });
            } catch {
                keyGrabRef.current.focus();
            }
        };
        const timer = window.setInterval(keepFocus, 400);
        return () => window.clearInterval(timer);
    }, [armed]);

    useEffect(() => {
        if (!armed) return;
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement as HTMLElement | null;
            // Never steal a key from a field somebody is typing in.
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el !== keyGrabRef.current) return;

            if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                undo();
                return;
            }
            const step = e.shiftKey ? 10 : 1;
            if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-step, 0); }
            else if (e.key === "ArrowRight") { e.preventDefault(); nudge(step, 0); }
            else if (e.key === "ArrowUp") { e.preventDefault(); nudge(0, -step); }
            else if (e.key === "ArrowDown") { e.preventDefault(); nudge(0, step); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [armed, selPoint, face, sel]);

    /**
     * Wheel to zoom, ABOUT THE POINTER.
     *
     * Zooming about the centre and then hunting for the spot again is the thing
     * that makes a canvas tiring, so the content under the cursor is pinned:
     * whatever you were looking at stays where it is and everything grows
     * around it. A native listener because React's wheel handler is passive and
     * cannot stop the panel from scrolling instead.
     */
    useEffect(() => {
        const el = wrapRef.current;
        if (!el || !plate) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const box = el.getBoundingClientRect();
            const px = e.clientX - box.left + el.scrollLeft;
            const py = e.clientY - box.top + el.scrollTop;
            setZoom((z) => {
                const next = Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
                const k = next / z;
                // Applied after the browser has laid the bigger stage out.
                window.requestAnimationFrame(() => {
                    el.scrollLeft = px * k - (e.clientX - box.left);
                    el.scrollTop = py * k - (e.clientY - box.top);
                });
                return next;
            });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [plate]);

    /** Middle-drag, or Alt-drag, to move around while zoomed in. */
    useEffect(() => {
        const move = (e: MouseEvent) => {
            const pan = panRef.current;
            const el = wrapRef.current;
            if (!pan || !el) return;
            el.scrollLeft = pan.left - (e.clientX - pan.x);
            el.scrollTop = pan.top - (e.clientY - pan.y);
        };
        const up = () => { panRef.current = null; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, []);

    const beginPan = (e: React.MouseEvent): boolean => {
        const el = wrapRef.current;
        if (!el) return false;
        if (e.button !== 1 && !e.altKey) return false;
        e.preventDefault();
        e.stopPropagation();
        panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        return true;
    };

    const grab = (e: React.MouseEvent, i: number, handle: string) => {
        // Alt or the middle button means "move the view", never "move a point".
        if (beginPan(e)) return;
        const box = stageRef.current?.getBoundingClientRect();
        if (!box) return;
        e.preventDefault();
        e.stopPropagation();
        setSel(i);
        if (handle.indexOf("pt:") === 0) {
            const bits = handle.split(":");
            setSelPoint([Number(bits[1]), Number(bits[2])]);
        }
        // One drag is one undo step, recorded at the start rather than on
        // every mousemove.
        remember(faces);
        dragRef.current = { face: i, handle, sx: e.clientX, sy: e.clientY, box, start: faces[i] };
    };

    // --- faces ------------------------------------------------------------
    const addFace = () => {
        if (!plate) return;
        const id = faces.reduce((m, f) => Math.max(m, f.id), 0) + 1;
        setFaces((prev) => prev.concat([newFace(id, plate.w, plate.h, `Face ${id}`)]));
        setSel(faces.length);
        setSelCell([0, 0]);
    };

    const duplicateFace = () => {
        if (!face) return;
        const id = faces.reduce((m, f) => Math.max(m, f.id), 0) + 1;
        const off = 40;
        setFaces((prev) => prev.concat([{
            ...face, id, name: `Face ${id}`,
            grid: face.grid.map((row) => row.map((p) => [p[0] + off, p[1] + off] as Pt)),
            cells: face.cells.map((row) => row.map((sg) => ({
                ...sg, t: sg.t.map((t) => [t[0] + off, t[1] + off] as Pt),
            }))),
        }]));
        setSel(faces.length);
    };

    const resetFace = () => {
        if (!face || !plate) return;
        edit((f) => ({
            ...newFace(f.id, plate.w, plate.h, f.name),
            sourceId: f.sourceId, sourceName: f.sourceName, masterPath: f.masterPath,
            opacity: f.opacity, blend: f.blend,
        }));
        setSelCell([0, 0]);
        setSelSide(null);
    };

    const removeFace = (i: number) => {
        setFaces((prev) => prev.filter((_, n) => n !== i));
        setSel((s) => (s >= i && s > 0 ? s - 1 : s));
        setSelCell([0, 0]);
    };

    /**
     * WHERE THE NEXT POINT GOES.
     *
     * With a side highlighted it splits that side's axis -- top or bottom adds
     * a column, left or right adds a row. With nothing highlighted it adds one
     * of each, which is the "all sides at once" case and what a corner unit
     * usually wants.
     */
    const addPoint = () => {
        if (!face) return;
        const [r, c] = selCell;
        if (selSide === "top" || selSide === "bottom") { edit((f) => addColumn(f, c)); return; }
        if (selSide === "left" || selSide === "right") { edit((f) => addRow(f, r)); return; }
        edit((f) => addRow(addColumn(f, c), r));
    };

    /**
     * What the traced points become.
     *
     * FOUR POINTS ARE A FACE, clicked in the order the corners are named. More
     * than four means an edge with steps or a curve in it, so the top is
     * traced first, then the bottom, and every pair becomes a column -- which
     * is exactly the grid the rest of the tool already works in.
     *
     * An odd count is REFUSED rather than guessed at: inventing the missing
     * bottom point puts a face somewhere nobody asked for, and the fix is one
     * more click.
     */
    const faceFromMarks = () => {
        if (!plate) return;
        if (marks.length < 4) { say("Four points at least: the corners, clockwise from the top left.", "error"); return; }

        let top: Pt[];
        let bottom: Pt[];
        if (markRow) {
            if (marks.length !== markRow.length) {
                say(`The top has ${markRow.length} points and the bottom has ${marks.length}. They have to match.`, "error");
                return;
            }
            top = markRow;
            bottom = marks;
        } else if (marks.length === 4) {
            // Clockwise from the top left.
            top = [marks[0], marks[1]];
            bottom = [marks[3], marks[2]];
        } else {
            say("More than four points? Trace the top edge, press Top done, then trace the bottom.", "error");
            return;
        }

        const id = faces.reduce((m, f) => Math.max(m, f.id), 0) + 1;
        const base = newFace(id, plate.w, plate.h, `Face ${id}`);
        const made = fixCells({ ...base, grid: [top, bottom] });
        setFaces((prev) => prev.concat([made]));
        setSel(faces.length);
        setSelCell([0, 0]);
        setMarks([]);
        setMarkRow(null);
        setMarking(false);
        say(`Face from ${top.length} points across.`, "success");
    };

    /**
     * Loads a screen from the library.
     *
     * An entry with an in-situ on it restores the whole board -- backdrop,
     * faces, curves. One without still helps: its reference image is the
     * plate, which is the hunt an artist would otherwise be doing by hand.
     */
    const loadScreen = async (e: ScreenEntry) => {
        setScreen(e);
        setLibraryOpen(false);
        if (e.insitu && e.insitu.faces) {
            try {
                const parsed = JSON.parse(e.insitu.faces) as Face[];
                if (e.insitu.compName) setCompName(e.insitu.compName);
                if (e.insitu.backdrop) await loadBackdrop(e.insitu.backdrop);
                setFaces(parsed.map((f) => fixCells(f)));
                setSel(0);
                setSelCell([0, 0]);
                parsed.forEach((f) => { if (f.sourceId) loadThumb(f.sourceId); });
                say(`Loaded the in-situ saved for ${e.name}.`, "success");
                return;
            } catch {
                say("That screen's in-situ wouldn't read. Its reference is loaded instead.", "error");
            }
        }
        const ref = e.referencePath || (e.referencePaths || [])[0] || "";
        if (!ref) { say(`${e.name} has no reference image to use as a plate.`, "error"); return; }
        setCompName(`${e.name}_INSITU`);
        await loadBackdrop(ref);
        say(`${e.name}'s reference loaded. Place the faces and save it back.`, "success");
    };

    /**
     * Saves this in-situ ONTO THE SCREEN'S OWN CARD.
     *
     * Not a separate library: the regions a Bespoke build uses and the faces
     * an in-situ places are two views of one physical screen, and keeping them
     * on one entry is what stops the two drifting apart.
     */
    const saveLayout = async () => {
        if (!plate) { say("Nothing to save yet.", "error"); return; }
        const now = new Date();
        const stamp = now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0");
        const base: any = screen ? { ...screen } : {
            id: `insitu-${Date.now()}`,
            name: compName.replace(/_INSITU$/, "") || "Insitu",
            territory: "", site: "",
            canvasW: plate.w, canvasH: plate.h,
            guidesX: [], guidesY: [], slots: [],
            savedBy: "", stamp,
            kind: "layout",
        };
        base.insitu = {
            backdrop,
            faces: JSON.stringify(faces),
            compName,
            stamp,
        };
        setBusy(true);
        try {
            const r = (await evalTS("bespokeTemplateSave", JSON.stringify(base))) as unknown as
                { success: boolean; error?: string } | undefined;
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { say(r.error || "Couldn't save that.", "error"); return; }
            setScreen(base as ScreenEntry);
            if (onReloadTemplates) onReloadTemplates();
            say(`Saved onto ${base.name} in the screen library.`, "success");
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
        } finally {
            setBusy(false);
        }
    };

    /**
     * Proposes a face for every shape it can find in the plate.
     *
     * Only ever an offer: the shapes land as ordinary faces with ordinary
     * handles, so a corner that came out two pixels wide of the mark is
     * nudged like any other.
     */
    const detect = async () => {
        if (!plate || !backdrop) return;
        setBusy(true);
        try {
            const found = await detectShapes(backdrop);
            if (found.shapes.length === 0) {
                say(`Nothing to propose — ${found.why || "no shapes found"}.`, "error");
                return;
            }
            let id = faces.reduce((m, f) => Math.max(m, f.id), 0);
            const made: Face[] = found.shapes.map((sh) => {
                id += 1;
                const base = newFace(id, plate.w, plate.h, `Face ${id}`);
                const [ul, ur, lr, ll] = sh.corners;
                // A SHAPE THAT ISN'T A QUAD KEEPS ITS OUTLINE. An arch, an
                // L-shaped facade or anything with a bite out of it builds as
                // a mask; a plain rectangle has nothing to gain from one.
                if (!sh.complex) {
                    return fixCells({ ...base, grid: [[ul, ur], [ll, lr]], outline: [] });
                }
                // A MASKED FACE IS PLACED TO ITS OUTLINE'S BOX, not to the four
                // extreme corners. The mask keeps everything inside the
                // outline, and an outline reaches past its own quad wherever it
                // curves -- a rounded cap sits above the corners it replaces --
                // so a quad-sized piece of artwork leaves the plate showing
                // through in exactly those places.
                let minX = sh.outline[0][0];
                let maxX = minX;
                let minY = sh.outline[0][1];
                let maxY = minY;
                for (let i = 1; i < sh.outline.length; i++) {
                    if (sh.outline[i][0] < minX) minX = sh.outline[i][0];
                    if (sh.outline[i][0] > maxX) maxX = sh.outline[i][0];
                    if (sh.outline[i][1] < minY) minY = sh.outline[i][1];
                    if (sh.outline[i][1] > maxY) maxY = sh.outline[i][1];
                }
                return fixCells({
                    ...base,
                    grid: [
                        [[minX, minY], [maxX, minY]],
                        [[minX, maxY], [maxX, maxY]],
                    ],
                    outline: sh.outline,
                });
            });
            remember(faces);
            setFaces((prev) => prev.concat(made));
            setSel(faces.length);
            setSelCell([0, 0]);
            const masked = made.filter((f) => f.outline.length > 0).length;
            say(`${made.length} shape${made.length === 1 ? "" : "s"} found` +
                (masked ? `, ${masked} kept as an outline mask` : "") +
                ". Check the corners, then give each one its artwork.", "success");
        } catch {
            say("Couldn't read that plate's pixels.", "error");
        } finally {
            setBusy(false);
        }
    };

    const build = async () => {
        if (!plate) { say("Pick a backdrop first.", "error"); return; }
        setBusy(true);
        try {
            const r = (await evalTS("insituBuild", JSON.stringify({
                backdrop,
                compName,
                width: plate.w,
                height: plate.h,
                duration: Number(secs) || 10,
                frameRate: 25,
                facesJson: JSON.stringify(faces.map((f) => ({
                    ul: corner(f, "ul"), ur: corner(f, "ur"), ll: corner(f, "ll"), lr: corner(f, "lr"),
                    grid: f.grid, cells: f.cells,
                    masterPath: f.masterPath, sourceId: f.sourceId,
                    wrapDeg: f.wrapDeg, cylinder: f.cylinder,
                    cylinderRadius: f.cylinderRadius, cylinderRotation: f.cylinderRotation,
                    cylinderWrap: f.cylinderWrap, outline: f.outline,
                    name: f.name, opacity: f.opacity, blend: f.blend,
                }))),
            }))) as unknown as { success: boolean; error?: string; faces?: number; missing?: string[] } | undefined;
            if (r === undefined) throw new Error("no bridge");
            if (!r.success) { say(r.error || "Couldn't build that.", "error"); return; }
            const missed = (r.missing || []).length;
            say(`Built ${compName} with ${r.faces} face${r.faces === 1 ? "" : "s"}.` +
                (missed ? ` Skipped: ${(r.missing || []).join(", ")}` : ""), missed ? "error" : "success");
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
        } finally {
            setBusy(false);
        }
    };

    // --- painting ---------------------------------------------------------
    const pct = (v: number, total: number) => `${(v / total) * 100}%`;
    const sides: Side[] = ["top", "bottom", "left", "right"];
    const cellCount = face ? (rows(face) - 1) * (cols(face) - 1) : 0;

    return (
        // ARMED OVER THE WHOLE BOARD, not just the canvas. Claiming only while
        // the pointer was over the plate meant every trip to a button released
        // the keys, and they were gone by the time you came back.
        <div className="insitu" onMouseEnter={claim} onMouseLeave={release}>
            <div className="ins-bar">
                <button className="ins-btn ins-btn--ghost" onClick={onBack}><ArrowLeft size={12} /> Back</button>
                <input type="text" className="ins-name" value={compName} onChange={(e) => setCompName(e.target.value)} />
                <label className="ins-inline">
                    <input type="text" className="ins-num" value={secs} onChange={(e) => setSecs(e.target.value)} />
                    <span>sec</span>
                </label>
                <button className="ins-btn ins-btn--ghost" onClick={() => setLibraryOpen(true)}>
                    <Library size={12} /> Library{templates.length ? ` (${templates.length})` : ""}
                </button>
                <button className="ins-btn ins-btn--ghost" disabled={busy || !plate} onClick={saveLayout}>
                    <Save size={12} /> Save
                </button>
                <button className="ins-btn" disabled={busy || !plate} onClick={build}>
                    <Hammer size={12} /> Build in AE
                </button>
            </div>

            {!plate && (
                <div className="ins-pick">
                    <p className="ins-pick-q">Which photo is this going on?</p>
                    <div className="ins-pick-row">
                        <button className="ins-btn" onClick={backdropFromProject}>
                            <MousePointer2 size={12} /> Use what's selected
                        </button>
                        <button className="ins-btn ins-btn--ghost" onClick={pick}>
                            <ImageIcon size={12} /> Browse…
                        </button>
                    </div>
                    {suggestions.length > 0 && (
                        <div className="ins-suggest">
                            <p className="ins-lbl">From this screen's references</p>
                            {suggestions.map((sg) => (
                                <button key={sg.path} className="ins-sug" onClick={() => loadBackdrop(sg.path)}>
                                    {sg.name || leaf(sg.path)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {plate && (
                <>
                    <div className="ins-zoom">
                        <Tooltip text="Wheel to zoom about the pointer. Alt-drag or middle-drag to move around.">
                            <span className="ins-seg-lbl">{Math.round(zoom * 100)}%</span>
                        </Tooltip>
                        <button className="ins-mini" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
                        <button className="ins-mini" onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>+</button>
                        <button className="ins-mini" onClick={() => setZoom(1)}>Fit</button>
                        <button className={"ins-mini" + (loupe ? " is-on" : "")} onClick={() => setLoupe((v) => !v)}>
                            Loupe
                        </button>
                        <Tooltip text="Pulls a dragged point onto another face's corner or edge, and onto the edges of the photo itself — one axis at a time, so fitting to the top doesn't also move it sideways.">
                            <button className={"ins-mini" + (snap ? " is-on" : "")} onClick={() => setSnap((v) => !v)}>
                                Snap
                            </button>
                        </Tooltip>
                        <button className="ins-mini" onClick={undo}>Undo</button>
                        <Tooltip text="Finds the shapes in a flat-colour plate — a spec sheet or a render — and proposes a face for each. Says so and proposes nothing when the plate is a photograph.">
                            <button className="ins-mini" disabled={busy} onClick={detect}>Detect</button>
                        </Tooltip>
                        <button className={"ins-mini" + (marking ? " is-on" : "")}
                            onClick={() => { setMarking((v) => !v); setMarks([]); setMarkRow(null); }}>
                            Trace
                        </button>
                        {marking && (
                            <>
                                <span className="ins-seg-lbl">
                                    {markRow
                                        ? `bottom: ${marks.length} of ${markRow.length}`
                                        : `${marks.length} point${marks.length === 1 ? "" : "s"}`}
                                </span>
                                {!markRow && marks.length > 4 && (
                                    <button className="ins-mini"
                                        onClick={() => { setMarkRow(marks); setMarks([]); }}>
                                        Top done
                                    </button>
                                )}
                                {marks.length > 0 && (
                                    <button className="ins-mini" onClick={() => setMarks((m) => m.slice(0, -1))}>
                                        Undo
                                    </button>
                                )}
                                <button className="ins-mini is-go" onClick={faceFromMarks}>Make face</button>
                            </>
                        )}
                    </div>
                    {/* Scrolled rather than transformed: every drag measures the
                        stage's live rectangle, so zooming needs no change to
                        the maths at all. */}
                    <div className={"ins-stage-wrap" + (zoom > 1 ? " is-zoomed" : "")}
                        ref={wrapRef}
                        onMouseDown={(e) => { beginPan(e); }}>
                        {/* Focused so macOS AE actually delivers the keystroke;
                            registerKeyEventsInterest alone is not enough. */}
                        <input type="text" className="ins-keygrab" ref={keyGrabRef} readOnly
                            onFocus={(e) => e.stopPropagation()} />
                        <div className={"ins-stage" + (marking ? " is-marking" : "")} ref={stageRef}
                            onMouseDown={(e) => {
                                if (e.button === 1 || e.altKey) return;   // panning
                                if (!marking) return;
                                const box = stageRef.current?.getBoundingClientRect();
                                if (!box) return;
                                const at: Pt = [
                                    ((e.clientX - box.left) / box.width) * plate.w,
                                    ((e.clientY - box.top) / box.height) * plate.h,
                                ];
                                const tol = 9 * (stageW > 0 ? plate.w / stageW : 1);
                                const hit = snap ? snapTarget(faces, -1, at, tol, plate.w, plate.h) : null;
                                setMarks((prev) => prev.concat([hit || at]));
                            }}
                            style={{
                                width: `${zoom * 100}%`,
                                paddingBottom: `${(plate.h / plate.w) * 100 * zoom}%`,
                            }}>
                            <div className="ins-clip">
                            <img className="ins-plate" src={fileUrl(backdrop)} alt="" />

                            {/* THE ARTWORK, ACTUALLY WARPED. Every cell is the
                                thumbnail's matching slice, mapped onto that
                                cell by the same projective transform the corner
                                pin will use in AE. Without this the artist is
                                asked to imagine the result and press Build to
                                find out, which is what made a wrong shape
                                impossible to spot.

                                The wrapper works in PLATE PIXELS and is scaled
                                to the stage, because matrix3d translates in px
                                and the stage is a percentage box. */}
                            <div className="ins-paint-layer"
                                style={{
                                    width: `${plate.w}px`,
                                    height: `${plate.h}px`,
                                    transform: `scale(${stageW > 0 ? stageW / plate.w : 0})`,
                                    transformOrigin: "0 0",
                                }}>
                                {faces.map((f) => {
                                    const tex = thumbs[f.sourceId];
                                    if (!tex) return null;
                                    const pv = previewGrid(f);
                                    const us = pv.us;
                                    const vs = pv.vs;
                                    const g = pv.grid;
                                    const cellRows = g.length - 1;
                                    const cellCols = g[0].length - 1;
                                    const blank: null[][] = [];
                                    for (let r = 0; r < cellRows; r++) {
                                        const row: null[] = [];
                                        for (let c = 0; c < cellCols; c++) row.push(null);
                                        blank.push(row);
                                    }
                                    return blank.map((row, r) => row.map((_, c) => {
                                        const sw = Math.max(1, (us[c + 1] - us[c]) * tex.w);
                                        const sh = Math.max(1, (vs[r + 1] - vs[r]) * tex.h);
                                        const t = quadTransform(
                                            g[r][c], g[r][c + 1], g[r + 1][c + 1], g[r + 1][c], sw, sh);
                                        if (t === "none") return null;
                                        return (
                                            <div
                                                key={`px-${f.id}-${r}-${c}`}
                                                className="ins-paint"
                                                style={{
                                                    width: `${sw}px`,
                                                    height: `${sh}px`,
                                                    opacity: f.opacity / 100,
                                                    backgroundImage: `url("${fileUrl(tex.path)}")`,
                                                    backgroundSize: `${tex.w}px ${tex.h}px`,
                                                    backgroundPosition: `${-us[c] * tex.w}px ${-vs[r] * tex.h}px`,
                                                    transform: t,
                                                    transformOrigin: "0 0",
                                                }}
                                            />
                                        );
                                    }));
                                })}
                            </div>
                            </div>

                            <svg className="ins-quads" viewBox={`0 0 ${plate.w} ${plate.h}`} preserveAspectRatio="none">
                                {/* A masked face draws its real outline, because
                                    that is what will be built. */}
                                {faces.map((f, fi) => (f.outline.length >= 3 ? (
                                    <path
                                        key={`out-${f.id}`}
                                        className={"ins-quad" + (fi === sel ? " is-on is-seg" : "")}
                                        d={`M ${f.outline.map((p) => `${p[0]},${p[1]}`).join(" L ")} Z`}
                                        onMouseDown={() => { setSel(fi); setSelSide(null); }}
                                    />
                                ) : null))}
                                {faces.map((f, fi) => (f.outline.length >= 3 ? null : f.cells.map((row, r) => row.map((_, c) => (
                                    <path
                                        key={`${f.id}-${r}-${c}`}
                                        className={"ins-quad" + (fi === sel ? " is-on" : "") +
                                            (fi === sel && r === selCell[0] && c === selCell[1] ? " is-seg" : "")}
                                        d={cellPath(f, r, c)}
                                        onMouseDown={() => { setSel(fi); setSelCell([r, c]); setSelSide(null); }}
                                    />
                                )))))}
                                {/* THE FOUR SIDES, thick and clickable. Highlighting
                                    one is how you say which way the next point
                                    should divide the face. */}
                                {face && sides.map((sd) => (
                                    <polyline
                                        key={sd}
                                        className={"ins-side" + (selSide === sd ? " is-on" : "")}
                                        points={sidePoints(face, sd).map((p) => `${p[0]},${p[1]}`).join(" ")}
                                        onMouseDown={(e) => { e.stopPropagation(); setSelSide(selSide === sd ? null : sd); }}
                                    />
                                ))}
                                {face && cell && (
                                    <g className="ins-tan-lines">
                                        {(() => {
                                            const [cul, cur, clr, cll] = cellCorners(face, selCell[0], selCell[1]);
                                            const anchors: Pt[] = [cul, cur, cur, clr, cll, clr, cll, cul];
                                            const tans = cell.t.length >= 8
                                                ? cell.t
                                                : straightTangents(face, selCell[0], selCell[1]);
                                            return tans.slice(0, 8).map((t, n) => {
                                                return (
                                                    <line key={n} x1={anchors[n][0]} y1={anchors[n][1]}
                                                        x2={t[0]} y2={t[1]} />
                                                );
                                            });
                                        })()}
                                    </g>
                                )}
                            </svg>

                            {marking && marks.map((m, i) => (
                                <div key={`mk${i}`} className="ins-mark"
                                    style={{ left: pct(m[0], plate.w), top: pct(m[1], plate.h) }}>{i + 1}</div>
                            ))}
                            {marking && (markRow || []).map((m, i) => (
                                <div key={`mr${i}`} className="ins-mark is-done"
                                    style={{ left: pct(m[0], plate.w), top: pct(m[1], plate.h) }} />
                            ))}

                            {faces.map((f, i) => (
                                <React.Fragment key={f.id}>
                                    <div
                                        className={"ins-grip" + (i === sel ? " is-on" : "")}
                                        style={{
                                            left: pct((corner(f, "ul")[0] + corner(f, "lr")[0]) / 2, plate.w),
                                            top: pct((corner(f, "ul")[1] + corner(f, "lr")[1]) / 2, plate.h),
                                        }}
                                        onMouseDown={(e) => grab(e, i, "all")}
                                        title={f.name}
                                    >{i + 1}</div>
                                    {/* EVERY GRID POINT IS A HANDLE. The four
                                        corners are simply the points at the
                                        ends of the ends. */}
                                    {i === sel && f.grid.map((row, r) => row.map((p, c) => {
                                        const isCorner = (r === 0 || r === rows(f) - 1) && (c === 0 || c === cols(f) - 1);
                                        // A Curved face generates nine columns.
                                        // Showing every one of them implies
                                        // they all want editing; they do not,
                                        // and the bend field is the control.
                                        if (!isCorner && !handOpen) return null;
                                        const picked = !!selPoint && selPoint[0] === r && selPoint[1] === c;
                                        return (
                                            <div
                                                key={`${r}-${c}`}
                                                className={(isCorner ? "ins-handle is-on" : "ins-rib") + (picked ? " is-picked" : "")}
                                                style={{ left: pct(p[0], plate.w), top: pct(p[1], plate.h) }}
                                                onMouseDown={(e) => grab(e, i, `pt:${r}:${c}`)}
                                            />
                                        );
                                    }))}
                                    {/* ALWAYS THERE, ON THE SELECTED CELL. A side
                                        bends because you dragged its handle,
                                        not because you found a mode first --
                                        which is the whole of the curve UI now. */}
                                    {i === sel && cell && (cell.t.length >= 8 ? cell.t : straightTangents(f, selCell[0], selCell[1]))
                                        .slice(0, 8).map((t, n) => {
                                        return (
                                        <div
                                            key={`t${n}`}
                                            className="ins-tan"
                                            style={{ left: pct(t[0], plate.w), top: pct(t[1], plate.h) }}
                                            onMouseDown={(e) => grab(e, i, `tan:${selCell[0]}:${selCell[1]}:${n}`)}
                                        />
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    {/* A LOUPE, not a zoom of the whole board. Landing a corner
                        on a cornice means looking closely at one spot while
                        still seeing where that spot is; the same content is
                        simply drawn again, magnified about the pointer, and
                        takes no clicks. */}
                    {loupe && look && (
                        <div className="ins-loupe" ref={loupeRef}>
                            {/* OFFSET IN PIXELS, NOT PERCENT. A percentage `top`
                                resolves against the LOUPE BOX's height while
                                the plate inside it is several times taller, so
                                the view sat well above the pointer -- which is
                                the one thing a loupe must never do. */}
                            <div className="ins-loupe-inner"
                                style={{
                                    transform: `scale(${LOUPE})`,
                                    transformOrigin: `${look.x * 100}% ${look.y * 100}%`,
                                    left: `${loupeW * (0.5 - look.x)}px`,
                                    top: `${LOUPE_H / 2 - look.y * (loupeW * (plate.h / plate.w))}px`,
                                }}>
                                <img className="ins-plate" src={fileUrl(backdrop)} alt="" />
                                <div className="ins-paint-layer"
                                    style={{
                                        width: `${plate.w}px`,
                                        height: `${plate.h}px`,
                                        transform: `scale(${loupeW > 0 ? loupeW / plate.w : 0})`,
                                        transformOrigin: "0 0",
                                    }}>
                                    {faces.map((f) => {
                                        const tex = thumbs[f.sourceId];
                                        if (!tex) return null;
                                        const pv = previewGrid(f);
                                        const g = pv.grid;
                                        const out: React.ReactNode[] = [];
                                        for (let r = 0; r < g.length - 1; r++) {
                                            for (let c = 0; c < g[0].length - 1; c++) {
                                                const sw = Math.max(1, (pv.us[c + 1] - pv.us[c]) * tex.w);
                                                const sh = Math.max(1, (pv.vs[r + 1] - pv.vs[r]) * tex.h);
                                                const t = quadTransform(g[r][c], g[r][c + 1], g[r + 1][c + 1], g[r + 1][c], sw, sh);
                                                if (t === "none") continue;
                                                out.push(
                                                    <div key={`lp-${f.id}-${r}-${c}`} className="ins-paint"
                                                        style={{
                                                            width: `${sw}px`, height: `${sh}px`,
                                                            opacity: f.opacity / 100,
                                                            backgroundImage: `url("${fileUrl(tex.path)}")`,
                                                            backgroundSize: `${tex.w}px ${tex.h}px`,
                                                            backgroundPosition: `${-pv.us[c] * tex.w}px ${-pv.vs[r] * tex.h}px`,
                                                            transform: t, transformOrigin: "0 0",
                                                        }} />
                                                );
                                            }
                                        }
                                        return out;
                                    })}
                                </div>
                                <svg className="ins-quads" viewBox={`0 0 ${plate.w} ${plate.h}`} preserveAspectRatio="none">
                                    {faces.map((f, fi) => f.cells.map((row, r) => row.map((_, c) => (
                                        <path key={`lq-${f.id}-${r}-${c}`}
                                            className={"ins-quad" + (fi === sel ? " is-on" : "")}
                                            d={cellPath(f, r, c)} />
                                    ))))}
                                </svg>
                            </div>
                            <div className="ins-loupe-cross" />
                        </div>
                    )}

                    <div className="ins-faces">
                        {faces.map((f, i) => (
                            <button key={f.id} className={"ins-face" + (i === sel ? " is-on" : "")}
                                onClick={() => { setSel(i); setSelCell([0, 0]); setSelSide(null); }}>
                                <strong>{f.name}</strong>
                                <span>
                                    {f.sourceName || (f.masterPath ? leaf(f.masterPath) : "nothing on it")}
                                    {f.cylinder
                                        ? " · cylinder"
                                        : ((rows(f) - 1) * (cols(f) - 1) > 1 ? ` · ${cols(f) - 1}×${rows(f) - 1}` : "")}
                                </span>
                                <span className="ins-face-x" onClick={(e) => { e.stopPropagation(); removeFace(i); }}>
                                    <Trash2 size={10} />
                                </span>
                            </button>
                        ))}
                        <button className="ins-btn ins-btn--ghost" onClick={addFace}><Plus size={12} /> Face</button>
                        {face && <button className="ins-btn ins-btn--ghost" onClick={duplicateFace}><Copy size={12} /> Copy</button>}
                        {face && <button className="ins-btn ins-btn--ghost" onClick={resetFace}><RotateCcw size={12} /> Reset</button>}
                    </div>

                    {face && (
                        <>
                            <div className="ins-props">
                                <input type="text" className="ins-name" value={face.name} onChange={(e) => patch({ name: e.target.value })} />
                                <button className="ins-btn ins-btn--ghost ins-src" onClick={faceFromProject}>
                                    <MousePointer2 size={11} />
                                    <span>{face.sourceName || (face.masterPath ? leaf(face.masterPath) : "Use selected in project")}</span>
                                </button>
                                <select className="ins-select ins-select--sm" value={face.blend} onChange={(e) => patch({ blend: e.target.value })}>
                                    <option value="normal">Normal</option>
                                    <option value="screen">Screen</option>
                                    <option value="add">Add</option>
                                </select>
                                <label className="ins-inline">
                                    <input type="text" className="ins-num" value={String(face.opacity)}
                                        onChange={(e) => patch({ opacity: Number(e.target.value) || 0 })} />
                                    <span>%</span>
                                </label>
                            </div>

                            {/* TWO SHAPES, because the work only has two: a
                                panel, and a drum. Everything else is a side
                                that bends, and a side bends by dragging its
                                handle. Curved-as-a-mode, % bend, Smooth all,
                                Arc and ° wrap all existed to build a bend out
                                of tiles, which nothing here needs. */}
                            <div className="ins-props ins-props--quiet">
                                <span className="ins-seg-lbl">Shape</span>
                                <div className="ins-shape">
                                    {([["flat", "Flat"], ["cylinder", "Round"]] as [string, string][])
                                        .map(([k, label]) => (
                                            <button key={k}
                                                className={"ins-shape-b" + ((shapeOf(face) === k) ? " is-on" : "")}
                                                onClick={() => setShape(k)}>{label}</button>
                                        ))}
                                </div>
                                {face.cylinder && (
                                    <>
                                        <Tooltip text="How much of the drum the artwork covers. 180 is exactly the half facing you, so its edges sit on the silhouette; go above 180 for a screen that genuinely wraps further round.">
                                            <label className="ins-inline">
                                                <input type="text" className="ins-num" value={String(face.cylinderWrap)}
                                                    onChange={(e) => patch({ cylinderWrap: Number(e.target.value) || 0 })} />
                                                <span>° wrap</span>
                                            </label>
                                        </Tooltip>
                                        <label className="ins-inline">
                                            <input type="text" className="ins-num" value={String(face.cylinderRotation)}
                                                onChange={(e) => patch({ cylinderRotation: Number(e.target.value) || 0 })} />
                                            <span>° turn</span>
                                        </label>
                                    </>
                                )}
                                {face.outline.length > 0 && (
                                    <Tooltip text={`Built as a mask of the traced outline, ${face.outline.length} points. Drop it to go back to a four-corner quad.`}>
                                        <button className="ins-btn ins-btn--ghost" disabled={busy}
                                            onClick={() => patch({ outline: [] })}>
                                            Outline mask ({face.outline.length}) ✕
                                        </button>
                                    </Tooltip>
                                )}
                                {face.cells[0] && face.cells[0][0] && face.cells[0][0].curved && (
                                    <button className="ins-btn ins-btn--ghost" disabled={busy}
                                        onClick={() => edit((f) => ({
                                            ...f,
                                            cells: f.cells.map((row, r) => row.map((sg, c) =>
                                                (r === selCell[0] && c === selCell[1] ? flatCell() : sg))),
                                        }))}>
                                        Straighten sides
                                    </button>
                                )}
                                {/* THE LAST STEP IS TYPED, NOT DRAGGED. One
                                    screen pixel is several plate pixels at fit
                                    zoom, so a corner can be dragged close and
                                    only ever close. */}
                                {selPoint && face.grid[selPoint[0]] && (
                                    <>
                                        <span className="ins-seg-lbl">point</span>
                                        <label className="ins-inline">
                                            <input type="text" className="ins-num"
                                                value={String(Math.round(face.grid[selPoint[0]][selPoint[1]][0]))}
                                                onChange={(e) => setPointAt(0, Number(e.target.value) || 0)} />
                                            <span>x</span>
                                        </label>
                                        <label className="ins-inline">
                                            <input type="text" className="ins-num"
                                                value={String(Math.round(face.grid[selPoint[0]][selPoint[1]][1]))}
                                                onChange={(e) => setPointAt(1, Number(e.target.value) || 0)} />
                                            <span>y</span>
                                        </label>
                                    </>
                                )}
                                <button className="ins-more" onClick={() => setHandOpen((v) => !v)}>
                                    {handOpen ? "Hide" : "Split it up"}
                                </button>
                            </div>

                            {/* SPLITTING IS FOR SHAPES A SINGLE PANEL CANNOT BE:
                                a wall that turns twice, or a screen made of
                                separate tiles at different heights. It is not
                                how a curve gets made any more. */}
                            {handOpen && (
                            <div className="ins-props ins-props--quiet">
                                <span className="ins-seg-lbl">
                                    {selSide ? `${selSide} side` : `cell ${selCell[1] + 1},${selCell[0] + 1} of ${cellCount}`}
                                </span>
                                <Tooltip text={selSide
                                    ? (selSide === "top" || selSide === "bottom"
                                        ? "Splits this face down its length, adding a column."
                                        : "Splits this face across its height, adding a row.")
                                    : "No side highlighted, so this adds a column AND a row. Click a side to divide only that way."}>
                                    <button className="ins-btn ins-btn--ghost" disabled={busy} onClick={addPoint}>
                                        <Plus size={11} /> Split
                                    </button>
                                </Tooltip>
                                {(cols(face) > 2 || rows(face) > 2) && (
                                    <button className="ins-btn ins-btn--ghost" disabled={busy}
                                        onClick={() => edit((f) => (selSide === "left" || selSide === "right"
                                            ? removeRow(f, selCell[0] + 1)
                                            : removeColumn(f, selCell[1] + 1)))}>
                                        <Trash2 size={11} /> Split
                                    </button>
                                )}
                                <Tooltip text="How much of a drum this face shows. 0 spreads the artwork evenly across the photo; 180 compresses it towards the edges the way a cylinder does.">
                                    <label className="ins-inline">
                                        <input type="text" className="ins-num" value={String(face.wrapDeg)}
                                            onChange={(e) => patch({ wrapDeg: Number(e.target.value) || 0 })} />
                                        <span>° wrap</span>
                                    </label>
                                </Tooltip>
                            </div>
                            )}

                        </>
                    )}

                    <Tooltip text={backdrop}>
                        <p className="ins-plate-note">
                            {plate.w}×{plate.h} {plate.still ? "still" : "movie"} · {leaf(backdrop)}
                        </p>
                    </Tooltip>
                </>
            )}

            <ScreenLibrary
                open={libraryOpen}
                entries={templates}
                onClose={() => setLibraryOpen(false)}
                onLoad={loadScreen}
                onTrace={loadScreen}
                activeId={screen ? screen.id : ""}
                onReload={() => { if (onReloadTemplates) onReloadTemplates(); }}
                onStatus={(text, type) => setStatus({ text, type })}
            />

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default InsituBoard;
