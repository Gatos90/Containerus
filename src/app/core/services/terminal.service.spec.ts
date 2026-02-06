import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalService, TerminalSession } from './terminal.service';

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

describe('TerminalService', () => {
  let service: TerminalService;
  let mockTauri: any;
  let mockZone: any;

  beforeEach(() => {
    mockTauri = {
      invoke: vi.fn(),
    };
    mockZone = {
      run: vi.fn((fn: Function) => fn()),
    };
    service = new TerminalService(mockTauri, mockZone);
  });

  it('should start a session and store it', async () => {
    const session: TerminalSession = {
      id: 'sess-1',
      systemId: 'sys-1',
      shell: '/bin/bash',
    };
    mockTauri.invoke.mockResolvedValue(session);

    const result = await service.startSession('sys-1', undefined, '/bin/bash');
    expect(result).toEqual(session);
    expect(mockTauri.invoke).toHaveBeenCalledWith('start_terminal_session', {
      systemId: 'sys-1',
      containerId: undefined,
      shell: '/bin/bash',
    });
    expect(service.getSession('sess-1')).toEqual(session);
  });

  it('should start session with container id', async () => {
    const session: TerminalSession = {
      id: 'sess-2',
      systemId: 'sys-1',
      containerId: 'container-1',
      shell: '/bin/sh',
    };
    mockTauri.invoke.mockResolvedValue(session);

    const result = await service.startSession('sys-1', 'container-1');
    expect(result).toEqual(session);
    expect(mockTauri.invoke).toHaveBeenCalledWith('start_terminal_session', {
      systemId: 'sys-1',
      containerId: 'container-1',
      shell: '/bin/sh',
    });
  });

  it('should send input to a session', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.sendInput('sess-1', 'ls -la\n');
    expect(mockTauri.invoke).toHaveBeenCalledWith('send_terminal_input', {
      sessionId: 'sess-1',
      data: 'ls -la\n',
    });
  });

  it('should resize a terminal session', async () => {
    mockTauri.invoke.mockResolvedValue(undefined);

    await service.resize('sess-1', 80, 24);
    expect(mockTauri.invoke).toHaveBeenCalledWith('resize_terminal', {
      sessionId: 'sess-1',
      cols: 80,
      rows: 24,
    });
  });

  it('should close a session and clean up', async () => {
    const session: TerminalSession = {
      id: 'sess-1',
      systemId: 'sys-1',
      shell: '/bin/sh',
    };
    mockTauri.invoke.mockResolvedValue(session);
    await service.startSession('sys-1');

    mockTauri.invoke.mockResolvedValue(undefined);
    await service.closeSession('sess-1');

    expect(mockTauri.invoke).toHaveBeenCalledWith('close_terminal_session', {
      sessionId: 'sess-1',
    });
    expect(service.getSession('sess-1')).toBeUndefined();
  });

  it('should return undefined for non-existent session', () => {
    expect(service.getSession('nonexistent')).toBeUndefined();
  });

  it('should get all sessions', async () => {
    mockTauri.invoke
      .mockResolvedValueOnce({ id: 's1', systemId: 'sys-1', shell: '/bin/sh' })
      .mockResolvedValueOnce({ id: 's2', systemId: 'sys-2', shell: '/bin/bash' });

    await service.startSession('sys-1');
    await service.startSession('sys-2', undefined, '/bin/bash');

    const sessions = service.getAllSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('should fetch shell history', async () => {
    const history = ['ls', 'cd /tmp', 'docker ps'];
    mockTauri.invoke.mockResolvedValue(history);

    const result = await service.fetchShellHistory('sys-1', 100, 'docker');
    expect(result).toEqual(history);
    expect(mockTauri.invoke).toHaveBeenCalledWith('fetch_shell_history', {
      systemId: 'sys-1',
      maxEntries: 100,
      filter: 'docker',
    });
  });

  it('should fetch shell history with defaults', async () => {
    mockTauri.invoke.mockResolvedValue([]);

    await service.fetchShellHistory('sys-1');
    expect(mockTauri.invoke).toHaveBeenCalledWith('fetch_shell_history', {
      systemId: 'sys-1',
      maxEntries: 500,
      filter: undefined,
    });
  });
});
