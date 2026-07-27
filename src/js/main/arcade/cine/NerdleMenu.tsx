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

export const NerdleMenu = ({ onChoose }: { onChoose: (c: MenuChoice) => void }) => {
    const [tab, setTab] = useState<Tab>("play");
    const [roster, setRoster] = useState<string[]>([]);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [room] = useState(makeRoom);

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

    // Poll while the menu is open so an invite that lands mid-look appears
    // without the user hunting for a refresh button. Slow on purpose: this is
    // a NAS read, and nobody needs sub-10s latency on "fancy a game?".
    useEffect(() => {
        const id = setInterval(refresh, 15000);
        return () => clearInterval(id);
    }, [refresh]);

    const invite = async (name: string) => {
        setBusy(true);
        setNote(null);
        try {
            const res = await evalTS("teamNerdleInvite", name, room);
            if (res === undefined) throw new Error("no bridge");
            const r = res as { success?: boolean; message?: string; error?: string };
            setNote(r.success ? r.message || "Invited." : r.error || "Couldn't send that invite.");
            if (r.success) refresh();
        } catch (e) {
            setNote("No team folder available from here — solo still works.");
        } finally {
            setBusy(false);
        }
    };

    // Win/loss table, newest results first.
    const standings = (() => {
        const by: Record<string, { name: string; w: number; l: number }> = {};
        for (const r of lobby?.results || []) {
            if (!r || !r.winner) continue;
            if (!by[r.winner]) by[r.winner] = { name: r.winner, w: 0, l: 0 };
            if (!by[r.loser]) by[r.loser] = { name: r.loser, w: 0, l: 0 };
            by[r.winner].w++;
            by[r.loser].l++;
        }
        const out = Object.keys(by).map((k) => by[k]);
        out.sort((a, b) => b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));
        return out;
    })();

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
                            <span className="nm-room">room {room}</span>
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
                        <div className="nm-member" key={s.name}>
                            <span className="nm-dot" style={{ background: memberColor(s.name) }} />
                            <span className="nm-name">{s.name}</span>
                            <span className="nm-record">{s.w}W · {s.l}L</span>
                        </div>
                    ))}
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
