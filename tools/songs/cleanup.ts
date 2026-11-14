/**
 * Leaves nothing behind when the CLI stops early. Clack's prompts call process.exit()
 * on Ctrl+C, and Node's default SIGINT handling skips 'exit' listeners, so both routes
 * end up here: running child processes are killed (with Demucs, which Python starts as
 * its own child, on Windows) and staged folders are deleted.
 */
import { spawnSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

const children = new Set<ChildProcess>();
const folders = new Set<string>();
let installed = false;

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM'); // the child was started as a process group leader
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function runCleanup(): void {
  for (const child of children) killTree(child);
  children.clear();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  folders.clear();
}

export function installCleanupHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('exit', runCleanup);
  process.on('SIGINT', () => {
    runCleanup();
    process.stderr.write('\nStopped.\n');
    process.exit(130);
  });
}

export function trackChild(child: ChildProcess): void {
  children.add(child);
  child.once('close', () => children.delete(child));
}

/** Deletes `folder` if the CLI exits before release(folder) is called. */
export function deleteOnExit(folder: string): void {
  folders.add(folder);
}

export function release(folder: string): void {
  folders.delete(folder);
}
