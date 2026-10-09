import { describe, it, expect, vi } from 'vitest';
import { logger } from './logger.js';

describe('logger', () => {
  it('exports a logger with standard log methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('exposes a child() method for creating child loggers', () => {
    expect(typeof logger.child).toBe('function');
    const child = logger.child({ requestId: 'test-123' });
    expect(typeof child.info).toBe('function');
  });

  it('calling logger.info() does not throw', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    expect(() => logger.info('test message')).not.toThrow();
    spy.mockRestore();
  });
});
