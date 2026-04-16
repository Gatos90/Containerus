import { SERVER_URL, SSH_HOST, SSH_PASSWORD, SSH_PORT, SSH_USER } from './compose';

export type Tokens = { accessToken: string; refreshToken: string };

export interface BackendFixture extends Tokens {
  userId: string;
  projectId: string;
  environmentId: string;
  systemId: string;
}

async function api<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}\n${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export async function register(email: string, password: string, displayName = 'Tester'): Promise<{ tokens: Tokens; userId: string }> {
  const body = await api<{ accessToken: string; refreshToken: string; user: { id: string } }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password, displayName }) },
  );
  return {
    tokens: { accessToken: body.accessToken, refreshToken: body.refreshToken },
    userId: body.user.id,
  };
}

export async function login(email: string, password: string): Promise<Tokens> {
  const body = await api<{ accessToken: string; refreshToken: string }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const body = await api<{ accessToken: string; refreshToken: string }>(
    '/api/auth/refresh',
    { method: 'POST', body: JSON.stringify({ refreshToken }) },
  );
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

export async function me(token: string): Promise<{ id: string; email: string; isCompanyAdmin: boolean; permissions: string[] }> {
  return api('/api/auth/me', { method: 'GET' }, token);
}

export async function createProject(token: string, name: string, slug: string): Promise<{ id: string }> {
  return api<{ id: string }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  }, token);
}

export async function createEnvironment(token: string, projectId: string, name: string, slug: string): Promise<{ id: string }> {
  return api<{ id: string }>(`/api/projects/${projectId}/environments`, {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  }, token);
}

export async function createSshSystem(token: string, projectId: string, environmentId: string, name: string): Promise<{ id: string }> {
  return api<{ id: string }>(
    `/api/projects/${projectId}/environments/${environmentId}/systems`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        hostname: SSH_HOST,
        port: SSH_PORT,
        username: SSH_USER,
        primaryRuntime: 'docker',
        authMethod: 'password',
        password: SSH_PASSWORD,
      }),
    },
    token,
  );
}

/**
 * One-shot bootstrap: register the first user (auto-company-admin), create a
 * project + environment, and register the disposable SSH target as a system.
 * Specs receive a ready-to-use `{ accessToken, systemId, ... }` bundle.
 */
export async function bootstrapFixture(): Promise<BackendFixture> {
  const email = `e2e+${Date.now().toString(36)}@containerus.local`;
  const password = 'backend-mode-e2e-password';

  const { tokens, userId } = await register(email, password);
  const project = await createProject(tokens.accessToken, `E2E ${Date.now()}`, `e2e-${Date.now().toString(36)}`);
  const environment = await createEnvironment(tokens.accessToken, project.id, 'dev', 'dev');
  const system = await createSshSystem(tokens.accessToken, project.id, environment.id, 'ssh-target');

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId,
    projectId: project.id,
    environmentId: environment.id,
    systemId: system.id,
  };
}
