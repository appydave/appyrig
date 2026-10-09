import type { FallbackProps } from 'react-error-boundary';

export default function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="p-6 bg-red-900/20 border border-red-500 rounded-lg text-center">
      <h2 className="text-red-400 text-lg font-bold mb-2">Something went wrong</h2>
      <pre className="text-red-300 text-sm mb-4">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <button
        onClick={resetErrorBoundary}
        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
      >
        Try again
      </button>
    </div>
  );
}
