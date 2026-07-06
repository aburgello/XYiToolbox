// =============================================================================
// src/js/main/ToolErrorBoundary.tsx
// -----------------------------------------------------------------------------
// Catches render errors thrown by individual tool components and shows a
// contained error card instead of crashing the whole panel. Wrap each
// <tool.Component /> in one of these so a broken tool never takes down the
// shell or any other tool.
// =============================================================================
import React from "react";

interface Props {
    toolLabel: string;
    children: React.ReactNode;
}

interface State {
    error: Error | null;
}

export class ToolErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`[ToolErrorBoundary] "${this.props.toolLabel}" threw:`, error, info.componentStack);
    }

    reset = () => this.setState({ error: null });

    render() {
        if (this.state.error) {
            return (
                <div className="tool-error-boundary">
                    <p className="tool-error-title">"{this.props.toolLabel}" ran into a problem</p>
                    <pre className="tool-error-message">{this.state.error.message}</pre>
                    <button className="tool-error-reset" onClick={this.reset}>
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
