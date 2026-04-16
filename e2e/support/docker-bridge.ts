/**
 * Node-side wrappers around the local `docker` CLI. Used by the real-Docker
 * E2E fixture to drive state the Angular UI observes through the Tauri IPC
 * shim, and to assert against what actually happened at the daemon.
 *
 * All state-shapes here match the frontend model types (lowercase enums,
 * camelCase fields) — Tauri ordinarily does the mapping via serde. In the
 * real-Docker E2E environment the Rust backend is bypassed, so this module
 * is responsible for the wire shape.
 */
import { execFile, spawn } from 'node:child_process';

export const LOCAL_SYSTEM_ID = 'e2e-local-docker';

export type ContainerStatus =
  | 'running'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'created'
  | 'removing';

export interface BridgeContainer {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  state: ContainerStatus;
  runtime: 'docker';
  systemId: string;
  createdAt: string;
  ports: Array<{ containerPort: number; hostPort: number | null; protocol: string }>;
}

export interface BridgeImage {
  id: string;
  name: string;
  tag: string;
  size: number;
  runtime: 'docker';
  systemId: string;
  createdAt: string;
}

export interface BridgeVolume {
  name: string;
  driver: string;
  mountpoint: string;
  runtime: 'docker';
  systemId: string;
  createdAt: string;
}

export interface BridgeNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  runtime: 'docker';
  systemId: string;
  createdAt: string;
}

function run(bin: string, args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = (err && 'code' in err && typeof err.code === 'number') ? (err.code as number) : (err ? 1 : 0);
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
    });
  });
}

/** True if `docker info` succeeds — assume local daemon is reachable. */
export async function dockerAvailable(): Promise<boolean> {
  const { code } = await run('docker', ['info'], 5_000);
  return code === 0;
}

function normStatus(state: string): ContainerStatus {
  const s = state.toLowerCase();
  if (s.includes('running')) return 'running';
  if (s.includes('exit')) return 'exited';
  if (s.includes('pause')) return 'paused';
  if (s.includes('restart')) return 'restarting';
  if (s.includes('creat')) return 'created';
  if (s.includes('remov')) return 'removing';
  return 'exited';
}

export async function listContainers(systemId: string): Promise<BridgeContainer[]> {
  const { stdout, code } = await run('docker', ['ps', '-a', '--format', '{{json .}}']);
  if (code !== 0) return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      const status = normStatus(String(row.State ?? row.Status ?? ''));
      return {
        id: String(row.ID ?? ''),
        name: String(row.Names ?? '').split(',')[0] ?? '',
        image: String(row.Image ?? ''),
        status,
        state: status,
        runtime: 'docker' as const,
        systemId,
        createdAt: String(row.CreatedAt ?? new Date().toISOString()),
        ports: [],
      };
    });
}

export async function performContainerAction(id: string, action: string): Promise<null> {
  const map: Record<string, string[]> = {
    start: ['start', id],
    stop: ['stop', id],
    restart: ['restart', id],
    remove: ['rm', '-f', id],
    pause: ['pause', id],
    unpause: ['unpause', id],
  };
  const cmd = map[action];
  if (!cmd) throw new Error(`Unknown action: ${action}`);
  const { code, stderr } = await run('docker', cmd);
  if (code !== 0) throw new Error(`docker ${action} ${id} failed: ${stderr}`);
  return null;
}

export async function inspectContainer(id: string): Promise<unknown> {
  const { stdout, code, stderr } = await run('docker', ['inspect', id]);
  if (code !== 0) throw new Error(`docker inspect failed: ${stderr}`);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

export async function getContainerLogs(id: string, tail: number): Promise<string> {
  const { stdout, stderr, code } = await run('docker', ['logs', '--tail', String(tail), id]);
  if (code !== 0) throw new Error(`docker logs failed: ${stderr}`);
  return stdout + stderr;
}

export async function listImages(systemId: string): Promise<BridgeImage[]> {
  const { stdout, code } = await run('docker', ['images', '--format', '{{json .}}']);
  if (code !== 0) return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      return {
        id: String(row.ID ?? ''),
        name: String(row.Repository ?? ''),
        tag: String(row.Tag ?? ''),
        size: 0,
        runtime: 'docker' as const,
        systemId,
        createdAt: String(row.CreatedAt ?? new Date().toISOString()),
      };
    });
}

export interface PullHandle {
  onProgress(cb: (line: string) => void): void;
  done: Promise<{ code: number; output: string }>;
  cancel(): void;
}

export function pullImage(ref: string): PullHandle {
  const proc = spawn('docker', ['pull', ref]);
  const progressCbs: Array<(line: string) => void> = [];
  let output = '';
  proc.stdout.on('data', (d) => {
    const s = d.toString();
    output += s;
    for (const cb of progressCbs) cb(s);
  });
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    output += s;
    for (const cb of progressCbs) cb(s);
  });
  const done = new Promise<{ code: number; output: string }>((resolve) => {
    proc.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
  return {
    onProgress(cb) { progressCbs.push(cb); },
    done,
    cancel() { try { proc.kill('SIGTERM'); } catch { /* ignore */ } },
  };
}

export async function removeImage(ref: string): Promise<null> {
  const { code } = await run('docker', ['rmi', '-f', ref]);
  if (code !== 0) {
    // tolerate "not found" — callers treat removal as idempotent.
  }
  return null;
}

export async function listVolumes(systemId: string): Promise<BridgeVolume[]> {
  const { stdout, code } = await run('docker', ['volume', 'ls', '--format', '{{json .}}']);
  if (code !== 0) return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      return {
        name: String(row.Name ?? ''),
        driver: String(row.Driver ?? 'local'),
        mountpoint: String(row.Mountpoint ?? ''),
        runtime: 'docker' as const,
        systemId,
        createdAt: new Date().toISOString(),
      };
    });
}

export async function createVolume(name: string): Promise<null> {
  const { code, stderr } = await run('docker', ['volume', 'create', name]);
  if (code !== 0) throw new Error(`docker volume create failed: ${stderr}`);
  return null;
}

export async function removeVolume(name: string): Promise<null> {
  await run('docker', ['volume', 'rm', '-f', name]);
  return null;
}

export async function listNetworks(systemId: string): Promise<BridgeNetwork[]> {
  const { stdout, code } = await run('docker', ['network', 'ls', '--format', '{{json .}}']);
  if (code !== 0) return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line);
      return {
        id: String(row.ID ?? ''),
        name: String(row.Name ?? ''),
        driver: String(row.Driver ?? 'bridge'),
        scope: String(row.Scope ?? 'local'),
        runtime: 'docker' as const,
        systemId,
        createdAt: new Date().toISOString(),
      };
    });
}

export async function createNetwork(name: string, driver: string): Promise<null> {
  const { code, stderr } = await run('docker', ['network', 'create', '--driver', driver, name]);
  if (code !== 0) throw new Error(`docker network create failed: ${stderr}`);
  return null;
}

export async function removeNetwork(name: string): Promise<null> {
  await run('docker', ['network', 'rm', name]);
  return null;
}

export interface RunDetachedOpts {
  name: string;
  image: string;
  cmd?: string[];
  ports?: string[];
}

export async function runDetached(opts: RunDetachedOpts): Promise<string> {
  const args = ['run', '-d', '--name', opts.name];
  for (const p of opts.ports ?? []) args.push('-p', p);
  args.push(opts.image);
  if (opts.cmd) args.push(...opts.cmd);
  const { stdout, stderr, code } = await run('docker', args);
  if (code !== 0) throw new Error(`docker run failed: ${stderr}`);
  return stdout.trim();
}

export async function removeIfExists(resource: 'container' | 'volume' | 'network' | 'image', name: string): Promise<void> {
  if (resource === 'container') await run('docker', ['rm', '-f', name]);
  else if (resource === 'volume') await run('docker', ['volume', 'rm', '-f', name]);
  else if (resource === 'network') await run('docker', ['network', 'rm', name]);
  else if (resource === 'image') await run('docker', ['rmi', '-f', name]);
}

/**
 * Remove every e2e-prefixed resource. Called after each test so parallel
 * runs never leak state into the next one.
 */
export async function cleanupE2EResources(prefix: string): Promise<void> {
  const kinds: Array<'container' | 'volume' | 'network'> = ['container', 'volume', 'network'];
  for (const kind of kinds) {
    const listArgs =
      kind === 'container'
        ? ['ps', '-a', '--filter', `name=${prefix}`, '--format', '{{.Names}}']
        : kind === 'volume'
          ? ['volume', 'ls', '--filter', `name=${prefix}`, '--format', '{{.Name}}']
          : ['network', 'ls', '--filter', `name=${prefix}`, '--format', '{{.Name}}'];
    const { stdout } = await run('docker', listArgs);
    for (const name of stdout.split('\n').filter(Boolean)) {
      await removeIfExists(kind, name);
    }
  }
}

export async function ensureImage(ref: string): Promise<void> {
  const { code } = await run('docker', ['image', 'inspect', ref], 5_000);
  if (code === 0) return;
  const handle = pullImage(ref);
  const { code: pullCode, output } = await handle.done;
  if (pullCode !== 0) throw new Error(`ensureImage(${ref}) failed:\n${output}`);
}
