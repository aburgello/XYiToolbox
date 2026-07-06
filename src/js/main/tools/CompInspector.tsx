import React, { useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface LayerInfo {
    index: number;
    name: string;
    enabled: boolean;
    solo: boolean;
    locked: boolean;
    shy: boolean;
    inPoint: number;
    outPoint: number;
    startTime: number;
    duration: number;
    sourceName: string;
    typeName: string;
    Effects: { name: string; matchName: string; enabled: boolean }[];
}

interface CompInfo {
    name: string;
    width: number;
    height: number;
    frameRate: number;
    duration: number;
    pixelAspect: number;
    bgColor: number[];
    layers: LayerInfo[];
}

const MOCK_COMP: CompInfo = {
    name: "ODY_INTL_DGTL_DOOH_HORSE_1920x858_10sec_OV",
    width: 1920, height: 858, frameRate: 25, duration: 10, pixelAspect: 1,
    bgColor: [0, 0, 0],
    layers: [
        { index: 1, name: "HORSE_master", enabled: true, solo: false, locked: false, shy: false, inPoint: 0, outPoint: 10, startTime: 0, duration: 10, sourceName: "HORSE_master.aep", typeName: "Comp", Effects: [] },
        { index: 2, name: "Logo_Endcard", enabled: true, solo: false, locked: true, shy: false, inPoint: 7, outPoint: 10, startTime: 0, duration: 3, sourceName: "Logo_Endcard.mov", typeName: "Footage (File)", Effects: [] },
        { index: 3, name: "Adjustment Layer 1", enabled: true, solo: false, locked: false, shy: false, inPoint: 0, outPoint: 10, startTime: 0, duration: 10, sourceName: "", typeName: "Other", Effects: [{ name: "Curves", matchName: "ADBE Curves", enabled: true }] },
    ],
};

const CompInspector: React.FC = () => {
    const [info, setInfo] = useState<CompInfo | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [filter, setFilter] = useState("");

    const inspect = async () => {
        setBusy(true); setStatus(null);
        try {
            const result = await evalTS("compInspectorInspect");
            if (result === undefined) throw new Error("no bridge");
            if (result.success) {
                setInfo(JSON.parse(result.message));
                setStatus({ type: "success", text: "Comp inspected." });
            } else {
                setStatus({ type: "error", text: result.error || "Inspect failed." });
                setInfo(MOCK_COMP);
            }
        } catch {
            setInfo(MOCK_COMP);
            setStatus({ type: "error", text: "No bridge — showing mock data." });
        } finally { setBusy(false); }
    };

    const filteredLayers = info && filter.trim()
        ? info.layers.filter((l) => {
            const q = filter.toLowerCase();
            return l.name.toLowerCase().indexOf(q) !== -1 ||
                   l.sourceName.toLowerCase().indexOf(q) !== -1 ||
                   l.typeName.toLowerCase().indexOf(q) !== -1;
        })
        : info ? info.layers : [];

    return (
        <div className="form-tool ci">

            <div className="button-row">
                <button disabled={busy} onClick={inspect}>
                    <RefreshCw size={14} /> {info ? "Refresh" : "Inspect Active Comp"}
                </button>
            </div>

            {status && (
                <div className={`loc-status loc-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span>{status.text}</span>
                </div>
            )}

            {info && (
                <div className="ci-report">
                    <div className="ci-summary">
                        <div className="ci-summary-name">{info.name}</div>
                        <div className="ci-summary-meta">
                            {info.width}×{info.height} · {info.frameRate}fps · {info.duration}s · {info.layers.length} layers
                        </div>
                    </div>

                    <div className="ci-filter-row">
                        <div className="ci-filter-box">
                            <Search size={12} />
                            <input type="text" placeholder="Filter layers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                        </div>
                    </div>

                    <div className="ci-layers">
                        {filteredLayers.map((l) => (
                            <div key={l.index} className={"ci-layer" + (l.enabled ? "" : " ci-layer--disabled")} title={`${l.typeName}${l.locked ? " · locked" : ""}${l.solo ? " · solo" : ""}${l.shy ? " · shy" : ""}`}>
                                <div className="ci-layer-header">
                                    <span className="ci-layer-index">{l.index}</span>
                                    <span className="ci-layer-name">{l.name}</span>
                                    <span className="ci-layer-type">{l.typeName}</span>
                                    <div className="ci-layer-flags">
                                        {l.locked && <span title="Locked">🔒</span>}
                                        {l.solo && <span title="Solo">◐</span>}
                                        {l.shy && <span title="Shy">!</span>}
                                        {!l.enabled && <span title="Disabled">✕</span>}
                                    </div>
                                </div>
                                <div className="ci-layer-meta">
                                    <span title="In / Out">{l.inPoint.toFixed(2)} – {l.outPoint.toFixed(2)}</span>
                                    <span title="Duration">dur: {l.duration.toFixed(2)}s</span>
                                    {l.sourceName && <span title="Source">{l.sourceName}</span>}
                                    {l.Effects.length > 0 && (
                                        <span className="ci-layer-effects" title="Effects">
                                            {l.Effects.map((e) => e.name).join(", ")}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CompInspector;