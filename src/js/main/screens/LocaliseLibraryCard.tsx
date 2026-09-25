// =============================================================================
// src/js/main/screens/LocaliseLibraryCard.tsx
// -----------------------------------------------------------------------------
// The Localised Library's door on the Localise screen.
//
// It used to be a full-width banner at the top of the page, which people read
// as a heading rather than something to press. It is a card now, sitting
// beside the campaign it belongs to (or under it on a narrow dock), and it
// shows what is BEHIND the door: the campaign's best-stocked territories, each
// one pressable straight into, with the territory the open project sits in
// pinned first. A card that shows your territory's 18 components gets opened;
// a sentence about "browsing components" did not.
//
// Everything here is a settings read or a folder listing -- no deep scan -- and
// quiet: no bridge, an unmounted share or an empty library all degrade to the
// card with fewer rows, never to a toast.
// =============================================================================
import React, { useEffect, useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import FileBadge from "../FileBadge";
import { evalTS } from "../../lib/utils/bolt";
import { territoryFlag } from "../lib/jobsFeed";
import type { LocaliserCampaignInfo } from "../tools/CSVLocaliser";

interface TerritoryStock {
    name: string;
    count: number;
    code: string;
}

interface Stock {
    territories: TerritoryStock[];
    total: number;
    here: string | null;
}

// Last answer per campaign+root: shown at once on a re-mount so the card does
// not flash empty, then refreshed -- coming back from the Library after a Find
// the Motion must show the new counts.
const cache: Record<string, Stock> = {};

async function quiet<T>(name: string, ...args: any[]): Promise<T | null> {
    try {
        const v = await evalTS(name as any, ...args);
        return v === undefined ? null : (v as T);
    } catch {
        return null;
    }
}

async function loadStock(c: LocaliserCampaignInfo): Promise<Stock | null> {
    // The team's catalogue merged in first, so a colleague's card shows the
    // campaign's library, not an empty one waiting for their own scan.
    const [terrs] = await Promise.all([
        quiet<string[]>("scanTerritories", c.marketsRoot),
        quiet("teamLocLibPull", c.name),
    ]);
    if (!terrs || terrs.length === 0) return null;
    const [comps, here, codes] = await Promise.all([
        quiet<{ campaign: string; territory: string }[]>("loadLocLibComponents"),
        quiet<string | null>("detectCurrentTerritory", terrs),
        Promise.all(terrs.map((t) => quiet<string | null>("getTerritoryCountryCode", t))),
    ]);
    const counts: Record<string, number> = {};
    (comps || []).forEach((x) => {
        if (x && x.campaign === c.name) counts[x.territory] = (counts[x.territory] || 0) + 1;
    });
    const territories = terrs.map((t, i) => ({ name: t, count: counts[t] || 0, code: codes[i] || "" }));
    return {
        territories,
        total: territories.reduce((n, t) => n + t.count, 0),
        here: here && terrs.indexOf(here) !== -1 ? here : null,
    };
}

export interface HereTerritory {
    name: string;
    code: string;
}

interface Props {
    campaign: LocaliserCampaignInfo | null;
    /** Open the Library, optionally straight into one territory. */
    onOpen: (territory?: string) => void;
    /** The territory the open project sits in, as this card detected it -- the
     *  page header shows it, and taking it from here means the two can never
     *  disagree. null when there is none. */
    onHere?: (t: HereTerritory | null) => void;
}

const ROWS = 8;

const LocaliseLibraryCard: React.FC<Props> = ({ campaign, onOpen, onHere }) => {
    const key = campaign ? campaign.name + "\n" + campaign.marketsRoot : "";
    const [stock, setStock] = useState<Stock | null>(key ? cache[key] || null : null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!campaign || !campaign.marketsRoot) { setStock(null); return; }
        let cancelled = false;
        setStock(cache[key] || null);
        setLoading(!cache[key]);
        loadStock(campaign).then((s) => {
            if (cancelled) return;
            if (s) cache[key] = s;
            // A failed re-read keeps what is on screen (CLAUDE.md: an empty or
            // failed read never replaces rows already shown).
            if (s || !cache[key]) setStock(s);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [key]);

    const hereName = stock && stock.here ? stock.here : "";
    const hereCode = stock && stock.here ? (stock.territories.filter((t) => t.name === stock.here)[0] || { code: "" }).code : "";
    useEffect(() => {
        if (onHere) onHere(hereName ? { name: hereName, code: hereCode } : null);
    }, [hereName, hereCode, onHere]);

    // The open project's territory first, whatever its count -- it is the one
    // you are most likely here for -- then the best-stocked.
    const rows: (TerritoryStock & { here: boolean })[] = [];
    if (stock) {
        const here = stock.here ? stock.territories.filter((t) => t.name === stock.here)[0] : undefined;
        if (here) rows.push({ ...here, here: true });
        stock.territories
            .filter((t) => t.count > 0 && t.name !== stock.here)
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, ROWS - rows.length)
            .forEach((t) => rows.push({ ...t, here: false }));
    }
    const stocked = stock ? stock.territories.filter((t) => t.count > 0).length : 0;
    const more = stock ? Math.max(0, stocked - rows.filter((r) => r.count > 0).length) : 0;

    let line = "Every territory's localised components. Check here before you build.";
    if (campaign && stock) {
        line = stock.total > 0
            ? `${stock.total} component${stock.total === 1 ? "" : "s"} across ${stocked} of ${stock.territories.length} territories`
            : `Nothing localised for ${campaign.name} yet`;
    } else if (campaign && loading) {
        line = "Looking at the territories…";
    }

    return (
        <div className="ls-libcard">
            <div className="ls-libcard-head">
                {/* What is behind the door, drawn: the kinds of file the
                    Library holds, fanned like a hand of cards. Fans out a
                    little more on hover; static at rest. */}
                <span className="ls-libcard-icon" aria-hidden="true">
                    <FileBadge of="PSD" size="md" className="ls-libcard-file is-psd" />
                    <FileBadge of="AI" size="md" className="ls-libcard-file is-ai" />
                    <FileBadge of="AEP" size="md" className="ls-libcard-file is-aep" />
                </span>
                <span className="ls-libcard-text">
                    <span className="ls-libcard-title">Localised Library</span>
                    <span className="ls-libcard-line">{line}</span>
                </span>
            </div>

            {rows.length > 0 && (
                <div className="ls-libcard-rows">
                    {rows.map((t) => {
                        const flag = territoryFlag(t.code);
                        return (
                            <button
                                key={t.name}
                                className={"ls-libcard-row" + (t.here ? " is-here" : "")}
                                onClick={() => onOpen(t.name)}
                            >
                                <span className={"ls-libcard-flag" + (flag ? "" : " is-code")}>{flag || t.code}</span>
                                <span className="ls-libcard-name">{t.name.replace(/_/g, " ")}</span>
                                {t.here && <MapPin size={11} className="ls-libcard-here" />}
                                <span className="ls-libcard-count">{t.count}</span>
                            </button>
                        );
                    })}
                    {more > 0 && <span className="ls-libcard-more">+{more} more</span>}
                </div>
            )}

            <button className="ls-libcard-open" onClick={() => onOpen()}>
                Open the Library <ArrowRight size={14} />
            </button>
        </div>
    );
};

export default LocaliseLibraryCard;
