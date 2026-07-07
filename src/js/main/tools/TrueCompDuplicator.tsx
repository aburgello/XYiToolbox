// =============================================================================
// src/js/main/tools/TrueCompDuplicator.tsx
// -----------------------------------------------------------------------------
// True Comp Duplicator - Duplicates compositions while maintaining all layer
// references, effects, and expressions. Handles nested pre-comps recursively.
// =============================================================================
import React, { useState } from "react";
import { Copy, Check, AlertCircle } from "lucide-react";
import { evalTSSafe } from "../../lib/utils/evalTSSafe";
import StatusIcon from "../StatusIcon";
import "../shared.scss";
import "./formTool.scss";

interface DuplicationResult {
    success: boolean;
    error?: string;
    duplicatedComps?: string[];
    message?: string;
}

const TrueCompDuplicator: React.FC = () => {
    const [suffix, setSuffix] = useState("_DUP");
    const [includeNested, setIncludeNested] = useState(true);
    const [updateExpressions, setUpdateExpressions] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<DuplicationResult | null>(null);

    const handleDuplicate = async () => {
        setBusy(true);
        setResult(null);

        try {
            const result = await evalTSSafe("trueCompDuplicator", {
                suffix,
                includeNested,
                updateExpressions,
            });

            if (result) {
                setResult(result);
            }
        } catch (error) {
            setResult({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="form-tool">
            <h2>True Comp Duplicator</h2>
            <p className="hint">
                Duplicates selected compositions while maintaining all layer references,
                effects, and expressions. Handles nested pre-comps recursively.
            </p>

            <div className="field-row">
                <label htmlFor="suffix">Name Suffix</label>
                <input
                    id="suffix"
                    type="text"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="_DUP"
                />
            </div>

            <div className="checkbox-row">
                <label>
                    <input
                        type="checkbox"
                        checked={includeNested}
                        onChange={(e) => setIncludeNested(e.target.checked)}
                    />
                    Include nested pre-comps
                </label>
            </div>

            <div className="checkbox-row">
                <label>
                    <input
                        type="checkbox"
                        checked={updateExpressions}
                        onChange={(e) => setUpdateExpressions(e.target.checked)}
                    />
                    Update expressions to reference new comps
                </label>
            </div>

            <div className="button-row">
                <button
                    onClick={handleDuplicate}
                    disabled={busy}
                    className="primary"
                >
                    <Copy size={16} />
                    {busy ? "Duplicating..." : "Duplicate Selected Comps"}
                </button>
            </div>

            {result && (
                <div className={`status-message ${result.success ? "success" : "error"}`}>
                    <StatusIcon type={result.success ? "success" : "error"} />
                    <div>
                        {result.success ? (
                            <>
                                <strong>Success!</strong>
                                {result.duplicatedComps && (
                                    <p>Duplicated {result.duplicatedComps.length} composition(s):</p>
                                )}
                                {result.duplicatedComps && (
                                    <ul>
                                        {result.duplicatedComps.map((name, idx) => (
                                            <li key={idx}>{name}</li>
                                        ))}
                                    </ul>
                                )}
                                {result.message && <p>{result.message}</p>}
                            </>
                        ) : (
                            <>
                                <strong>Error</strong>
                                <p>{result.error}</p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TrueCompDuplicator;