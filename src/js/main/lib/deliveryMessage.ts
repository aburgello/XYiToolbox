// =============================================================================
// src/js/main/lib/deliveryMessage.ts
// -----------------------------------------------------------------------------
// What Delivery knows about what it just queued, in the shape the Wrike
// message is written from (lib/wrikeMessage.ts TOKENS). Read off each row's
// own render path -- `…/<Territory>/Renders/<Batch>/x.mov` -- so it needs no
// scan and no bridge call: the territory is the folder above `Renders`, the
// batch the folder below it, and the delivery lands in `_Delivery` beside the
// render, which is where deliver.ts writes it.
//
// A queue can hold more than one batch; each is its own group, biggest first,
// because each is its own comment on its own Wrike job. A row with no render
// path (a comp queued straight from the project) belongs to no batch and is
// left out rather than guessed at.
// =============================================================================
export interface DeliveredRow { name: string; sourcePath: string | null }

export interface DeliveryGroup {
    /** "Norway · Batch_02", for the chip that picks it. */
    label: string;
    territoryPath: string;
    territory: string;
    batch: string;
    /** The folder the renders came from, and the _Delivery inside it. */
    rendersFolder: string;
    deliveryFolder: string;
    names: string[];
}

export function deliveryGroups(rows: DeliveredRow[]): DeliveryGroup[] {
    const groups: DeliveryGroup[] = [];
    for (const r of rows) {
        if (!r.sourcePath) continue;
        const sep = r.sourcePath.indexOf("\\") !== -1 && r.sourcePath.indexOf("/") === -1 ? "\\" : "/";
        const parts = r.sourcePath.split(/[\\/]/);
        const lead = r.sourcePath.charAt(0) === "/" ? "/" : "";
        let at = -1;
        for (let i = parts.length - 2; i > 0; i--) if (/^renders$/i.test(parts[i])) { at = i; break; }
        if (at < 1) continue;
        const join = (n: number) => lead + parts.slice(0, n).filter((p, i) => p || i > 0).join(sep);
        const territoryPath = join(at);
        // The folder under Renders is the batch, unless the file sits right there.
        const batch = at + 2 < parts.length && parts[at + 1].charAt(0) !== "_" ? parts[at + 1] : "";
        const rendersFolder = join(batch ? at + 2 : at + 1);
        let g = groups.find((x) => x.rendersFolder === rendersFolder);
        if (!g) {
            const territory = parts[at - 1];
            g = {
                label: territory.replace(/_/g, " ") + (batch ? " · " + batch : ""),
                territoryPath, territory, batch, rendersFolder,
                deliveryFolder: rendersFolder + sep + "_Delivery",
                names: [],
            };
            groups.push(g);
        }
        // What lands in _Delivery: the comp's name, as an mp4.
        g.names.push(/\.\w+$/.test(r.name) ? r.name : r.name + ".mp4");
    }
    return groups.sort((a, b) => b.names.length - a.names.length);
}
