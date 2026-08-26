import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import Button from './Button';
import { reportFrontendError } from '../../utils/observability';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  view?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportFrontendError({
      kind: 'react_error',
      view: this.props.view,
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full w-full min-h-[300px] flex-col items-center justify-center bg-[var(--bg-base)] p-6 text-[var(--text-primary)]">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-6 text-left shadow-lg">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)] text-[var(--accent-red)] border border-[var(--accent-red)]/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Ocurrió un error inesperado en la interfaz
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Se ha producido una excepción no capturada en esta sección de la aplicación.
                </p>

                {this.state.error && (
                  <div className="mt-4 max-h-36 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 font-mono text-xs text-[var(--accent-red)]">
                    <p className="font-semibold">{this.state.error.name}: {this.state.error.message}</p>
                    {this.state.error.stack && (
                      <pre className="mt-1 whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">
                        {this.state.error.stack.split('\n').slice(0, 4).join('\n')}
                      </pre>
                    )}
                  </div>
                )}

                <div className="mt-6 flex items-center gap-3">
                  <Button variant="primary" size="sm" onClick={this.handleReset}>
                    <RotateCcw className="h-4 w-4" />
                    Reintentar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={this.handleReload}>
                    <RefreshCw className="h-4 w-4" />
                    Recargar aplicación
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
