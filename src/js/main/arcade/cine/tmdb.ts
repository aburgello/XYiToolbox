// TMDB access for the movie-chain game.
//
// TRANSPORT, and this is the whole reason this file isn't three lines of
// fetch(): the packaged panel is a `file://` page, where browser `fetch()`
// fails outright on a cross-origin API. The panel runs with `--enable-nodejs`
// precisely so we can sidestep that -- see lib/utils/wrikeApi.ts, which is
// the established pattern here and whose header spells out the same reasoning
// ("sidesteps CORS entirely instead of fighting it"). So: Node `https` when
// the bridge is there, `fetch` only as the browser-preview fallback.
//
// The fallback is not decoration -- it's what makes this game testable in
// `yarn dev` at all, the same way a scheme-aware asset
// reader is. Note the DISPATCH IS ON NODE AVAILABILITY here rather than on
// URL scheme, which is the opposite of the asset rule -- deliberately:
// there the question was "which filesystem am I reading", here it's purely
// "do I have a transport that isn't subject to CORS".
//
// KEY: committed deliberately. Confirmed with the studio -- it's a free,
// rotatable, read-only TMDB key for an internal tool, and a ZXP is an
// extractable zip either way, so pretending otherwise would be theatre. If it
// ever gets abused, rotate it here. (Contrast WrikeApiToken, which is a real
// secret and lives in app.settings, excluded from team profiles.)
//
// ATTRIBUTION: TMDB's terms require it. The game surface shows the line; keep
// it there.
import { https } from "../../../lib/cep/node";

const TMDB_HOST = "api.themoviedb.org";
const TMDB_KEY = "0edca0cf8b6cba2aec8b2f7a07e50fea";

export interface MovieSummary {
    id: number;
    title: string;
    year: string;
    /** TMDB's relative poster path, or "" when a film has no artwork. */
    poster: string;
}

// Poster CDN. w92 is the smallest useful size and every poster in this UI is
// rendered small, so it keeps a search result list to a few KB rather than a
// few MB. `posterUrl` returns "" for a missing path so callers can just check
// truthiness instead of building a broken <img>.
const IMAGE_BASE = "https://image.tmdb.org/t/p/";
export const posterUrl = (path: string, size: "w92" | "w154" | "w185" | "w500" = "w92"): string =>
    path ? IMAGE_BASE + size + path : "";

export type LinkRole = "cast" | "Director" | "Writer" | "Screenplay" | "Original Music Composer" | "Director of Photography";

export interface Person {
    id: number;
    name: string;
    role: LinkRole;
}

export interface MovieCredits {
    id: number;
    title: string;
    year: string;
    poster: string;
    people: Person[];
}

/**
 * The crew jobs that count as a link.
 *
 * Matches Cine2Nerdle's own rule (actors, writers, directors, composers,
 * cinematographers). COMPOSER AND CINEMATOGRAPHER ARE NOT OPTIONAL EXTRAS --
 * the first prototype omitted them and would have rejected real moves: a
 * spike against the live API found Heat -> The Insider links through Dante
 * Spinotti (Director of Photography) as well as through Al Pacino.
 */
const LINK_JOBS: string[] = ["Director", "Writer", "Screenplay", "Original Music Composer", "Director of Photography"];

/** Top-billed cast only. A link through a background extra nobody could name
 *  is technically valid and completely unsatisfying, so the list is capped. */
const CAST_DEPTH = 12;

const nodeAvailable = () => typeof (https as any)?.request === "function";

function getViaNode<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: TMDB_HOST, path, method: "GET", headers: { Accept: "application/json" } },
            (res: any) => {
                let body = "";
                res.on("data", (c: any) => { body += c; });
                res.on("end", () => {
                    let parsed: any;
                    try { parsed = JSON.parse(body); } catch { reject(new Error("TMDB returned a non-JSON response (status " + res.statusCode + ").")); return; }
                    if (res.statusCode >= 400) { reject(new Error(parsed?.status_message || ("TMDB error " + res.statusCode))); return; }
                    resolve(parsed as T);
                });
            }
        );
        req.on("error", (e: any) => reject(e instanceof Error ? e : new Error(String(e))));
        // Without this a dead network hangs the turn until the game's own
        // clock runs out, which reads as "the game froze" rather than "the
        // lookup failed".
        req.setTimeout(9000, () => req.destroy(new Error("TMDB timed out.")));
        req.end();
    });
}

async function getViaFetch<T>(path: string): Promise<T> {
    const res = await fetch("https://" + TMDB_HOST + path);
    if (!res.ok) throw new Error("TMDB error " + res.status);
    return (await res.json()) as T;
}

const get = <T>(path: string): Promise<T> => (nodeAvailable() ? getViaNode<T>(path) : getViaFetch<T>(path));

const withKey = (path: string) => path + (path.indexOf("?") === -1 ? "?" : "&") + "api_key=" + TMDB_KEY;

export async function searchMovies(query: string): Promise<MovieSummary[]> {
    if (!query.trim()) return [];
    const d = await get<any>(withKey("/3/search/movie?include_adult=false&query=" + encodeURIComponent(query)));
    return (d.results || [])
        .slice(0, 6)
        .map((m: any) => ({ id: m.id, title: m.title, year: (m.release_date || "").slice(0, 4), poster: m.poster_path || "" }));
}

// Credits never meaningfully change, so one fetch per film per session is
// plenty -- this is what keeps a validation under a second (the second film in
// a move is usually already cached from when it was played).
const creditsCache: Record<number, MovieCredits> = {};

export async function getCredits(id: number): Promise<MovieCredits> {
    if (creditsCache[id]) return creditsCache[id];
    const d = await get<any>(withKey("/3/movie/" + id + "?append_to_response=credits"));
    const people: Person[] = [];
    const seen: Record<string, boolean> = {};
    const push = (pid: number, name: string, role: LinkRole) => {
        const k = pid + "|" + role;
        if (seen[k]) return;
        seen[k] = true;
        people.push({ id: pid, name, role });
    };
    for (const c of (d.credits?.cast || []).slice(0, CAST_DEPTH)) push(c.id, c.name, "cast");
    for (const c of d.credits?.crew || []) {
        if (LINK_JOBS.indexOf(c.job) !== -1) push(c.id, c.name, c.job as LinkRole);
    }
    const out: MovieCredits = { id: d.id, title: d.title, year: (d.release_date || "").slice(0, 4), poster: d.poster_path || "", people };
    creditsCache[id] = out;
    return out;
}

/**
 * The facts the POSTER game buys hints with (arcade/PosterDaily.tsx).
 *
 * Separate from `getCredits` on purpose: that one exists to answer "who links
 * these two films" and throws away everything else, whereas this wants the
 * blurb, the tagline and the genres and doesn't care who was in it. Sharing
 * one shape would mean either fetching cast the poster game never shows or
 * bloating the chain game's cache with prose.
 *
 * Its own cache for the same reason credits are cached -- a hint bought twice
 * in one session shouldn't be a second round trip.
 */
export interface FilmFacts {
    id: number;
    title: string;
    year: string;
    poster: string;
    /** "" when TMDB has no tagline for the film, which is common enough to plan for. */
    tagline: string;
    overview: string;
    genres: string[];
    /** Minutes; 0 when unknown. */
    runtime: number;
}

const factsCache: Record<number, FilmFacts> = {};

export async function getFilmFacts(id: number): Promise<FilmFacts> {
    if (factsCache[id]) return factsCache[id];
    const d = await get<any>(withKey("/3/movie/" + id));
    const out: FilmFacts = {
        id: d.id,
        title: d.title,
        year: (d.release_date || "").slice(0, 4),
        poster: d.poster_path || "",
        tagline: d.tagline || "",
        overview: d.overview || "",
        genres: (d.genres || []).map((g: any) => g.name),
        runtime: d.runtime || 0,
    };
    factsCache[id] = out;
    return out;
}

/**
 * A well-known film to open on.
 *
 * NOT `/movie/popular`, which was the first version and was wrong in a way
 * that showed immediately: "popular" means popular RIGHT NOW, so page 1 came
 * back entirely from the current year (verified -- every one of the 20 was
 * 2026) and the same handful kept reappearing.
 *
 * `discover` sorted by vote_count DESC is the fix: most-rated ≈ most widely
 * known, and it spans decades rather than months (verified: 1971-2022 across
 * sampled pages, with a sane spread from the 70s through the 2010s). Genres
 * 99/10770 (documentary, TV movie) are excluded -- both are full of things
 * nobody could chain from -- and a vote floor keeps out obscure entries.
 *
 * POOL_PAGES x 20 results = the draw pool. At 15 that's ~300 films rather
 * than the previous 20, which is what stops the repeats.
 */
const POOL_PAGES = 15;

export async function randomStartingMovie(): Promise<MovieSummary> {
    const page = 1 + Math.floor(Math.random() * POOL_PAGES);
    const d = await get<any>(withKey(
        "/3/discover/movie?sort_by=vote_count.desc&vote_count.gte=1000&without_genres=99,10770&include_adult=false&page=" + page
    ));
    const list = (d.results || []).filter((m: any) => m.release_date);
    if (!list.length) throw new Error("TMDB returned no films to start from.");
    const m = list[Math.floor(Math.random() * list.length)];
    return { id: m.id, title: m.title, year: (m.release_date || "").slice(0, 4), poster: m.poster_path || "" };
}
