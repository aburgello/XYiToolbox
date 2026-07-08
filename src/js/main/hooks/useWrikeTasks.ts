// =============================================================================
// src/js/main/hooks/useWrikeTasks.ts
// -----------------------------------------------------------------------------
// Token/connection/task-list state for the Wrike Tasks feature. Home now
// only has a launch button (HomeScreen.tsx) that navigates to the full page
// (tools/WrikeTasks.tsx) -- this hook is only ever mounted there, but stays
// a separate file/hook rather than inlined, same reasoning
// TimeTrackerDroplet.tsx / TimesheetTracker.tsx split their data layer
// (useTimeTracker.ts) from presentation even though today only one consumer
// exists per mount.
// =============================================================================
import { useCallback, useEffect, useState } from "react";
import { evalTS } from "../../lib/utils/bolt";
import {
    wrikeGetMe,
    wrikeGetAssignedTasks,
    wrikeGetAttachments,
    wrikeGetTasksByIds,
    wrikeGetTaskDescription,
    extractPlainText,
    extractLinks,
    type WrikeUser,
    type WrikeTask,
    type WrikeAttachment,
    type WrikeDescriptionLink,
} from "../../lib/utils/wrikeApi";

export interface WrikeTaskDetail {
    attachments: WrikeAttachment[];
    subtasks: WrikeTask[];
    descriptionText: string;
    descriptionLinks: WrikeDescriptionLink[];
}

// Discriminated on `loading`/`error` (not a loose Partial<WrikeTaskDetail>)
// so consumers can narrow with `detail.error === null` and get real
// attachments/subtasks typing back, rather than "possibly undefined" on
// every field regardless of state.
export type WrikeTaskDetailState =
    | { loading: true; error: null }
    | ({ loading: false; error: null } & WrikeTaskDetail)
    | { loading: false; error: string };

export function useWrikeTasks() {
    const [token, setToken] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const [me, setMe] = useState<WrikeUser | null>(null);

    const [tasks, setTasks] = useState<WrikeTask[]>([]);
    const [tasksLoading, setTasksLoading] = useState(false);
    const [tasksError, setTasksError] = useState<string | null>(null);

    // Pre-fill (not auto-connect) a previously saved token -- same "load
    // quietly, act on user click" pattern every other saved preference in
    // this app follows.
    useEffect(() => {
        (async () => {
            try {
                const saved = await evalTS("loadWrikeApiToken");
                if (typeof saved === "string" && saved) setToken(saved);
            } catch { /* preview -- no bridge */ }
        })();
    }, []);

    const fetchTasks = useCallback(async (activeToken: string, userId: string) => {
        setTasksLoading(true);
        setTasksError(null);
        try {
            setTasks(await wrikeGetAssignedTasks(activeToken, userId));
        } catch (e: any) {
            setTasksError(e?.message || "Failed to load tasks.");
        } finally {
            setTasksLoading(false);
        }
    }, []);

    const connect = useCallback(async (tokenToUse: string) => {
        const trimmed = tokenToUse.trim();
        if (!trimmed) return;
        setConnecting(true);
        setConnectError(null);
        setMe(null);
        setTasks([]);
        try {
            const user = await wrikeGetMe(trimmed);
            setMe(user);
            evalTS("saveWrikeApiToken", trimmed).catch(() => { /* preview -- no bridge */ });
            await fetchTasks(trimmed, user.id);
        } catch (e: any) {
            setConnectError(e?.message || "Couldn't connect to Wrike with that token.");
        } finally {
            setConnecting(false);
        }
    }, [fetchTasks]);

    const refresh = useCallback(() => {
        if (me) fetchTasks(token.trim(), me.id);
    }, [me, token, fetchTasks]);

    const loadTaskDetail = useCallback(async (task: WrikeTask): Promise<WrikeTaskDetail> => {
        const [attachments, subtasks, descriptionHtml] = await Promise.all([
            wrikeGetAttachments(token.trim(), task.id),
            task.subTaskIds && task.subTaskIds.length ? wrikeGetTasksByIds(token.trim(), task.subTaskIds) : Promise.resolve([]),
            wrikeGetTaskDescription(token.trim(), task.id),
        ]);
        return {
            attachments,
            subtasks,
            descriptionText: extractPlainText(descriptionHtml),
            descriptionLinks: extractLinks(descriptionHtml),
        };
    }, [token]);

    return { token, setToken, connecting, connectError, me, tasks, tasksLoading, tasksError, connect, refresh, loadTaskDetail };
}
