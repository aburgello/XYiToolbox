// =============================================================================
// src/js/main/screens/HomeMacroCards.tsx
// -----------------------------------------------------------------------------
// The four category cards, LIVE. They used to be four labels; each now answers
// "is there anything for me in here" before it is pressed:
//
//   Localise -- where the open project sits (territory · batch) and how many of
//               your Wrike jobs are ready to localise.
//   Review   -- how many of your subtasks are Revised: made, waiting for eyes.
//   Deliver  -- your jobs in Prep for delivery, by territory and batch.
//   Tools    -- the tool you last picked there, which the card opens straight.
//
// Everything comes from what the panel already has: the jobs feed (cached,
// revalidated at most once per two minutes panel-wide -- fetchJobsFresh) and
// the open project's path. Nothing here is required: an untagged machine or a
// feed that can't be reached leaves a card as the plain label it always was.
//
// THREE LAYOUTS, chosen in the home screen's Arrange mode: a row of four (the
// default), a 2x2 grid of wider cards, or a slim bar.
// =============================================================================
import React, { useEffect, useState } from "react";
import { motion, type Transition } from "motion/react";
import { evalTS } from "../../lib/utils/bolt";
import { CATEGORIES, TOOLS, categoryStyleVars, prefetchTool } from "../toolRegistry";
import { iconWiggle, categoryLift } from "../animations";
import { fetchJobsFresh, jobReadiness, parseJobTitle, REVISED_STATUSES, type WrikeJob, type JobsFeedResult } from "../lib/jobsFeed";
import { isDeliverable, jobTerritory } from "../tools/DeliveryJobs";
import { lastToolIn, type CardsLayout } from "../lib/homeLayout";
import { sfx } from "../../lib/utils/sfx";
import type { Screen } from "../main";

interface Signal {
    /** One short line under the label; "" shows the plain card. */
    line: string;
    /** A count worth a badge; 0 shows none. */
    count: number;
    /** What the badge counts, for its tooltip. */
    countOf?: string;
}

/** "…/Chile/AE/Batch_02/x.aep" -> "Chile · Batch_02"; "" off the markets tree. */
export function hereFromProjectPath(p: string | null | undefined): string {
    const parts = String(p || "").split(/[\\/]/).filter(Boolean);
    for (let i = parts.length - 2; i > 0; i--) {
        if (parts[i].toUpperCase() !== "AE") continue;
        const territory = parts[i - 1].replace(/_/g, " ");
        const next = i + 1 < parts.length - 1 ? parts[i + 1] : "";
        return /^batch/i.test(next) ? territory + " · " + next : territory;
    }
    return "";
}

/** The four signals, from the jobs this machine's owner is on. */
export function signalsFrom(jobs: WrikeJob[], owner: string, here: string, lastTool: string): Record<string, Signal> {
    const mine = jobs.filter((j) => !owner || j.assignee === owner);
    const ready = mine.filter((j) => jobReadiness(j.status) === "ready" && (j.subtasksDone ?? 0) < (j.subtaskCount ?? 1)).length;
    let revised = 0;
    for (const j of mine) for (const st of j.subtasks || []) if (REVISED_STATUSES.test(st.customStatusName || "")) revised++;
    const deliver = mine.filter((j) => isDeliverable(j));
    const deliverLabels = deliver.map((j) => {
        const b = parseJobTitle(j.title).batch.replace(/^batch\s*/i, "");
        return [jobTerritory(j), b].filter(Boolean).join(" ");
    });
    const tool = TOOLS.find((t) => t.id === lastTool);
    return {
        localise: {
            line: [here, ready ? `${ready} job${ready === 1 ? "" : "s"} ready` : ""].filter(Boolean).join(" · "),
            count: ready,
            countOf: "Wrike jobs ready to localise",
        },
        review: { line: revised ? `${revised} revised to review` : "", count: revised, countOf: "subtasks Revised in Wrike" },
        deliver: {
            line: deliverLabels.slice(0, 3).join(" · ") + (deliverLabels.length > 3 ? ` +${deliverLabels.length - 3}` : ""),
            count: deliver.length,
            countOf: "jobs in Prep for delivery",
        },
        tools: { line: tool ? `Last: ${tool.label}` : "", count: 0 },
    };
}

const PREFETCH: Record<string, string> = { deliver: "delivery-hub", review: "review-hub", localise: "campaign-localiser", tools: "random-layers" };

interface Props {
    layout: CardsLayout;
    onNavigate: (screen: Screen) => void;
}

const HomeMacroCards: React.FC<Props> = ({ layout, onNavigate }) => {
    const [signals, setSignals] = useState<Record<string, Signal>>({});

    useEffect(() => {
        let dead = false;
        (async () => {
            let owner = "";
            let here = "";
            try {
                const state = (await evalTS("teamGetMachineState")) as { owner?: string } | undefined;
                owner = (state && state.owner) || "";
            } catch { /* untagged */ }
            try {
                const f = (await evalTS("timesheetActiveFile")) as { path?: string | null } | undefined;
                here = hereFromProjectPath(f && f.path);
            } catch { /* no project */ }
            const apply = (res: JobsFeedResult) => {
                if (dead) return;
                // Sample jobs (feed unreachable) are never counted as real work.
                const jobs = res.mock ? [] : res.jobs;
                setSignals(signalsFrom(jobs, res.viewingAs || owner, here, lastToolIn("tools")));
            };
            if (!owner) { apply({ jobs: [], fetchedAt: 0, mock: true, viewingAs: "", impersonating: false }); return; }
            apply(await fetchJobsFresh(owner, apply));
        })();
        return () => { dead = true; };
    }, []);

    const open = (id: string) => {
        sfx.click();
        // Deliver and Review are single bespoke pages, not master-detail
        // categories, so their cards go straight there.
        if (id === "deliver") onNavigate({ type: "tool", toolId: "delivery-hub", backTo: { type: "home" } });
        else if (id === "review") onNavigate({ type: "tool", toolId: "review-hub", backTo: { type: "home" } });
        else if (id === "tools") {
            const last = lastToolIn("tools");
            onNavigate({ type: "category", categoryId: "tools", ...(TOOLS.some((t) => t.id === last) ? { selectedToolId: last } : {}) });
        } else onNavigate({ type: "category", categoryId: id });
    };

    return (
        <div className={"category-row category-row--" + layout}>
            {CATEGORIES.map((category, index) => {
                const Icon = category.icon;
                const sig = signals[category.id] || { line: "", count: 0 };
                return (
                    <motion.button
                        key={category.id}
                        className={"category-card" + (sig.count ? " has-count" : "")}
                        style={categoryStyleVars(category.id)}
                        variants={categoryLift}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileHover="hover"
                        transition={{ type: "spring", stiffness: 300, damping: 24, delay: index * 0.06 } as Transition}
                        whileTap={{ scale: 0.96 }}
                        onHoverStart={() => { if (PREFETCH[category.id]) prefetchTool(PREFETCH[category.id]); }}
                        onClick={() => open(category.id)}
                    >
                        <motion.span variants={iconWiggle} className="category-card-icon">
                            <Icon size={layout === "bar" ? 16 : 22} />
                        </motion.span>
                        <span className="category-card-text">
                            <span className="category-card-label">{category.label}</span>
                            {sig.line && layout !== "bar" && <span className="category-card-line">{sig.line}</span>}
                        </span>
                        {/* The category's own mark, faint and oversized in the
                            corner: the card is recognisably itself at rest. */}
                        {layout !== "bar" && (
                            <span className="category-card-ghost" aria-hidden="true"><Icon size={layout === "grid" ? 64 : 72} /></span>
                        )}
                        {sig.count > 0 && (
                            <span className="category-card-count" title={`${sig.count} ${sig.countOf || ""}`.trim()}>{sig.count}</span>
                        )}
                    </motion.button>
                );
            })}
        </div>
    );
};

export default HomeMacroCards;
