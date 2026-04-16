import { Injectable } from '@angular/core';

export interface MappedError {
  message: string;
  recovery?: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string; recovery: string }> = [
  {
    pattern: /permission denied/i,
    message: 'Permission denied.',
    recovery: 'Ensure your user has the required Docker/Podman permissions (e.g. is in the docker group).',
  },
  {
    pattern: /connection refused/i,
    message: 'Connection refused.',
    recovery: 'Check that the container daemon is running and accessible.',
  },
  {
    pattern: /no such container/i,
    message: 'Container not found.',
    recovery: 'The container may have been removed. Try refreshing the list.',
  },
  {
    pattern: /no such image/i,
    message: 'Image not found locally.',
    recovery: 'Pull the image first before using it.',
  },
  {
    pattern: /no space left on device/i,
    message: 'Disk is full.',
    recovery: 'Free up disk space or prune unused images and containers.',
  },
  {
    pattern: /port is already allocated|address already in use/i,
    message: 'Port already in use.',
    recovery: 'Stop the conflicting process or choose a different host port.',
  },
  {
    pattern: /conflict.*container name/i,
    message: 'A container with that name already exists.',
    recovery: 'Remove the existing container or choose a different name.',
  },
  {
    pattern: /oci runtime/i,
    message: 'Container runtime error.',
    recovery: 'Check the container configuration and try again.',
  },
  {
    pattern: /image.*not found|manifest unknown/i,
    message: 'Image not found in registry.',
    recovery: 'Verify the image name and tag, then try again.',
  },
  {
    pattern: /unauthorized|authentication required/i,
    message: 'Authentication required.',
    recovery: 'Log in to the registry (docker login) and try again.',
  },
  {
    pattern: /network.*not found/i,
    message: 'Network not found.',
    recovery: 'The network may have been removed. Try refreshing.',
  },
  {
    pattern: /volume.*in use/i,
    message: 'Volume is in use.',
    recovery: 'Stop all containers using this volume before removing it.',
  },
  {
    pattern: /timeout|timed out/i,
    message: 'Operation timed out.',
    recovery: 'Check your connection to the host and try again.',
  },
  {
    pattern: /host key verification failed/i,
    message: 'SSH host key verification failed.',
    recovery: 'The remote host key has changed. Verify the host is legitimate before trusting.',
  },
  {
    pattern: /ssh.*refused|ssh.*failed/i,
    message: 'SSH connection failed.',
    recovery: 'Verify the host address, credentials, and that SSH is running on the remote system.',
  },
];

@Injectable({ providedIn: 'root' })
export class ErrorMappingService {
  /**
   * Extract a raw string from a Tauri/backend error (any shape).
   */
  extractRaw(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
      const entries = Object.entries(err as Record<string, unknown>);
      if (entries.length === 1) {
        const [, value] = entries[0];
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(': ');
        if (value && typeof value === 'object') {
          const inner = value as Record<string, unknown>;
          if (typeof inner['reason'] === 'string') return inner['reason'] as string;
          if (typeof inner['message'] === 'string') return inner['message'] as string;
          if (typeof inner['stderr'] === 'string')
            return `${inner['command'] ?? 'Command'}: ${inner['stderr']}`;
          return JSON.stringify(value);
        }
      }
      return JSON.stringify(err);
    }
    return String(err);
  }

  /**
   * Map an error to a user-friendly message with optional recovery steps.
   */
  map(err: unknown): MappedError {
    const raw = this.extractRaw(err);
    for (const { pattern, message, recovery } of ERROR_PATTERNS) {
      if (pattern.test(raw)) {
        return { message, recovery };
      }
    }
    return { message: raw, recovery: 'Try refreshing or reconnecting.' };
  }

  /**
   * Return a single string suitable for toast notifications.
   * Combines the friendly message with recovery hint when present.
   */
  format(err: unknown): string {
    const { message, recovery } = this.map(err);
    return recovery ? `${message} ${recovery}` : message;
  }
}
