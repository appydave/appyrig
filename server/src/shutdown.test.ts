import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { httpServer } from './index.js';

describe('signal handler registration', () => {
  it('registers a SIGTERM listener on the process', () => {
    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
  });

  it('registers a SIGINT listener on the process', () => {
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
  });
});

describe('graceful shutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as () => never);
  });

  afterAll(() => {
    // Restore process.exit so subsequent code can exit normally
    exitSpy?.mockRestore();

    // Close the httpServer to prevent test hangs if it is still listening
    return new Promise<void>((resolve) => {
      if (httpServer.listening) {
        httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it('calls process.exit(0) when SIGTERM is emitted', () =>
    new Promise<void>((resolve, reject) => {
      // Give the close callback time to fire after SIGTERM triggers shutdown
      const originalClose = httpServer.close.bind(httpServer);
      const closeSpy = vi
        .spyOn(httpServer, 'close')
        .mockImplementation((cb?: (err?: Error) => void) => {
          // Invoke the real close so handles are released, but call cb immediately
          if (cb) cb();
          return originalClose();
        });

      exitSpy.mockImplementation((() => {
        try {
          expect(exitSpy).toHaveBeenCalledWith(0);
          closeSpy.mockRestore();
          resolve();
        } catch (err) {
          closeSpy.mockRestore();
          reject(err);
        }
      }) as () => never);

      process.emit('SIGTERM');
    }));

  it('calls process.exit(0) when SIGINT is emitted', () =>
    new Promise<void>((resolve, reject) => {
      const originalClose = httpServer.close.bind(httpServer);
      const closeSpy = vi
        .spyOn(httpServer, 'close')
        .mockImplementation((cb?: (err?: Error) => void) => {
          if (cb) cb();
          return originalClose();
        });

      exitSpy.mockImplementation((() => {
        try {
          expect(exitSpy).toHaveBeenCalledWith(0);
          closeSpy.mockRestore();
          resolve();
        } catch (err) {
          closeSpy.mockRestore();
          reject(err);
        }
      }) as () => never);

      process.emit('SIGINT');
    }));

  it('passes 0 as the exit code to process.exit', () =>
    new Promise<void>((resolve, reject) => {
      const originalClose = httpServer.close.bind(httpServer);
      const closeSpy = vi
        .spyOn(httpServer, 'close')
        .mockImplementation((cb?: (err?: Error) => void) => {
          if (cb) cb();
          return originalClose();
        });

      exitSpy.mockImplementation(((code: number) => {
        try {
          expect(code).toBe(0);
          closeSpy.mockRestore();
          resolve();
        } catch (err) {
          closeSpy.mockRestore();
          reject(err);
        }
      }) as () => never);

      process.emit('SIGTERM');
    }));
});
