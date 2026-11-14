import { describe, expect, it } from 'vitest';
import { createErrorLogger } from './errorLog';
import type { ErrorSink } from './errorLog';

function recordingSink() {
  const messages: string[] = [];
  const errors: unknown[] = [];
  const sink: ErrorSink = (message, error) => {
    messages.push(message);
    errors.push(error);
  };
  return { messages, errors, sink };
}

describe('createErrorLogger', () => {
  it('reports an error with its message and the error itself', () => {
    const { messages, errors, sink } = recordingSink();
    const failure = new Error('detector exploded');
    createErrorLogger(sink)(failure);
    expect(messages).toEqual(['[pose] detector exploded']);
    expect(errors).toEqual([failure]);
  });

  it('reports each distinct message once', () => {
    const { messages, sink } = recordingSink();
    const log = createErrorLogger(sink);
    for (let i = 0; i < 100; i++) {
      log(new Error('same every frame'));
      if (i % 10 === 0) log(new TypeError('different'));
    }
    expect(messages).toEqual(['[pose] same every frame', '[pose] different']);
  });

  it('reports thrown values that are not errors', () => {
    const { messages, sink } = recordingSink();
    const log = createErrorLogger(sink);
    log('a string');
    log(42);
    log(undefined);
    expect(messages).toEqual(['[pose] a string', '[pose] 42', '[pose] undefined']);
  });

  it('goes quiet after the cap on distinct messages, saying so once', () => {
    const { messages, sink } = recordingSink();
    const log = createErrorLogger(sink, 3);
    for (let i = 0; i < 50; i++) log(new Error(`timestamp ${i} is too old`));
    expect(messages).toHaveLength(4);
    expect(messages.slice(0, 3)).toEqual([
      '[pose] timestamp 0 is too old',
      '[pose] timestamp 1 is too old',
      '[pose] timestamp 2 is too old',
    ]);
    expect(messages[3]).toContain('further errors are not shown');
  });

  it('keeps separate loggers independent', () => {
    const first = recordingSink();
    const second = recordingSink();
    createErrorLogger(first.sink)(new Error('boom'));
    createErrorLogger(second.sink)(new Error('boom'));
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
  });
});
