import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { hasError, error } = this.state;
    const { children } = this.props;

    if (hasError) {
      return (
        <div className="min-h-screen bg-[#0f1115] flex items-center justify-center p-4 text-white">
          <div className="bg-[#22272e] p-6 rounded-xl max-w-lg w-full shadow-2xl">
            <h2 className="text-xl font-bold text-red-400 mb-4">Something went wrong</h2>
            <pre className="bg-[#1c2128] p-4 rounded-lg overflow-auto text-sm text-gray-300 whitespace-pre-wrap max-h-[400px]">
              {error?.message}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="mt-6 bg-white text-black px-6 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
