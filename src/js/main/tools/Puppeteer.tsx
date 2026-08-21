// =============================================================================
// src/js/main/tools/Puppeteer.tsx
// -----------------------------------------------------------------------------
// Everything that happens to a puppet AFTER the pins are down.
//
// The division is not a compromise, it is the API: a script can add the effect
// and add pin atoms, but a scripted pin has no mesh vertex behind it and its
// position throws on the first setValue. Probed, not assumed -- see the header
// of src/jsx/aeft/puppeteer.ts. Placing pins takes an artist seconds and wants
// their eye anyway; naming twelve of them, building a null for each, posing,
// staggering and baking is the part that eats an afternoon.
// =============================================================================
import React, { useEffect, useState } from "react";
import {
    RefreshCw, Link2, Unlink, Tag, Camera, Play, Trash2, Wind,
    Waves, Activity, Check, ChevronDown, ChevronRight, MousePointer2, X,
} from "lucide-react";
import { evalTS } from "../../lib/utils/bolt";
import StatusIcon from "../StatusIcon";
import Tooltip from "../Tooltip";
import CheckboxToggle from "../CheckboxToggle";
import SegmentedToggle from "../SegmentedToggle";
import { confirmDialog } from "../Dialog";
import "../shared.scss";
import "./formTool.scss";
import "./Puppeteer.scss";

interface Pin {
    index: number; name: string;
    x: number; y: number; compX: number; compY: number;
    keys: number; expression: boolean;
    rotation: number | null; scale: number | null;
    vertex: number;
    control: string; controlDriven: boolean;
}
interface Mesh { index: number; name: string; triangles: number; density: number; expansion: number; pins: Pin[] }
interface LayerInfo { index: number; name: string; engine: number; meshes: Mesh[]; pinCount: number; rigged: number }
interface Scan {
    success: boolean; error?: string;
    comp?: string; frameRate?: number; time?: number;
    layers?: LayerInfo[]; skipped?: string[];
}

/** A pose is per RIG, so it is filed under something that identifies the rig
 *  rather than the layer: two layers with the same twelve pins are the same
 *  rig as far as a pose is concerned, and a rename shouldn't lose the work. */
interface Pose { name: string; pins: { name: string; x: number; y: number }[] }
type PoseBook = Record<string, Pose[]>;

const poseKeyFor = (comp: string, l: LayerInfo) => `${comp}::${l.name}::${l.pinCount}`;

const PuppeteerTool = () => {
    const [scan, setScan] = useState<Scan | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const [active, setActive] = useState(0);              // index into scan.layers
    const [picked, setPicked] = useState<number[]>([]);   // flat pin indices, empty = all

    const [prefix, setPrefix] = useState("Pin");
    const [master, setMaster] = useState(true);
    const [matchTiming, setMatchTiming] = useState(true);

    const [pattern, setPattern] = useState("");
    const [poses, setPoses] = useState<PoseBook>({});
    const [poseName, setPoseName] = useState("");

    const [staggerFrames, setStaggerFrames] = useState("2");
    const [staggerMode, setStaggerMode] = useState("order");
    const [rootPin, setRootPin] = useState(1);

    const [moreOpen, setMoreOpen] = useState(false);
    const [motion, setMotion] = useState("sway");
    const [amount, setAmount] = useState("12");
    const [speed, setSpeed] = useState("0.5");
    const [falloff, setFalloff] = useState(true);
    const [tris, setTris] = useState("");
    const [expansion, setExpansion] = useState("");

    const layer = (scan?.layers || [])[active] || null;
    const pins: Pin[] = layer ? layer.meshes.reduce((all, m) => all.concat(m.pins), [] as Pin[]) : [];
    // Flat 1-based numbering, matching what the backend counts. A pin's index
    // inside its own mesh is not unique once a layer has two meshes.
    const flat = pins.map((p, i) => ({ ...p, flat: i + 1 }));
    const targeted = picked.length === 0 ? flat.map((p) => p.flat) : picked;
    const poseKey = layer && scan?.comp ? poseKeyFor(scan.comp, layer) : "";
    const myPoses = poses[poseKey] || [];

    const say = (text: string, type: "success" | "error") => setStatus({ text, type });

    const call = async <T,>(fn: string, ...args: any[]): Promise<T | null> => {
        try {
            const r = (await evalTS(fn as any, ...args)) as unknown as T | undefined;
            if (r === undefined) throw new Error("no bridge");
            return r;
        } catch {
            say("No CEP bridge detected. Open this panel inside After Effects.", "error");
            return null;
        }
    };

    const refresh = async (quiet?: boolean) => {
        // `quiet` means "after an action of ours": the artist's pin selection
        // is still what they meant, so it survives.
        setBusy(true);
        if (!quiet) setStatus(null);
        const r = await call<Scan>("puppetScan");
        setBusy(false);
        if (!r) return;
        setScan(r);
        if (!r.success) { say(r.error || "Couldn't read the comp.", "error"); return; }
        if (!quiet) setPicked([]);
        if ((r.layers || []).length === 0 && !quiet) {
            say("No Puppet effect in this comp. Place a pin or two with the Puppet tool first.", "error");
        }
        setActive((a) => {
            const list = r.layers || [];
            const wasIndex = (scan?.layers || [])[a]?.index;
            for (let i = 0; i < list.length; i++) if (list[i].index === wasIndex) return i;
            return a < list.length ? a : 0;
        });
    };

    useEffect(() => {
        refresh(true);
        (async () => {
            const r = await call<{ success: boolean; json?: string }>("puppetPosesLoad");
            if (r && r.success && r.json) {
                try { setPoses(JSON.parse(r.json) as PoseBook); } catch { /* first run */ }
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const savePoses = async (book: PoseBook) => {
        setPoses(book);
        await call("puppetPosesSave", JSON.stringify(book));
    };

    const togglePin = (n: number) => {
        setPicked((prev) => (prev.indexOf(n) === -1 ? prev.concat([n]) : prev.filter((x) => x !== n)));
    };

    // --- the actions ------------------------------------------------------
    const rig = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; created?: number; skipped?: string[] }>(
            "puppetRigNulls",
            JSON.stringify({ layerIndex: layer.index, pins: picked, prefix, master, matchTiming })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't rig that.", "error"); return; }
        const missed = (r.skipped || []).length;
        say(`${r.created} control${r.created === 1 ? "" : "s"} made and linked.` +
            (missed ? ` ${missed} skipped: ${(r.skipped || []).join(", ")}` : ""), "success");
        refresh(true);
    };

    const bake = async (keyframes: boolean) => {
        if (!layer) return;
        const ok = await confirmDialog(
            keyframes
                ? "Bake every frame of the rig into keyframes on the pins, then drop the expressions?"
                : "Freeze the pins at their current position and drop the expressions?"
        );
        if (!ok) return;
        const removeControls = await confirmDialog("Delete the control nulls this tool made?");
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; baked?: number; keysWritten?: number; controlsRemoved?: number }>(
            "puppetBake",
            JSON.stringify({ layerIndex: layer.index, pins: picked, keyframes, removeControls })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't bake that.", "error"); return; }
        say(`Baked ${r.baked} pin${r.baked === 1 ? "" : "s"}` +
            (r.keysWritten ? `, ${r.keysWritten} keyframes` : "") +
            (r.controlsRemoved ? `, ${r.controlsRemoved} controls removed.` : "."), "success");
        refresh(true);
    };

    const rename = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; renamed?: number }>(
            "puppetRenamePins",
            JSON.stringify({ layerIndex: layer.index, pins: picked, pattern, start: 1 })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't rename those.", "error"); return; }
        say(`Renamed ${r.renamed} pin${r.renamed === 1 ? "" : "s"}.`, "success");
        setPattern("");
        refresh(true);
    };

    const capture = async () => {
        if (!layer || !poseKey) return;
        const name = poseName.trim() || `Pose ${myPoses.length + 1}`;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; pins?: { name: string; x: number; y: number }[] }>(
            "puppetCapturePose", layer.index
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't read the pose.", "error"); return; }
        const book: PoseBook = { ...poses, [poseKey]: (poses[poseKey] || []).concat([{ name, pins: r.pins || [] }]) };
        await savePoses(book);
        setPoseName("");
        say(`Saved "${name}" — ${(r.pins || []).length} pins.`, "success");
    };

    const applyPose = async (pose: Pose, key: boolean) => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; moved?: number; keyed?: number; note?: string }>(
            "puppetApplyPose",
            JSON.stringify({ layerIndex: layer.index, pins: pose.pins, key, viaControls: true })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't apply that pose.", "error"); return; }
        say(`"${pose.name}" applied to ${r.moved} pins` + (r.keyed ? `, ${r.keyed} keyed` : "") +
            (r.note ? ` — ${r.note}` : "."), "success");
        refresh(true);
    };

    const deletePose = async (i: number) => {
        const list = (poses[poseKey] || []).slice();
        list.splice(i, 1);
        await savePoses({ ...poses, [poseKey]: list });
    };

    const stagger = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; shifted?: number; skippedNoKeys?: number }>(
            "puppetStagger",
            JSON.stringify({
                layerIndex: layer.index, pins: picked, frames: Number(staggerFrames) || 0,
                mode: staggerMode, rootPin, viaControls: true,
            })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't stagger those.", "error"); return; }
        say(`Offset ${r.shifted} pin${r.shifted === 1 ? "" : "s"}.` +
            (r.skippedNoKeys ? ` ${r.skippedNoKeys} had no keyframes to move.` : ""), "success");
    };

    const overshoot = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; applied?: number }>(
            "puppetOvershoot",
            JSON.stringify({
                layerIndex: layer.index, pins: picked,
                amplitude: 0.06, frequency: 2.5, decay: 6, viaControls: true,
            })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't apply that.", "error"); return; }
        if (!r.applied) { say("Overshoot needs keyframes to follow.", "error"); return; }
        say(`Overshoot on ${r.applied} pin${r.applied === 1 ? "" : "s"}.`, "success");
    };

    const applyMesh = async () => {
        if (!layer) return;
        const setTriangles = tris.trim() !== "";
        const setExpansion = expansion.trim() !== "";
        if (!setTriangles && !setExpansion) { say("Nothing to set.", "error"); return; }
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; meshes?: number }>(
            "puppetSetMesh",
            JSON.stringify({
                layerIndex: layer.index, triangles: Number(tris) || 0, expansion: Number(expansion) || 0,
                density: 0, setTriangles, setExpansion, setDensity: false,
            })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't set the mesh.", "error"); return; }
        // `error` alongside success means some of it took and some didn't.
        say(`Set ${r.meshes} value${r.meshes === 1 ? "" : "s"}.` + (r.error ? ` ${r.error}` : ""),
            r.error ? "error" : "success");
        refresh(true);
    };

    const selectInAE = async () => {
        if (!layer) return;
        const r = await call<{ success: boolean; error?: string; count?: number }>(
            "puppetSelectControls", layer.index, JSON.stringify(picked));
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't select those.", "error"); return; }
        say(`${r.count} control${r.count === 1 ? "" : "s"} selected in the comp.`, "success");
    };

    const applyMotion = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; applied?: number }>(
            "puppetMotion",
            JSON.stringify({
                layerIndex: layer.index, pins: picked, kind: motion,
                amount: Number(amount) || 0, speed: Number(speed) || 0,
                spread: 0.12, scaleByDistance: falloff, rootPin: rootPin,
            })
        );
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't apply that.", "error"); return; }
        say(`${motion} on ${r.applied} control${r.applied === 1 ? "" : "s"}.`, "success");
        refresh(true);
    };

    const clearMotion = async () => {
        if (!layer) return;
        setBusy(true);
        const r = await call<{ success: boolean; error?: string; count?: number }>(
            "puppetClearMotion", layer.index, JSON.stringify(picked));
        setBusy(false);
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't clear that.", "error"); return; }
        say(`Motion off on ${r.count} control${r.count === 1 ? "" : "s"}.`, "success");
        refresh(true);
    };

    const nudge = async (dx: number, dy: number) => {
        if (!layer) return;
        const r = await call<{ success: boolean; error?: string; count?: number }>(
            "puppetNudge", JSON.stringify({ layerIndex: layer.index, pins: picked, dx, dy, key: false }));
        if (!r) return;
        if (!r.success) { say(r.error || "Couldn't move those.", "error"); return; }
        refresh(true);
    };

    // --- the page ---------------------------------------------------------
    //
    // ONE ACTION AT A TIME. The first cut of this put pins, naming, controls,
    // poses, timing and mesh on screen at once, which is a command centre for
    // a job that is nearly always a single press: rig the pins, then pose them.
    // What is showing now depends on what the rig actually needs next, and the
    // rest sits behind More.
    const layers = scan?.layers || [];
    const anyRigged = layer ? layer.rigged > 0 : false;
    const anyKeys = flat.filter((p) => p.keys > 0).length > 0;

    return (
        <div className="form-tool puppeteer">
            <div className="button-row">
                <button disabled={busy} onClick={() => refresh()}>
                    <RefreshCw size={14} /> Find puppets
                </button>
            </div>

            {layers.length === 0 && scan && scan.success && (
                <p className="pp-empty">
                    Place your pins with AE's Puppet tool first. Scripted pins have no mesh behind
                    them, so that part can't be automated. Everything after it is here.
                </p>
            )}

            {layer && (
                <>
                    {/* Only when there is a choice to make. One puppet in the
                        comp is the usual case and does not need a picker. */}
                    {layers.length > 1 && (
                        <div className="pp-layers">
                            {layers.map((l, i) => (
                                <button key={l.index} className={"pp-layer" + (i === active ? " is-on" : "")}
                                    onClick={() => { setActive(i); setPicked([]); }}>
                                    <strong>{l.name}</strong>
                                    <span>{l.pinCount} pins{l.rigged ? ` · ${l.rigged} rigged` : ""}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="pp-pins">
                        <div className="pp-pins-head">
                            <span>
                                {layers.length === 1 ? layer.name : "PINS"} · {layer.pinCount} pin{layer.pinCount === 1 ? "" : "s"}
                                {anyRigged ? ` · ${layer.rigged} rigged` : ""}
                            </span>
                            {picked.length > 0 && (
                                <button className="pp-mini" onClick={() => setPicked([])}>
                                    {picked.length} selected — clear
                                </button>
                            )}
                        </div>
                        <div className="pp-pin-grid">
                            {flat.map((p) => {
                                const on = picked.length === 0 || picked.indexOf(p.flat) !== -1;
                                return (
                                    <Tooltip key={p.flat} text={p.control
                                        ? `driven by ${p.control}${p.controlDriven ? " (animated)" : ""}`
                                        : `${Math.round(p.compX)}, ${Math.round(p.compY)} in the comp${p.keys ? ` · ${p.keys} keys` : ""}`}>
                                        <button className={"pp-pin" + (on ? " is-on" : "") + (p.expression ? " is-rigged" : "") + (p.controlDriven ? " is-driven" : "")}
                                            onClick={() => togglePin(p.flat)}>
                                            {p.expression && <Link2 size={9} />}
                                            <span>{p.name}</span>
                                        </button>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    </div>

                    {/* THE ONE BUTTON. Unrigged pins want controls; rigged ones
                        want posing. Nothing else is a first move. */}
                    {!anyRigged ? (
                        <button className="pp-primary" disabled={busy} onClick={rig}>
                            <Link2 size={14} />
                            Give {picked.length ? `${picked.length} pin${picked.length === 1 ? "" : "s"}` : "every pin"} a control
                        </button>
                    ) : (
                        <>
                        {/* THE CONTROLS ARE THE TOOL once the rig exists. A
                            list of pins with no way to touch the nulls is a
                            readout; these four rows are the reason to rig at
                            all. */}
                        <div className="pp-controls">
                            <div className="pp-pins-head">
                                <span>CONTROLS</span>
                                <button className="pp-mini" disabled={busy} onClick={selectInAE}>
                                    <MousePointer2 size={10} /> Select in AE
                                </button>
                            </div>

                            <div className="pp-row">
                                <div className="pp-seg">
                                    {["sway", "wiggle", "orbit", "breathe"].map((k) => (
                                        <button key={k} className={"pp-seg-b" + (motion === k ? " is-on" : "")}
                                            onClick={() => setMotion(k)}>{k}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="pp-row">
                                <label className="pp-inline">
                                    <input type="text" className="pp-num" value={amount} onChange={(e) => setAmount(e.target.value)} />
                                    <span>px</span>
                                </label>
                                <label className="pp-inline">
                                    <input type="text" className="pp-num" value={speed} onChange={(e) => setSpeed(e.target.value)} />
                                    <span>per sec</span>
                                </label>
                                <CheckboxToggle checked={falloff} onChange={setFalloff} label="More at the tips" />
                                <button className="pp-primary pp-primary--inline" disabled={busy} onClick={applyMotion}>
                                    <Wind size={12} /> Apply
                                </button>
                                <button className="pp-mini" disabled={busy} onClick={clearMotion}><X size={10} /></button>
                            </div>

                            {/* Exact offsets, because landing one on a canvas at
                                40% zoom is the thing everybody swears at. */}
                            <div className="pp-row pp-nudge">
                                <span className="pp-nudge-lbl">Nudge</span>
                                <button className="pp-mini" disabled={busy} onClick={() => nudge(-10, 0)}>←</button>
                                <button className="pp-mini" disabled={busy} onClick={() => nudge(10, 0)}>→</button>
                                <button className="pp-mini" disabled={busy} onClick={() => nudge(0, -10)}>↑</button>
                                <button className="pp-mini" disabled={busy} onClick={() => nudge(0, 10)}>↓</button>
                            </div>
                        </div>

                        <div className="pp-poses">
                            <div className="pp-row">
                                <input type="text" value={poseName} placeholder="Name this pose"
                                    onChange={(e) => setPoseName(e.target.value)} />
                                <button className="pp-primary pp-primary--inline" disabled={busy} onClick={capture}>
                                    <Camera size={12} /> Capture pose
                                </button>
                            </div>
                            {myPoses.map((pose, i) => (
                                <div className="pp-pose" key={pose.name + i}>
                                    <span className="pp-pose-name">{pose.name}</span>
                                    <button className="pp-mini" disabled={busy} onClick={() => applyPose(pose, false)}>Set</button>
                                    <button className="pp-mini" disabled={busy} onClick={() => applyPose(pose, true)}>
                                        <Play size={10} /> Key
                                    </button>
                                    <button className="pp-mini pp-mini--warn" onClick={() => deletePose(i)}>
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        </>
                    )}

                    {/* Follow-through only exists once there is something to
                        follow, so it appears with the first keyframe. */}
                    {anyKeys && (
                        <div className="pp-row pp-row--quiet">
                            <label className="pp-inline">
                                <input type="text" className="pp-num" value={staggerFrames}
                                    onChange={(e) => setStaggerFrames(e.target.value)} />
                                <span>frames apart</span>
                            </label>
                            <button className="pp-ghost" disabled={busy} onClick={stagger}>
                                <Waves size={12} /> Stagger
                            </button>
                            <button className="pp-ghost" disabled={busy} onClick={overshoot}>
                                <Activity size={12} /> Overshoot
                            </button>
                        </div>
                    )}

                    <button className="pp-more" onClick={() => setMoreOpen((v) => !v)}>
                        {moreOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} More
                    </button>

                    {moreOpen && (
                        <div className="pp-drawer">
                            <div className="pp-row">
                                <input type="text" value={pattern} placeholder="Rename pins: Arm, or Arm_# for the number"
                                    onChange={(e) => setPattern(e.target.value)} />
                                <button className="pp-ghost" disabled={busy || !pattern.trim()} onClick={rename}>
                                    <Tag size={12} /> Rename
                                </button>
                            </div>

                            <div className="pp-row">
                                <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Control prefix" />
                                <button className="pp-ghost" disabled={busy} onClick={rig}>Controls</button>
                            </div>
                            <div className="pp-opts">
                                <CheckboxToggle checked={master} onChange={setMaster} label="One master null over them all" />
                                <CheckboxToggle checked={matchTiming} onChange={setMatchTiming} label="Match the layer's in and out points" />
                            </div>

                            {anyRigged && (
                                <div className="pp-row pp-row--split">
                                    <button className="pp-ghost" disabled={busy} onClick={() => bake(true)}>
                                        <Unlink size={12} /> Bake to keys
                                    </button>
                                    <button className="pp-ghost" disabled={busy} onClick={() => bake(false)}>
                                        <Unlink size={12} /> Freeze here
                                    </button>
                                </div>
                            )}

                            {anyKeys && (
                                <div className="pp-row">
                                    <SegmentedToggle
                                        name="pp-stagger-mode"
                                        value={staggerMode}
                                        onChange={setStaggerMode}
                                        options={[
                                            { value: "order", label: "In pin order" },
                                            { value: "distance", label: "Outwards from" },
                                        ]}
                                    />
                                    {staggerMode === "distance" && (
                                        <select className="pp-select" value={rootPin} onChange={(e) => setRootPin(Number(e.target.value))}>
                                            {flat.map((p) => <option key={p.flat} value={p.flat}>{p.name}</option>)}
                                        </select>
                                    )}
                                </div>
                            )}

                            <div className="pp-row">
                                <label className="pp-inline">
                                    <input type="text" className="pp-num" value={tris} placeholder={String(layer.meshes[0]?.triangles || 350)}
                                        onChange={(e) => setTris(e.target.value)} />
                                    <span>triangles</span>
                                </label>
                                <label className="pp-inline">
                                    <input type="text" className="pp-num" value={expansion} placeholder={String(layer.meshes[0]?.expansion ?? 3)}
                                        onChange={(e) => setExpansion(e.target.value)} />
                                    <span>expansion</span>
                                </label>
                                <button className="pp-ghost" disabled={busy} onClick={applyMesh}><Check size={12} /> Set mesh</button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {status && (
                <div className={`tool-status tool-status-${status.type}`}>
                    <StatusIcon type={status.type} />
                    <span style={{ whiteSpace: "pre-wrap" }}>{status.text}</span>
                </div>
            )}
        </div>
    );
};

export default PuppeteerTool;
