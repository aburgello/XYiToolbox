// =============================================================================
// src/js/main/tools/WrikeTasks.tsx
// -----------------------------------------------------------------------------
// See wrikeApi.ts's header for why this goes over Node's https module
// instead of fetch(), and hooks/useWrikeTasks.ts's header for why the data
// layer is a plain hook.
//
// A standalone full page, NOT embedded on the home screen -- HomeScreen.tsx
// just has a full-width "Your Wrike" launch button (below the four category
// cards) that navigates here, same pattern DeliveryHub/ReviewHub already use
// for skipping the category master-detail screen. Still a real TOOLS entry
// (toolRegistry.tsx, categories: []) so it's also reachable via search/⌘K,
// same "lives outside any category list but still searchable" pattern
// Useful Folders uses for its own home-screen flyout.
//
// "Folders in the description" from the original ask: answered as the
// "Links" section below -- a folder mentioned in a task's description is
// almost always a Wrike-inserted link, which extractLinks() (wrikeApi.ts)
// pulls out. Description is reduced to plain text + a separate link list,
// never rendered as raw HTML -- see wrikeApi.ts's header for why.
// =============================================================================
import React, { useMemo, useState } from "react";
import { KeyRound, RefreshCw, ChevronDown, ChevronRight, Paperclip, ListChecks, ExternalLink, FileText, CalendarClock, AlignLeft, Link2 } from "lucide-react";
import { useWrikeTasks, type WrikeTaskDetailState } from "../hooks/useWrikeTasks";
import type { WrikeTask } from "../../lib/utils/wrikeApi";
import type { ToolProps } from "../toolRegistry";
import CheckboxToggle from "../CheckboxToggle";
import "../shared.scss";
import "./formTool.scss";
import "./WrikeTasks.scss";

const SUBTASKS_COLLAPSED_LIMIT = 4;

// Local (not UTC) YYYY-MM-DD -- toISOString() would shift the date by the
// user's timezone offset, which can silently land on the wrong day for
// anyone not at UTC+0 (e.g. 11pm local could already read as tomorrow's
// UTC date).
function localDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Wrike's dates.due comes back as either a plain "YYYY-MM-DD" (Milestone/
// Planned tasks with no specific time) or a full ISO datetime (Backlog
// tasks) -- the first 10 characters are the date either way.
function taskDueDateStr(task: WrikeTask): string | null {
    const due = task.dates?.due;
    return due ? due.slice(0, 10) : null;
}

function statusPillClass(status: string): string {
    const s = (status || "").toLowerCase();
    if (s === "completed") return "wrike-status-pill wrike-status-pill--completed";
    if (s === "deferred") return "wrike-status-pill wrike-status-pill--deferred";
    if (s === "cancelled") return "wrike-status-pill wrike-status-pill--cancelled";
    return "wrike-status-pill wrike-status-pill--active";
}

function isPdf(a: { contentType: string; name: string }) {
    return (a.contentType || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(a.name || "");
}

function initials(firstName: string, lastName: string): string {
    return ((firstName?.[0] || "") + (lastName?.[0] || "")).toUpperCase() || "?";
}

interface TaskCardProps {
    task: WrikeTask;
    dueLabel: string | null;
    expanded: boolean;
    detail: WrikeTaskDetailState | undefined;
    onToggle: () => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, dueLabel, expanded, detail, onToggle }) => {
    const [showAllSubtasks, setShowAllSubtasks] = useState(false);
    const attachmentCount = detail && !detail.loading && detail.error === null ? detail.attachments.filter(isPdf).length : undefined;
    const subtaskCount = task.subTaskIds?.length ?? 0;

    return (
        <div className={"wrike-task-card" + ((task.status || "").toLowerCase() === "active" ? " wrike-task-card--active" : "")}>
            <button className="wrike-task-row" onClick={onToggle}>
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="wrike-task-title">{task.title}</span>
                <span className="wrike-task-meta">
                    {dueLabel && (
                        <span className={"wrike-due-chip" + (dueLabel === "Today" ? " wrike-due-chip--today" : "")}>
                            <CalendarClock size={10} /> {dueLabel}
                        </span>
                    )}
                    {subtaskCount > 0 && (
                        <span className="wrike-count-chip"><ListChecks size={10} /> {subtaskCount}</span>
                    )}
                    {attachmentCount !== undefined && attachmentCount > 0 && (
                        <span className="wrike-count-chip"><Paperclip size={10} /> {attachmentCount}</span>
                    )}
                    <span className={statusPillClass(task.status)}>{task.status}</span>
                </span>
                <a
                    className="wrike-task-link"
                    href={task.permalink}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Open in Wrike"
                >
                    <ExternalLink size={12} />
                </a>
            </button>

            {expanded && (
                <div className="wrike-task-body">
                    {(!detail || detail.loading) && <p className="wrike-detail-loading">Loading description, attachments, and subtasks…</p>}
                    {detail && !detail.loading && detail.error !== null && <p className="wrike-inline-error">{detail.error}</p>}
                    {detail && !detail.loading && detail.error === null && (
                        <>
                            <div className="wrike-detail-section">
                                <div className="wrike-detail-label"><AlignLeft size={11} /> Description</div>
                                {detail.descriptionText ? (
                                    <p className="wrike-description-text">{detail.descriptionText}</p>
                                ) : (
                                    <span className="wrike-detail-empty">No description</span>
                                )}
                                {detail.descriptionLinks.length > 0 && (
                                    <div className="wrike-links-list">
                                        {detail.descriptionLinks.map((l, i) => (
                                            <a key={i} className="wrike-link-row" href={l.href} target="_blank" rel="noreferrer">
                                                <Link2 size={11} /> {l.text}
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="wrike-detail-section">
                                <div className="wrike-detail-label"><Paperclip size={11} /> PDF Attachments</div>
                                {detail.attachments.filter(isPdf).length === 0 ? (
                                    <span className="wrike-detail-empty">None</span>
                                ) : (
                                    detail.attachments.filter(isPdf).map((a) => (
                                        <div className="wrike-attachment-row" key={a.id}>
                                            <FileText size={12} /> {a.name}
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="wrike-detail-section">
                                <div className="wrike-detail-label"><ListChecks size={11} /> Subtasks</div>
                                {detail.subtasks.length === 0 ? (
                                    <span className="wrike-detail-empty">None</span>
                                ) : (
                                    <>
                                        {(showAllSubtasks ? detail.subtasks : detail.subtasks.slice(0, SUBTASKS_COLLAPSED_LIMIT)).map((s) => (
                                            <div className="wrike-subtask-row" key={s.id}>
                                                <span>{s.title}</span>
                                                <span className={statusPillClass(s.status)}>{s.status}</span>
                                            </div>
                                        ))}
                                        {detail.subtasks.length > SUBTASKS_COLLAPSED_LIMIT && (
                                            <button className="wrike-show-more" onClick={() => setShowAllSubtasks((v) => !v)}>
                                                {showAllSubtasks ? "Show less" : `+${detail.subtasks.length - SUBTASKS_COLLAPSED_LIMIT} more`}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

// Extends ToolProps (not just its own {}) so this still satisfies
// toolRegistry.tsx's `Component: React.LazyExoticComponent<React.ComponentType<ToolProps>>`
// -- onSelectTool is accepted (like every other TOOLS entry) but unused here.
type Props = ToolProps;

const WrikeTasks: React.FC<Props> = () => {
    const { token, setToken, connecting, connectError, me, tasks, tasksLoading, tasksError, connect, refresh, loadTaskDetail } = useWrikeTasks();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [details, setDetails] = useState<Record<string, WrikeTaskDetailState>>({});
    // Defaults ON -- narrowing to what's due today/tomorrow is the whole
    // point of this view; flip off to see every active assigned task.
    const [dueSoonOnly, setDueSoonOnly] = useState(true);

    // Recomputed every render (not just on mount) so this stays correct if
    // the panel is left open across midnight -- cheap enough not to matter.
    const { today, tomorrow } = useMemo(() => {
        const now = new Date();
        const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return { today: localDateStr(now), tomorrow: localDateStr(tmrw) };
    }, []);

    const dueLabelFor = (task: WrikeTask): string | null => {
        const d = taskDueDateStr(task);
        if (d === today) return "Today";
        if (d === tomorrow) return "Tomorrow";
        return null;
    };

    const visibleTasks = dueSoonOnly ? tasks.filter((t) => dueLabelFor(t) !== null) : tasks;

    const toggleExpand = async (task: WrikeTask) => {
        if (expandedId === task.id) {
            setExpandedId(null);
            return;
        }
        setExpandedId(task.id);
        if (details[task.id]) return;

        setDetails((prev) => ({ ...prev, [task.id]: { loading: true, error: null } }));
        try {
            const detail = await loadTaskDetail(task);
            setDetails((prev) => ({ ...prev, [task.id]: { loading: false, error: null, ...detail } }));
        } catch (e: any) {
            setDetails((prev) => ({ ...prev, [task.id]: { loading: false, error: e?.message || "Failed to load task details." } }));
        }
    };

    return (
        <div className="form-tool wrike">
            <h3>Connect</h3>
            <p className="hint">
                Paste a Wrike permanent API token. This panel talks to Wrike directly over
                Node (not a browser fetch), so it only works inside a real After Effects
                session -- not in browser preview.
            </p>

            <div className="field-with-button">
                <div className="field-row">
                    <label htmlFor="wrike-token">API Token</label>
                    <input
                        id="wrike-token"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Paste your Wrike permanent token"
                        autoComplete="off"
                    />
                </div>
                <button disabled={connecting || !token.trim()} onClick={() => connect(token)}>
                    <KeyRound size={14} /> {connecting ? "Connecting…" : "Connect"}
                </button>
            </div>

            {connectError && <p className="wrike-inline-error">{connectError}</p>}

            {me && (
                <div className="wrike-user-chip">
                    <span className="wrike-user-avatar">{initials(me.firstName, me.lastName)}</span>
                    Signed in as <strong>{me.firstName} {me.lastName}</strong>
                </div>
            )}

            {me && (
                <>
                    <h3>My Active Tasks</h3>
                    <div className="button-row">
                        <button disabled={tasksLoading} onClick={refresh}>
                            <RefreshCw size={14} /> {tasksLoading ? "Loading…" : "Refresh"}
                        </button>
                        <CheckboxToggle
                            checked={dueSoonOnly}
                            onChange={setDueSoonOnly}
                            label="Due today/tomorrow"
                            title="Show only tasks due today or tomorrow"
                            className="wrike-due-toggle"
                        />
                    </div>

                    <div className="wrike-task-list">
                        {tasksError && <p className="wrike-inline-error">{tasksError}</p>}
                        {!tasksLoading && !tasksError && visibleTasks.length === 0 && (
                            <p className="wrike-empty">
                                {tasks.length === 0
                                    ? "No active tasks assigned to you were found."
                                    : dueSoonOnly
                                        ? "Nothing due today or tomorrow."
                                        : "No active tasks assigned to you were found."}
                            </p>
                        )}
                        {visibleTasks.map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                dueLabel={dueLabelFor(task)}
                                expanded={expandedId === task.id}
                                detail={details[task.id]}
                                onToggle={() => toggleExpand(task)}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default WrikeTasks;
