function resizeCompCentered(newWidth, newHeight) {
    var comp = app.project.activeItem;

    // 1. Safety Check: Ensure a comp is active
    if (!comp || !(comp instanceof CompItem)) {
        alert("Please select a Composition active in the timeline.");
        return;
    }

    // 2. Data Sanitization: Ensure inputs are actually Numbers
    var w = parseInt(newWidth, 10);
    var h = parseInt(newHeight, 10);

    if (isNaN(w) || isNaN(h)) {
        alert("Invalid dimensions. Please enter valid numbers.");
        return;
    }

    app.beginUndoGroup("Resize Composition Centered");

    var widthOffset = (w - comp.width) / 2;
    var heightOffset = (h - comp.height) / 2;

    // 3. Loop through layers
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);

        // Skip if locked or parented
        if (layer.parent !== null || layer.locked) continue;

        // --- HANDLE POSITION ---
        if (layer.transform.position.dimensionsSeparated) {
            // Separate Dimensions (X, Y are distinct)
            var curX = layer.transform.xPosition.value;
            var curY = layer.transform.yPosition.value;
            layer.transform.xPosition.setValue(curX + widthOffset);
            layer.transform.yPosition.setValue(curY + heightOffset);
        } else {
            // Standard Position Array
            var curPos = layer.transform.position.value;
            if (layer.threeDLayer) {
                // 3D Layer: [x, y, z]
                layer.transform.position.setValue([
                    curPos[0] + widthOffset,
                    curPos[1] + heightOffset,
                    curPos[2]
                ]);
            } else {
                // 2D Layer: [x, y] - attempting to access [2] here would crash
                layer.transform.position.setValue([
                    curPos[0] + widthOffset,
                    curPos[1] + heightOffset
                ]);
            }
        }

        // --- HANDLE POINT OF INTEREST (The "Rescaling" Fix) ---
        // If a camera has a target, we must move the target too, 
        // otherwise the camera pivots and ruins the perspective.
        if (layer.transform.pointOfInterest && layer.transform.pointOfInterest.numKeys === 0) {
            // Only adjust if no keyframes (simple static adjustment), 
            // otherwise logic gets very complex.
            var curPOI = layer.transform.pointOfInterest.value;
            layer.transform.pointOfInterest.setValue([
                curPOI[0] + widthOffset,
                curPOI[1] + heightOffset,
                curPOI[2]
            ]);
        }
    }

    // 4. Apply new size
    comp.width = w;
    comp.height = h;

    app.endUndoGroup();
}