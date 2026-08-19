// =============================================================================
// src/js/main/lib/agent/multiArt.ts
// -----------------------------------------------------------------------------
// TURNING "7s of 3 portrait Trio 1080x1920" INTO ACTUAL MASTERS.
//
// The sentence is parsed by the model, which is what a model is for. This file
// does the part a model must never do: decide WHICH master on the shelf a word
// refers to.
//
// FORGIVING ABOUT SPELLING, STRICT ABOUT IDENTITY. "PortalToParadise",
// "portal_to_paradise" and "Portal To Paradise" are the same creative typed
// three ways, and refusing over a separator would make this useless. But once
// the spelling is normalised the decision is exact: if the word lands on TWO
// creatives, this refuses and names them. It never scores, never ranks, never
// picks the closest.
//
// That distinction is the whole reason this is a separate file. CLAUDE.md
// forbids loosening the CSV and OV Swap matchers into fuzzy matches, because a
// near-miss there puts another campaign's artwork into a finished deliverable.
// The same danger is live here -- a Multi Art row is a real deliverable -- so
// the loosening is confined to NORMALISATION, which cannot change which
// creative is meant, and kept out of SELECTION, which can.
//
// Nothing here touches AE, React or the bridge, so it can be exercised
// headlessly -- which matters, because the failure it guards against is silent.
// =============================================================================

/** The subset of Bespoke's BespokeMaster this needs. Structural, so the tool's
 *  own richer type satisfies it without an import cycle. */
export interface MasterLike {
    path: string;
    name: string;
    creative: string;
    width: number;
    height: number;
    orientation: string;
    duration: string;
}

/** One segment as the agent proposes it. */
export interface SegmentSpec {
    seconds: number;
    count: number;
    /** A creative name, spelled however. */
    creative?: string;
    /** PORTRAIT | LANDSCAPE | SQUARE | QUAD, any case. */
    orientation?: string;
    /** "1080x1920", with or without a px suffix. */
    size?: string;
    /** An exact master filename. Wins over every other field. */
    master?: string;
}

export interface SegmentPlan {
    seconds: number;
    tiles: MasterLike[];
    /** Something true and worth saying, e.g. a master placed more than once. */
    note?: string;
}

export interface PlanOk { ok: true; segments: SegmentPlan[]; notes: string[] }
export interface PlanErr { ok: false; error: string }
export type PlanResult = PlanOk | PlanErr;

/** Case, spacing, underscores and hyphens removed. Identity is what survives. */
export function normalise(s: string): string {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "1080x1920px" / "1080 X 1920" -> "1080x1920". "" when it isn't a size. */
export function normaliseSize(s: string): string {
    const m = /(\d{2,5})\s*[xX×]\s*(\d{2,5})/.exec(String(s || ""));
    return m ? m[1] + "x" + m[2] : "";
}

const ORIENTATIONS = ["PORTRAIT", "LANDSCAPE", "SQUARE", "QUAD"];

/**
 * Reads the agent's JSON. Returns the specs, or the reason they are unusable.
 *
 * STRICT, because this is the boundary. Everything past here trusts the shape,
 * and a malformed spec that got half-applied would leave a board nobody asked
 * for -- with no undo, since segments are panel state.
 */
export function parseSegmentSpec(json: string): { ok: true; specs: SegmentSpec[] } | PlanErr {
    let raw: any;
    try {
        raw = JSON.parse(String(json || ""));
    } catch {
        return { ok: false, error: "The segments spec wasn't valid JSON." };
    }
    if (!raw || Object.prototype.toString.call(raw) !== "[object Array]") {
        return { ok: false, error: "The segments spec must be an array of segments." };
    }
    if (!raw.length) return { ok: false, error: "The segments spec was empty." };
    if (raw.length > 24) {
        return { ok: false, error: `That spec asks for ${raw.length} segments, which is past anything real.` };
    }

    const specs: SegmentSpec[] = [];
    for (let i = 0; i < raw.length; i++) {
        const r = raw[i] || {};
        const where = `Segment ${i + 1}`;
        const seconds = Number(r.seconds);
        if (!isFinite(seconds) || seconds <= 0) {
            return { ok: false, error: `${where} has no usable duration.` };
        }
        // Defaults to ONE rather than refusing: "then 3s of PortalToParadise"
        // plainly means one, and making the model restate it invites it to
        // guess a number instead.
        const count = r.count === undefined || r.count === null ? 1 : Number(r.count);
        if (!isFinite(count) || count < 1 || count !== Math.floor(count)) {
            return { ok: false, error: `${where} asks for an odd number of creatives (${r.count}).` };
        }
        if (count > 12) {
            return { ok: false, error: `${where} asks for ${count} creatives across one frame, which is past anything real.` };
        }
        const orientation = r.orientation ? String(r.orientation).toUpperCase() : "";
        if (orientation && ORIENTATIONS.indexOf(orientation) === -1) {
            return { ok: false, error: `${where}: "${r.orientation}" isn't an orientation. Use ${ORIENTATIONS.join(", ")}.` };
        }
        const size = r.size ? normaliseSize(r.size) : "";
        if (r.size && !size) {
            return { ok: false, error: `${where}: "${r.size}" isn't a size. Use WIDTHxHEIGHT.` };
        }
        if (!r.creative && !r.master) {
            return { ok: false, error: `${where} doesn't say which creative to use.` };
        }
        specs.push({
            seconds,
            count,
            creative: r.creative ? String(r.creative) : "",
            orientation,
            size,
            master: r.master ? String(r.master) : "",
        });
    }
    return { ok: true, specs };
}

/** Every distinct creative on the shelf, for naming alternatives in errors. */
function creativesOf(masters: MasterLike[]): string[] {
    const seen: Record<string, boolean> = {};
    const out: string[] = [];
    for (const m of masters) {
        const c = m.creative || m.name;
        if (c && !seen[c]) { seen[c] = true; out.push(c); }
    }
    return out.sort();
}

function listOf(names: string[], max: number): string {
    if (names.length <= max) return names.join(", ");
    return names.slice(0, max).join(", ") + ` and ${names.length - max} more`;
}

/**
 * One segment's masters, or the reason there aren't any.
 *
 * The filters narrow in the order a person would say them -- which creative,
 * then which shape of it -- so the error can name the step that emptied the
 * pool rather than reporting "nothing matched" about four conditions at once.
 */
function selectFor(spec: SegmentSpec, masters: MasterLike[], where: string): { ok: true; plan: SegmentPlan } | PlanErr {
    // An exact filename beats everything: it is the artist saying "this one".
    if (spec.master) {
        const want = normalise(spec.master.replace(/\.aep$/i, ""));
        const hits = masters.filter((m) => normalise(String(m.name).replace(/\.aep$/i, "")) === want);
        if (!hits.length) return { ok: false, error: `${where}: no master called "${spec.master}" on this shelf.` };
        if (hits.length > 1) {
            return { ok: false, error: `${where}: "${spec.master}" matches ${hits.length} masters. Name one exactly.` };
        }
        const filled = repeatTo(hits, spec.count);
        return {
            ok: true,
            plan: { seconds: spec.seconds, tiles: filled.tiles, note: filled.note ? `${where}: ${filled.note}` : undefined },
        };
    }

    const want = normalise(spec.creative || "");
    let pool = masters.filter((m) => normalise(m.creative || m.name) === want);
    let sizeNote = "";

    // NOT A SUBSTRING FALLBACK BY DEFAULT. It is tried only when the exact
    // normalised name found nothing, and it must still land on ONE creative --
    // "Trio" reaching both TrioLaunch and TrioEndcard is a question, not a
    // preference, and answering it wrongly puts the wrong artwork in a
    // deliverable that looks finished.
    if (!pool.length) {
        pool = masters.filter((m) => normalise(m.creative || m.name).indexOf(want) !== -1);
        const spanning = creativesOf(pool);
        if (spanning.length > 1) {
            return {
                ok: false,
                error: `${where}: "${spec.creative}" matches ${spanning.length} creatives (${listOf(spanning, 4)}). Which one?`,
            };
        }
    }
    if (!pool.length) {
        const all = creativesOf(masters);
        return {
            ok: false,
            error: `${where}: no creative called "${spec.creative}". This campaign has ${listOf(all, 6)}.`,
        };
    }

    if (spec.orientation) {
        const narrowed = pool.filter((m) => String(m.orientation).toUpperCase() === spec.orientation);
        if (!narrowed.length) {
            const have = uniq(pool.map((m) => String(m.orientation || "?").toLowerCase()));
            return {
                ok: false,
                error: `${where}: no ${spec.orientation.toLowerCase()} ${spec.creative} — that creative is ${listOf(have, 3)}.`,
            };
        }
        pool = narrowed;
    }

    // SIZE IS A PREFERENCE, NOT A REQUIREMENT -- this is the studio's own rule,
    // not a new one. pickBestMasterFromIndex (tools.ts), which every localise
    // path goes through, filters masters to the right ORIENTATION and then
    // takes the closest aspect RATIO. It never demands an exact size, because a
    // master is a source that gets scaled into the deliverable: a 1080x1920
    // portrait master is exactly what fills a 1080x1526 portrait panel.
    //
    // Requiring an exact match here refused a row the rest of the panel would
    // have built without comment. An explicitly named variant still wins when
    // it exists -- "the 1920x1080 Trio" is a real instruction -- so exact is
    // preferred and closest-ratio is the fallback, said out loud.
    if (spec.size) {
        const exact = pool.filter((m) => m.width + "x" + m.height === spec.size);
        if (exact.length) {
            pool = exact;
        } else {
            const want = spec.size.split("x");
            const wantRatio = Number(want[0]) / Number(want[1]);
            const wantPortrait = wantRatio < 1;
            // ORIENTATION INFERRED FROM A SIZE IS A PREFERENCE; ORIENTATION
            // THE ARTIST TYPED IS NOT. An explicit `orientation` has already
            // refused above if the creative has nothing that way. Here the
            // shape was only implied by a canvas, and a portrait master in a
            // landscape frame is the headline Multi Art case -- three portrait
            // panels across a metrobus. So prefer the matching orientation and
            // fall back rather than refusing the thing the tool is for.
            const sameWay = pool.filter((m) => (m.width / m.height < 1) === wantPortrait);
            const usable = sameWay.length ? sameWay : pool;

            let best = Number.MAX_VALUE;
            for (const m of usable) {
                const d = Math.abs(wantRatio - m.width / m.height);
                if (d < best) best = d;
            }
            // Every master AT that best ratio, not the first one found: several
            // sibling masters share a size, and narrowing to one here would
            // silently drop the other panels of a three-up.
            pool = usable.filter((m) => Math.abs(wantRatio - m.width / m.height) - best < 1e-9);
            const sizes = uniq(pool.map((m) => m.width + "x" + m.height));
            sizeNote =
                `nothing is exactly ${spec.size}, so ${sizes.join("/")} ` +
                `${sizes.length === 1 ? "was" : "were"} used and will scale to fit`;
        }
    }

    const filled = repeatTo(pool, spec.count);
    const notes: string[] = [];
    if (sizeNote) notes.push(sizeNote);
    if (filled.note) notes.push(filled.note);
    return {
        ok: true,
        plan: { seconds: spec.seconds, tiles: filled.tiles, note: notes.length ? `${where}: ${notes.join("; ")}` : undefined },
    };
}

function uniq(xs: string[]): string[] {
    const seen: Record<string, boolean> = {};
    const out: string[] = [];
    for (const x of xs) if (x && !seen[x]) { seen[x] = true; out.push(x); }
    return out.sort();
}

/**
 * `count` tiles from a pool, distinct first.
 *
 * A pool smaller than the count is the tiling case -- one portrait master
 * across three panels of a metrobus is a real thing to ask for -- so it
 * repeats rather than refusing. IT SAYS SO EVERY TIME. Quietly placing the
 * same artwork three times when the artist expected three different panels is
 * a deliverable that looks right in the panel and is wrong on the wall.
 */
function repeatTo(pool: MasterLike[], count: number): { tiles: MasterLike[]; note?: string } {
    const tiles: MasterLike[] = [];
    for (let i = 0; i < count; i++) tiles.push(pool[i % pool.length]);
    if (pool.length >= count) return { tiles };
    return {
        tiles,
        note: pool.length === 1
            ? `only one master matched, so it's placed ${count} times`
            : `only ${pool.length} masters matched, so they repeat to fill ${count} panels`,
    };
}

/**
 * The whole plan, or the first reason it can't be built.
 *
 * ALL OR NOTHING. A partly-applied plan is the worst outcome available: the
 * board looks assembled, the missing segment is invisible, and Build would
 * produce a deliverable short of what was asked for.
 */
export function planSegments(specs: SegmentSpec[], masters: MasterLike[]): PlanResult {
    if (!masters.length) return { ok: false, error: "No masters are loaded, so there's nothing to build from." };
    const segments: SegmentPlan[] = [];
    const notes: string[] = [];
    for (let i = 0; i < specs.length; i++) {
        const got = selectFor(specs[i], masters, `Segment ${i + 1}`);
        if (!got.ok) return got;
        segments.push(got.plan);
        if (got.plan.note) notes.push(got.plan.note);
    }
    return { ok: true, segments, notes };
}
