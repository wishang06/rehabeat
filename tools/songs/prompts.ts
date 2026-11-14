/**
 * Everything the CLI says or asks goes through a Prompter, so a flow can run against
 * clack in a terminal, against plain output with --yes, or against a scripted fake in
 * the tests. A cancelled prompt (Ctrl+C, Esc) throws CancelledError.
 */
import type { Readable, Writable } from 'node:stream';
import * as clack from '@clack/prompts';
import { CancelledError } from './errors';

export type Validate = (value: string) => string | undefined;

export interface TextQuestion {
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: Validate;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectQuestion<T extends string> {
  message: string;
  options: Choice<T>[];
  initialValue?: T;
}

export interface ConfirmQuestion {
  message: string;
  initialValue?: boolean;
}

export interface Spinner {
  start(message: string): void;
  message(message: string): void;
  stop(message: string): void;
  error(message: string): void;
}

export interface Prompter {
  /** False for --yes: the flow must not ask anything. */
  readonly interactive: boolean;
  intro(title: string): void;
  outro(message: string): void;
  /** Ends a flow that stopped without doing anything. */
  cancel(message: string): void;
  note(body: string, title?: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  text(question: TextQuestion): Promise<string>;
  select<T extends string>(question: SelectQuestion<T>): Promise<T>;
  confirm(question: ConfirmQuestion): Promise<boolean>;
  spinner(): Spinner;
}

function answered<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as Exclude<T, symbol>;
}

/** Streams for clack: the terminal by default; a test can pass its own to type into the real prompts. */
export interface PromptStreams {
  input?: Readable;
  output?: Writable;
}

export function clackPrompter(streams: PromptStreams = {}): Prompter {
  const io = { input: streams.input, output: streams.output };
  const out = { output: streams.output };
  return {
    interactive: true,
    intro: (title) => clack.intro(title, out),
    outro: (message) => clack.outro(message, out),
    cancel: (message) => clack.cancel(message, out),
    note: (body, title) => clack.note(body, title, out),
    info: (message) => clack.log.info(message, out),
    success: (message) => clack.log.success(message, out),
    warn: (message) => clack.log.warn(message, out),
    error: (message) => clack.log.error(message, out),
    async text(question) {
      const { validate } = question;
      return answered(
        await clack.text({
          ...io,
          message: question.message,
          placeholder: question.placeholder,
          initialValue: question.initialValue,
          validate: validate ? (value) => validate(value ?? '') : undefined,
        }),
      );
    },
    async select<T extends string>(question: SelectQuestion<T>) {
      // Clack's option type is conditional on T; the shape is the same.
      const options = question.options as unknown as Parameters<typeof clack.select<T>>[0]['options'];
      return answered(await clack.select<T>({ ...io, message: question.message, options, initialValue: question.initialValue }));
    },
    async confirm(question) {
      return answered(await clack.confirm({ ...io, message: question.message, initialValue: question.initialValue }));
    },
    spinner() {
      const spin = clack.spinner(out);
      return {
        start: (message) => spin.start(message),
        message: (message) => spin.message(message),
        stop: (message) => spin.stop(message),
        error: (message) => spin.error(message),
      };
    },
  };
}

/**
 * Plain lines for --yes and for output piped to a file or CI log: no colours, no
 * redrawing. A spinner prints when it starts and stops, and its progress at most every
 * `progressEverySec` seconds. Asking a question is a bug here and throws.
 */
export function plainPrompter(
  out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  err: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  progressEverySec = 15,
  now: () => number = () => Date.now(),
): Prompter {
  const refuse = (message: string): never => {
    throw new Error(`Internal error: tried to ask "${message}" without a terminal.`);
  };
  return {
    interactive: false,
    intro: (title) => out(title),
    outro: (message) => out(message),
    cancel: (message) => err(message),
    note: (body, title) => {
      if (title) out(`${title}:`);
      for (const line of body.split('\n')) out(`  ${line}`);
    },
    info: (message) => out(message),
    success: (message) => out(message),
    warn: (message) => err(`warning: ${message}`),
    error: (message) => err(`error: ${message}`),
    text: async (question) => refuse(question.message),
    select: async (question) => refuse(question.message),
    confirm: async (question) => refuse(question.message),
    spinner() {
      let last = 0;
      return {
        start(message) {
          last = now();
          out(`${message}...`);
        },
        message(message) {
          if (now() - last >= progressEverySec * 1000) {
            last = now();
            out(`  ${message}`);
          }
        },
        stop: (message) => out(message),
        error: (message) => err(message), // the CLI prints the error itself just after
      };
    },
  };
}
