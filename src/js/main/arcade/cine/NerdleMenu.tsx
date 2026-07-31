// XYiNerdle's front menu: play solo, start a lobby and challenge someone, or
// look at the leaderboard.
//
// This is the LOBBY layer, and it now leads somewhere real: accepting (or
// opening your own) challenge mounts CineChainBattle, which syncs the actual
// turn-by-turn match through the Team Folder. The room code is the handle that
// sync hangs off.
//
// THERE IS NO PUSH ON A FILE SHARE. An "invite" is a row the other panel
// notices next time it looks -- which is when they open this menu, or on the
// poll below while it's open. That's the honest ceiling of the Team Folder
// approach (and the reason Supabase was considered and dropped -- see
// CLAUDE.md). It's fine for "fancy a game?"; it is not a doorbell, and the
// copy avoids pretending otherwise.
import { useCallback, useEffect, useState } from "react";
import { Users, Swords, Trophy, Loader2, Send, Play, RefreshCw } from "lucide-react";
import { evalTS } from "../../../lib/utils/bolt";
import "./NerdleMenu.scss";

/**
 * `seat` is the fix for the bug that made head-to-head impossible: both sides
 * previously assumed they were player 1, so both wrote player1.json and
 * neither ever saw an opponent. The rule is now fixed and obvious --
 * THE INVITER IS PLAYER 1, THE ACCEPTER IS PLAYER 2 -- and it's decided here,
 * where we actually know which end of the invite we're on.
 */
export type MenuChoice =
    | { mode: "solo" }
    | { mode: "room"; room: string; against: string; seat: 1 | 2 };

interface Invite { room: string; from: string; to: string; stamp: string; }
interface MatchResult { room: string; winner: string; loser: string; films: number; stamp: string; }

interface LobbyState {
    me: string;
    incoming: Invite[];
    outgoing: Invite[];
    results: MatchResult[];
}

// Same palette as TeamDroplet's roster, so a person is the same colour
// everywhere in the panel. Kept as its own copy rather than exported across
// files for one game -- if a third place needs it, promote it then.
const MEMBER_COLORS: Record<string, string> = {
    jacqui: "#f472b6", antonio: "#60a5fa", turk: "#ef4444", luke: "#fb923c",
    maria: "#4ade80", nicholas: "#2dd4bf", aaron: "#a78bfa",
};
const memberColor = (n: string) => MEMBER_COLORS[n.trim().toLowerCase()] || "#8a8a8a";

/** Short, unambiguous room code. No 0/O/1/I -- these get read aloud. */
const makeRoom = (): string => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 4; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return out;
};

type Tab = "play" | "board";

/** How many matches the board lists. It's a leaderboard, not a match archive. */
const RECENT_MATCHES = 8;

/**
 * Who beat whom, per player.
 *
 * `rival` is the whole point of the ask: a bare W/L column says how someone is
 * doing, not who they're doing it against. It's the opponent they've PLAYED
 * most (not the one they've beaten most) -- a rivalry is defined by how often
 * you meet, and showing "1–4 vs aaron" is more honest than only surfacing the
 * matchups someone happens to be winning.
 *
 * Pure and exported so it can be checked headlessly -- the same reason
 * battle.ts's reducer is pure. A wrong tally here is quietly unfair rather
 * than visibly broken.
 */
export interface Rival { name: string; w: number; l: number; }
export interface Standing {
    name: string;
    w: number;
    l: number;
    /** Longest chain this player has won with. 0 if they've never won. */
    best: number;
    /** Current run of the same outcome, most recent first. */
    streak: number;
    streakKind: "W" | "L" | null;
    rival: Rival | null;
}

/** Newest first. Stamps are `YYYY-MM-DD HH:MM`, so a string compare is enough. */
export const sortedResults = (rows: MatchResult[]): MatchResult[] => {
    const out = rows.filter((r) => r && r.winner && r.loser);
    out.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
    return out;
};

export const standingsFrom = (results: MatchResult[]): Standing[] => {
    const by: Record<string, Standing> = {};
    const rivals: Record<string, Record<string, Rival>> = {};
    const seed = (name: string) => {
        if (!by[name]) {
            by[name] = { name, w: 0, l: 0, best: 0, streak: 0, streakKind: null, rival: null };
            rivals[name] = {};
        }
    };
    const pair = (a: string, b: string): Rival => {
        if (!rivals[a][b]) rivals[a][b] = { name: b, w: 0, l: 0 };
        return rivals[a][b];
    };

    for (const r of results) {
        seed(r.winner);
        seed(r.loser);
        by[r.winner].w++;
        by[r.loser].l++;
        if (r.films > by[r.winner].best) by[r.winner].best = r.films;
        pair(r.winner, r.loser).w++;
        pair(r.loser, r.winner).l++;
    }

    // Streaks are counted in a second pass rather than inline: a player's run
    // only continues while EVERY match since is the same outcome, which the
    // per-row loop above can't know without tracking whether it's already
    // broken. Cheap (a leaderboard, not a log) and much easier to read.
    for (const name of Object.keys(by)) {
        let streak = 0;
        let kind: "W" | "L" | null = null;
        for (const r of results) {
            const mine = r.winner === name ? "W" : r.loser === name ? "L" : null;
            if (!mine) continue;
            if (kind === null) { kind = mine; streak = 1; continue; }
            if (mine !== kind) break;
            streak++;
        }
        by[name].streak = streak;
        by[name].streakKind = kind;

        const mine = rivals[name];
        let top: Rival | null = null;
        for (const opp of Object.keys(mine)) {
            const r = mine[opp];
            if (!top || r.w + r.l > top.w + top.l) top = r;
        }
        by[name].rival = top;
    }

    const out = Object.keys(by).map((k) => by[k]);
    out.sort((a, b) => b.w - a.w || a.l - b.l || b.best - a.best || a.name.localeCompare(b.name));
    return out;
};

// Module scope, so reopening the menu within one panel session doesn't re-run
// the NAS sweep. Reset naturally on a fresh panel open (new JS realm).
let sweptThisSession = false;

export const NerdleMenu = ({ onChoose }: { onChoose: (c: MenuChoice) => void }) => {
    const [tab, setTab] = useState<Tab>("play");
    const [roster, setRoster] = useState<string[]>([]);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            // Roster comes from the SAME source as the Team menu's member list,
            // so there's one definition of "who's in the studio".
            const profiles = await evalTS("teamListProfiles");
            const names = ((profiles as { profiles?: { name: string }[] })?.profiles || []).map((p) => p.name);
            setRoster(names);
        } catch (e) { /* no bridge / no team folder -- roster stays empty */ }
        try {
            const l = await evalTS("teamNerdleLobby");
            const r = l as Partial<LobbyState> & { success?: boolean };
            if (r && r.success) {
                setLobby({ me: r.me || "", incoming: r.incoming || [], outgoing: r.outgoing || [], results: r.results || [] });
            }
        } catch (e) { /* same -- the menu still offers solo play */ }
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Housekeeping: drop abandoned battle rooms and expired invites. ONCE per
    // panel session (module-scope guard, same pattern TeamDroplet's version/
    // sync checks use) -- it enumerates folders on the NAS, so it must not ride
    // the 15s poll. Silent either way: nobody asked for it, and an unmounted
    // share is a normal state.
    useEffect(() => {
        if (sweptThisSession) return;
        sweptThisSession = true;
        evalTS("teamArcadeSweep")
            .then(() => refresh())
            .catch(() => undefined);
    }, [refresh]);

    // Poll while the menu is open so an invite that lands mid-look appears
    // without the user hunting for a refresh button. Slow on purpose: this is
    // a NAS read, and nobody needs sub-10s latency on "fancy a game?".
    useEffect(() => {
        const id = setInterval(refresh, 15000);
        return () => clearInterval(id);
    }, [refresh]);

    /**
     * A ROOM CODE IS MINTED PER INVITE, not per menu.
     *
     * It used to be one code for the whole time the menu was open, so
     * challenging two people put both matches in the SAME room folder --
     * four player files fighting over two seats. It also meant a second
     * invite to the same person reused a code whose match had already been
     * played.
     *
     * The host has the final say on which room this ends up being: if they
     * already challenged us, it hands back THEIR room (and seat 2) rather than
     * opening a rival one, so a pair can only ever have one room going. We
     * walk straight in either way -- the ready gate is the waiting room, and
     * bouncing back to a list only invites a second click that mints a second
     * room.
     */
    const invite = async (name: string) => {
        setBusy(true);
        setNote(null);
        try {
            const res = await evalTS("teamNerdleInvite", name, makeRoom());
            if (res === undefined) throw new Error("no bridge");
            const r = res as { success?: boolean; room?: string; seat?: number; message?: string; error?: string };
            if (!r.success) { setNote(r.error || "Couldn't send that invite."); return; }
            if (r.room) {
                onChoose({ mode: "room", room: r.room, against: name, seat: r.seat === 2 ? 2 : 1 });
                return;
            }
            setNote(r.message || "Invited.");
            refresh();
        } catch (e) {
            setNote("No team folder available from here — solo still works.");
        } finally {
            setBusy(false);
        }
    };

    const results = sortedResults(lobby?.results || []);
    const standings = standingsFrom(results);

    const others = roster.filter((n) => !lobby?.me || n.toLowerCase() !== lobby.me.toLowerCase());

    return (
        <div className="nm-wrap">
            <div className="nm-tabs">
                <button className={"nm-tab" + (tab === "play" ? " nm-tab--on" : "")} onClick={() => setTab("play")}>
                    <Swords size={13} /> Play
                </button>
                <button className={"nm-tab" + (tab === "board" ? " nm-tab--on" : "")} onClick={() => setTab("board")}>
                    <Trophy size={13} /> Leaderboard
                </button>
            </div>

            {tab === "play" && (
                <>
                    <button className="nm-solo" onClick={() => onChoose({ mode: "solo" })}>
                        <Play size={15} />
                        <span className="nm-solo-text">
                            <strong>Play here</strong>
                            <small>Two seats, one keyboard — pass it back and forth</small>
                        </span>
                    </button>

                    <div className="nm-section">
                        <div className="nm-section-head">
                            <Users size={12} /> Challenge someone
                        </div>

                        {loading && <div className="nm-loading"><Loader2 size={14} className="spin" /> Reading the team folder…</div>}

                        {!loading && !lobby?.me && (
                            <p className="nm-note">
                                Tag this machine with your name in the Team menu to challenge anyone —
                                the invite needs to say who it's from.
                            </p>
                        )}

                        {!loading && lobby?.me && others.length === 0 && (
                            <p className="nm-note">No other members found in the team folder.</p>
                        )}

                        {!loading && lobby?.me && others.map((n) => (
                            <div className="nm-member" key={n}>
                                <span className="nm-dot" style={{ background: memberColor(n) }} />
                                <span className="nm-name">{n}</span>
                                <button className="nm-invite" disabled={busy} onClick={() => invite(n)}>
                                    <Send size={11} /> Invite
                                </button>
                            </div>
                        ))}

                        {!!lobby?.incoming?.length && (
                            <>
                                <div className="nm-section-head nm-section-head--sub">Waiting for you</div>
                                {lobby.incoming.map((iv) => (
                                    <div className="nm-member nm-member--invite" key={iv.room + iv.from}>
                                        <span className="nm-dot" style={{ background: memberColor(iv.from) }} />
                                        <span className="nm-name">{iv.from} <em>· {iv.stamp}</em></span>
                                        <button className="nm-invite nm-invite--accept" onClick={() => onChoose({ mode: "room", room: iv.room, against: iv.from, seat: 2 })}>
                                            Accept
                                        </button>
                                    </div>
                                ))}
                            </>
                        )}

                        {/* The inviter has to be able to walk into their OWN room.
                            Previously only "Accept" led anywhere, so whoever sent
                            the challenge had no way to join the game they'd just
                            started. They enter as seat 1. */}
                        {!!lobby?.outgoing?.length && (
                            <>
                                <div className="nm-section-head nm-section-head--sub">Your challenges</div>
                                {lobby.outgoing.map((o) => (
                                    <div className="nm-member" key={o.room + o.to}>
                                        <span className="nm-dot" style={{ background: memberColor(o.to) }} />
                                        <span className="nm-name">{o.to} <em>· room {o.room}</em></span>
                                        <button
                                            className="nm-invite nm-invite--accept"
                                            onClick={() => onChoose({ mode: "room", room: o.room, against: o.to, seat: 1 })}
                                        >
                                            Open room
                                        </button>
                                    </div>
                                ))}
                                <p className="nm-note nm-note--sent">
                                    They'll see the challenge next time they open this menu.
                                </p>
                            </>
                        )}

                        {note && <p className="nm-note nm-note--msg">{note}</p>}
                    </div>
                </>
            )}

            {tab === "board" && (
                <div className="nm-section">
                    <div className="nm-section-head">
                        <Trophy size={12} /> Standings
                        <button className="nm-refresh" onClick={refresh} title="Refresh"><RefreshCw size={11} /></button>
                    </div>
                    {loading && <div className="nm-loading"><Loader2 size={14} className="spin" /> Loading…</div>}
                    {!loading && !standings.length && (
                        <p className="nm-note">No matches recorded yet. Win a head-to-head and it'll show up here.</p>
                    )}
                    {standings.map((s) => (
                        <div className="nm-stand" key={s.name} style={{ borderLeftColor: memberColor(s.name) }}>
                            <div className="nm-stand-top">
                                <span className="nm-dot" style={{ background: memberColor(s.name) }} />
                                <span className="nm-name">{s.name}</span>
                                {s.streakKind && s.streak > 1 && (
                                    <span className={"nm-streak nm-streak--" + s.streakKind.toLowerCase()}>
                                        {s.streak}{s.streakKind} run
                                    </span>
                                )}
                                <span className="nm-record">{s.w}W · {s.l}L</span>
                            </div>
                            <div className="nm-stand-sub">
                                {s.best > 0 && <span>best chain {s.best}</span>}
                                {s.rival && (
                                    <span>
                                        vs <b style={{ color: memberColor(s.rival.name) }}>{s.rival.name}</b>{" "}
                                        {s.rival.w}–{s.rival.l}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* The literal "who beat who": standings tell you how
                        someone is doing, this tells you what actually
                        happened, newest first. */}
                    {!!results.length && (
                        <>
                            <div className="nm-section-head nm-section-head--sub">Recent matches</div>
                            {results.slice(0, RECENT_MATCHES).map((r, i) => (
                                <div className="nm-match" key={r.stamp + r.winner + r.loser + i}>
                                    <span className="nm-dot" style={{ background: memberColor(r.winner) }} />
                                    <span className="nm-match-text">
                                        <b style={{ color: memberColor(r.winner) }}>{r.winner}</b> beat{" "}
                                        <b style={{ color: memberColor(r.loser) }}>{r.loser}</b>
                                    </span>
                                    <span className="nm-match-meta">{r.films} films · {r.stamp}</span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            )}

            <p className="nm-foot">
                Challenges arrive when the other panel next looks — there's no notification on a
                file share, so nudge them if you're in a hurry.
            </p>
        </div>
    );
};

export default NerdleMenu;
