// =============================================================================
// src/js/main/tools/AgentChat.tsx
// -----------------------------------------------------------------------------
// ASK — a read-only agent over three existing backend scans.
//
// The prototype described in docs/AGENT-THREE-TOOL-PROTOTYPE.md. It exists to
// answer one question end to end ("which masters have no render yet?") by
// chaining two tool calls, and thereby to find out whether an agent over this
// backend is worth building properly. It is not a shipped feature.
//
// It reads. It cannot write, build, render, localise or delete, and the three
// tools it holds are the entire surface -- see lib/agent/tools.ts.
//
// TESTING: run `node scripts/make-test-masters.cjs` and point it at the
// generated tree. No real campaign names, no client creative, so AI Policy
// §2.1 does not bite while you are prototyping. Real campaigns go through an
// approved tool only.
// =============================================================================
import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Send, KeyRound, Loader2, CornerDownLeft } from "lucide-react";
import StatusIcon from "../StatusIcon";
import { ask, type Step } from "../lib/agent/loop";
import { buildContextLine } from "../lib/agent/context";
import { getApiKey, setApiKey, getProvider, setProvider, PROVIDERS } from "../lib/agent/provider";
import "../shared.scss";
import "./formTool.scss";
import "./AgentChat.scss";

const EXAMPLES = [
    "Which masters in ODY have no render yet?",
    "How many masters are in ODY?",
    "What campaigns do we have?",
];

interface Turn {
    question: string;
    steps: Step[];
    answer: string;
    error?: string;
    costUsd: number;
    /**
     * This turn's raw messages, kept so the NEXT question can see it. Whole
     * turns only -- see AskResult.messages for why they must not be sliced.
     * Absent on a turn that errored, which never produced a valid exchange.
     */
    messages?: any[];
}

/**
 * How many previous turns travel with a new question.
 *
 * Not unlimited: tool results are re-sent in full on every later call, so a
 * long session would pay for the whole masters list again on each question --
 * and the panel has a running cost readout precisely because somebody notices.
 * Six is enough for "that job" / "the second one" / "no, the portrait one",
 * which is what a follow-up actually reaches back for.
 */
const HISTORY_TURNS = 6;

interface Props {
    /**
     * Bumped by the host to say "you were just shown" -- the panel stays
     * mounted while hidden (so the transcript survives), so there is no mount
     * event to hang focus off.
     */
    focusKey?: number;
    /**
     * A node in the SURROUNDING header to render the key button and the running
     * cost into. The bubble is a small floating panel and those two took a full
     * row of it to say "key set" and a number -- both are status, and status
     * belongs on the title bar that is already there.
     *
     * Portalled rather than lifted: cost is derived from `turns` and the key
     * state is this component's, so hoisting them into AgentBubble would move
     * three pieces of state up to reposition two elements. Same pattern Tooltip
     * and Dialog already use here.
     *
     * Optional on purpose. With no slot the controls render inline exactly as
     * before, so this component still stands on its own.
     */
    headerSlot?: HTMLElement | null;
}

const AgentChat: React.FC<Props> = ({ focusKey, headerSlot }) => {
    const [question, setQuestion] = useState("");
    const [turns, setTurns] = useState<Turn[]>([]);
    const [live, setLive] = useState<Step[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [keyOpen, setKeyOpen] = useState(false);
    const [keyDraft, setKeyDraft] = useState("");
    const [hasKey, setHasKey] = useState(false);
    // WHICH SERVICE THIS PANEL TALKS TO. A testing facility: Anthropic is the
    // default and nothing here changes unless somebody opens the key panel and
    // picks something else.
    const [providerId, setProviderId] = useState(() => getProvider().id);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const askRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => { setHasKey(!!getApiKey()); }, []);

    // KEEP THE CARET IN THE ASK BOX. Focus on being shown, and again once an
    // answer lands, so a follow-up is always just typing -- without this you
    // have to click back into the field after every single turn.
    //
    // rAF because the panel animates in: focusing a still-hidden element is a
    // no-op in Chromium, and the CEP host is fussier about it than a browser.
    useEffect(() => {
        if (busy) return;
        const id = requestAnimationFrame(() => askRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [focusKey, busy, turns.length]);

    // Keep the newest turn in view as steps stream in.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns, live]);

    /**
     * Switching service switches KEY, because they are different accounts.
     * Reading the new provider's own stored key back is what stops "I set a key
     * and it still says no key" -- and stops the Anthropic key being sent to
     * DeepSeek, which 401s in a way that reads like the endpoint is broken.
     */
    const switchProvider = (id: string) => {
        setProvider(id);
        setProviderId(id);
        setKeyDraft("");
        const existing = getApiKey();
        setHasKey(!!existing);
        const p = PROVIDERS.filter((x) => x.id === id)[0];
        setStatus({
            type: existing ? "success" : "error",
            text: existing
                ? `Talking to ${p?.label}. Its key is already saved here.`
                : `Talking to ${p?.label}. Paste that service's key — the other one won't work.`,
        });
    };

    const saveKey = () => {
        setApiKey(keyDraft);
        setHasKey(!!keyDraft.trim());
        setKeyDraft("");
        setKeyOpen(false);
        setStatus({ type: "success", text: "Key saved to this machine only." });
    };

    const send = async (q?: string) => {
        const text = (q ?? question).trim();
        if (!text || busy) return;
        setBusy(true);
        setStatus(null);
        setQuestion("");
        const collected: Step[] = [];
        setLive([]);

        try {
            // Whole turns, oldest dropped first. Concatenating complete turns is
            // what keeps every tool_use next to its tool_result -- trimming by
            // message count would eventually orphan one and the API would
            // reject the request outright.
            const history = turns
                .filter((t) => t.messages && t.messages.length)
                .slice(-HISTORY_TURNS)
                .reduce<any[]>((acc, t) => acc.concat(t.messages as any[]), []);

            // GATHERED HERE, at send time, and appended to the question rather
            // than folded into the system prompt -- see context.ts for why the
            // cached prefix must not move. The artist's own words are what the
            // transcript stores; this rides along only in what is sent.
            const context = await buildContextLine();

            const res = await ask(text + context, (s) => {
                collected.push(s);
                setLive([...collected]);
            }, history);
            setTurns((t) => [...t, {
                question: text,
                steps: res.steps,
                answer: res.answer,
                costUsd: res.costUsd,
                messages: res.messages,
            }]);
        } catch (e: any) {
            setTurns((t) => [...t, {
                question: text,
                steps: collected,
                answer: "",
                error: e?.message || "Something went wrong.",
                costUsd: 0,
            }]);
        } finally {
            setLive(null);
            setBusy(false);
        }
    };

    const sessionCost = turns.reduce((n, t) => n + t.costUsd, 0);

    const headerControls = (
        <>
            {sessionCost > 0 && (
                <span className="agentchat-cost" title="Estimated spend this session">
                    ≈ ${sessionCost.toFixed(3)}
                </span>
            )}
            <button
                className={"agentchat-keybtn" + (headerSlot ? " agentchat-keybtn--icon" : "") + (hasKey ? " is-set" : "")}
                onClick={() => setKeyOpen((v) => !v)}
                title={hasKey ? "An API key is set on this machine — click to change it" : "No API key set yet — click to add one"}
                aria-label={hasKey ? "Change the API key" : "Set an API key"}
            >
                <KeyRound size={14} />
                {!headerSlot && <span>{hasKey ? "API key set" : "Set API key"}</span>}
            </button>
        </>
    );

    return (
        <div className="form-tool agentchat">

            {/* IN THE HEADER WHERE THERE IS ONE. Key state and spend are both
                status about the session rather than things you do to it, and in
                a panel this small they were costing a whole row of transcript to
                say so. The button is the KEY ALONE up there -- what it is for is
                carried by the icon and its tooltip, and the words "API key set"
                were the widest thing in the strip. It still expands the same row
                below, which is where the input and the save have to live. */}
            {headerSlot
                ? createPortal(headerControls, headerSlot)
                : <div className="button-row">{headerControls}</div>}

            {keyOpen && PROVIDERS.length > 1 && (
                <div className="agentchat-keyrow">
                    <select
                        className="agentchat-provider"
                        value={providerId}
                        onChange={(e) => switchProvider(e.target.value)}
                        aria-label="Which service to call"
                    >
                        {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {keyOpen && getProvider().note && (
                <p className="agentchat-provider-note">{getProvider().note}</p>
            )}

            {keyOpen && (
                <div className="agentchat-keyrow">
                    <input
                        type="password"
                        placeholder="Paste an API key — stored on this machine only, never on the team share"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
                    />
                    <button onClick={saveKey} disabled={!keyDraft.trim()}>Save</button>
                </div>
            )}

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            <div className="agentchat-scroll" ref={scrollRef}>
                {turns.length === 0 && !live && (
                    <div className="agentchat-empty">
                        <p className="agentchat-empty-title">Ask about the master library.</p>
                        <p className="agentchat-empty-body">
                            Read-only — it can list campaigns, list masters, and check which have renders.
                            It cannot change anything.
                        </p>
                        <div className="agentchat-examples">
                            {EXAMPLES.map((ex) => (
                                <button key={ex} className="agentchat-example" onClick={() => send(ex)}>
                                    {ex}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {turns.map((t, i) => (
                    <div className="agentchat-turn" key={i}>
                        <div className="agentchat-q"><CornerDownLeft size={12} /> {t.question}</div>
                        {t.steps.map((s, j) => (
                            <div className={"agentchat-step" + (s.ok ? "" : " is-fail")} key={j}>
                                <span className="agentchat-step-name">{s.name}</span>
                                <span className="agentchat-step-detail">{s.detail}</span>
                            </div>
                        ))}
                        {t.error
                            ? <div className="loc-status loc-status-error"><StatusIcon type="error" /><span>{t.error}</span></div>
                            : <div className="agentchat-a">{t.answer}</div>}
                    </div>
                ))}

                {live && (
                    <div className="agentchat-turn agentchat-turn--live">
                        {live.map((s, j) => (
                            <div className={"agentchat-step" + (s.ok ? "" : " is-fail")} key={j}>
                                <span className="agentchat-step-name">{s.name}</span>
                                <span className="agentchat-step-detail">{s.detail}</span>
                            </div>
                        ))}
                        <div className="agentchat-thinking">
                            <Loader2 size={13} className="agentchat-spin" /> working…
                        </div>
                    </div>
                )}
            </div>

            {/* The bordered surface is the WRAPPER, with a bare transparent
                input inside — the same shape as .search-box in main.scss.
                Styling the input directly is what made this look like an
                unstyled form control dropped into the panel. */}
            <div className="agentchat-ask">
                <div className={"agentchat-askbox" + (busy ? " is-busy" : "")}>
                    <input
                        ref={askRef}
                        type="text"
                        placeholder="Ask about campaigns, masters or renders…"
                        value={question}
                        disabled={busy}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                    />
                    <button
                        className="agentchat-send"
                        onClick={() => send()}
                        disabled={busy || !question.trim()}
                        title="Ask"
                        aria-label="Ask"
                    >
                        <Send size={14} />
                    </button>
                </div>
            </div>

        </div>
    );
};

export default AgentChat;
