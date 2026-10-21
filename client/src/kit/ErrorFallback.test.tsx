import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorFallback from './ErrorFallback.js';

describe('ErrorFallback', () => {
  it('renders the error message', () => {
    const error = new Error('Something exploded');
    const resetErrorBoundary = vi.fn();

    render(<ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />);

    expect(screen.getByText('Something exploded')).toBeInTheDocument();
  });

  it('renders the "Something went wrong" heading', () => {
    const error = new Error('Test error');
    const resetErrorBoundary = vi.fn();

    render(<ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders the Try again button', () => {
    const error = new Error('Test error');
    const resetErrorBoundary = vi.fn();

    render(<ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('calls resetErrorBoundary when Try again is clicked', () => {
    const error = new Error('Test error');
    const resetErrorBoundary = vi.fn();

    render(<ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(resetErrorBoundary).toHaveBeenCalledOnce();
  });

  it('has role="alert" on the container', () => {
    const error = new Error('Alert test');
    const resetErrorBoundary = vi.fn();

    render(<ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders non-Error values as strings', () => {
    const error = 'plain string error';
    const resetErrorBoundary = vi.fn();

    // FallbackProps expects error to be an Error, but component handles non-Error via String()
    render(
      <ErrorFallback error={error as unknown as Error} resetErrorBoundary={resetErrorBoundary} />
    );

    expect(screen.getByText('plain string error')).toBeInTheDocument();
  });
});
