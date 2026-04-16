import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Compose stack helper for backend-mode E2E.
 *
 * The stack (Postgres + containerus-server + disposable SSH target) is heavy
 * to boot, so we default to `reuse` — once it's up it stays up across test
 * files. A single fixture brings it up at worker start and tears it down at
 * worker stop; individual specs talk to it via the loopback-bound ports.
 */

const COMPOSE_FILE = path.resolve(__dirname, '../../fixtures/backend-mode/docker-compose.yml');
const PROJECT = 'containerus-e2e-backend';

const DB_PORT = 15432;
export const SERVER_PORT = 18080;
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
export const SSH_HOST = '127.0.0.1';
export const SSH_PORT = 12222;
export const SSH_USER = 'tester';
export const SSH_PASSWORD = 'tester-pass-e2e';
export { DB_PORT };

export const BOOT_TIMEOUT_MS = 180_000;
export const HEALTH_POLL_MS = 1_500;

function run(args: string[], opts: { check?: boolean } = {}): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (opts.check && (res.status ?? 1) !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited ${res.status}\nstderr:\n${res.stderr}`);
  }
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

export function dockerAvailable(): boolean {
  const res = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  return res.status === 0 && !!res.stdout.trim();
}

export function up(): void {
  run(['up', '-d', '--wait', '--build'], { check: true });
}

export function down(): void {
  // `-v` removes anonymous volumes (Postgres pgdata) so the next run starts fresh.
  run(['down', '-v', '--remove-orphans'], { check: false });
}

/**
 * Poll the server's /api/health endpoint until it returns 200 or we time out.
 * docker compose --wait only checks the container state, not the HTTP layer.
 */
export async function waitForServer(timeoutMs = BOOT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return;
      lastErr = new Error(`/api/health returned ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`containerus-server never became healthy: ${lastErr}`);
}

/**
 * Execute a single command inside the disposable SSH target container.
 * Used by specs that need to seed fixtures on the remote (e.g. start a TCP
 * echo listener) without going through the full SSH channel.
 */
export function execInSshTarget(cmd: string[]): { code: number; stdout: string; stderr: string } {
  return run(['exec', '-T', 'ssh-target', ...cmd]);
}

/**
 * Tail the server's stderr/stdout for debugging a flaking spec. Invoked from
 * a test with `DEBUG_BACKEND_LOGS=1` — otherwise silent.
 */
export function tailServerLogs(): ReturnType<typeof spawn> | null {
  if (!process.env.DEBUG_BACKEND_LOGS) return null;
  return spawn('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, 'logs', '-f', 'server'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}
