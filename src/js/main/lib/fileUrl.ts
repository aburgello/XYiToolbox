// =============================================================================
// src/js/main/lib/fileUrl.ts
// -----------------------------------------------------------------------------
// One OS path -> file:// URL conversion, for every <video>/<img> in the panel.
//
// Lifted out of OVLibrary, which had the only copy, when the tutorial overlay
// became the second caller. The Windows and UNC branches below are the kind of
// detail that gets half-remembered when someone writes the conversion a second
// time -- and a malformed file:// URL does not throw, it just silently shows
// nothing, so a second copy that got one branch wrong would look like a
// missing file rather than a bug.
// =============================================================================

/**
 * Converts a raw OS filesystem path (as returned by the ExtendScript bridge,
 * e.g. "/Volumes/Renders/HORSE/foo.mp4" or "C:\Renders\HORSE\foo.mp4") into
 * a file:// URL a <video>/<img> tag can load.
 */
export function toFileUrl(p: string): string {
    if (!p) return "";
    if (p.startsWith("file://")) return p;
    let normalized = p.replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(normalized)) {
        // Drive-letter path (C:/...) -- needs an extra leading slash so the
        // drive letter isn't parsed as part of a URL scheme/host.
        normalized = "/" + normalized;
    } else if (normalized.startsWith("//")) {
        // UNC network path (\\Server\Share\... before the backslash swap
        // above) -- file://<host>/<share>/... wants exactly the TWO
        // slashes "file://" already supplies before the host, so this
        // leading "//" has to be stripped, not kept alongside it.
        // Concatenating both silently produces a malformed four-slash URL
        // that just fails to load with no error, rather than a network
        // path a mapped-drive-letter test never would have caught.
        normalized = normalized.substring(2);
    }
    return "file://" + encodeURI(normalized);
}
