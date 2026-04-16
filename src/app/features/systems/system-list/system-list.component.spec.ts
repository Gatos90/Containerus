import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { SystemListComponent } from './system-list.component';
import { SystemState } from '../../../state/system.state';
import { AppState } from '../../../state/app.state';
import { SystemService } from '../../../core/services/system.service';
import { KeychainService } from '../../../core/services/keychain.service';
import { TerminalState } from '../../../state/terminal.state';
import { TerminalService } from '../../../core/services/terminal.service';
import { ToastState } from '../../../state/toast.state';
import type { ContainerSystem, LiveSystemMetrics, SshHostEntry } from '../../../core/models/system.model';

function makeComponent(): SystemListComponent {
  const mockSystemState: any = {
    systems: vi.fn(() => []),
    connectionStates: vi.fn(() => ({})),
    extendedInfo: vi.fn(() => ({})),
    loading: vi.fn(() => false),
    error: vi.fn(() => null),
    selectedSystemId: vi.fn(() => null),
    searchQuery: vi.fn(() => ''),
    statusFilter: vi.fn(() => null),
    hostKeyMismatch: vi.fn(() => null),
    selectedSystem: vi.fn(() => null),
    connectedSystems: vi.fn(() => []),
    disconnectedSystems: vi.fn(() => []),
    filteredSystems: vi.fn(() => []),
    loadSystems: vi.fn().mockResolvedValue(undefined),
    connectSystem: vi.fn().mockResolvedValue(true),
    disconnectSystem: vi.fn().mockResolvedValue(undefined),
    addSystem: vi.fn().mockResolvedValue(null),
    updateSystem: vi.fn().mockResolvedValue(null),
    removeSystem: vi.fn().mockResolvedValue(undefined),
    detectRuntimes: vi.fn().mockResolvedValue(undefined),
    getConnectionState: vi.fn(() => 'disconnected'),
    getExtendedInfo: vi.fn(() => null),
    getLiveMetrics: vi.fn(() => null),
    fetchExtendedInfo: vi.fn().mockResolvedValue(null),
    setError: vi.fn(),
    clearError: vi.fn(),
  };

  const mockAppState: any = {
    loadAllDataForSystem: vi.fn().mockResolvedValue(undefined),
    clearDataForSystem: vi.fn(),
    waitForReady: vi.fn().mockResolvedValue(undefined),
  };

  const mockSystemService: any = {
    getAppSettings: vi.fn().mockResolvedValue({ sshConfigPaths: [] }),
    listSshConfigHosts: vi.fn().mockResolvedValue([]),
    getSshHostConfig: vi.fn().mockResolvedValue({}),
    storeSshCredentials: vi.fn().mockResolvedValue(undefined),
    browseSshKey: vi.fn().mockResolvedValue(null),
    browseAndImportSshKey: vi.fn().mockResolvedValue(null),
  };

  const mockKeychainService: any = {
    checkPlatform: vi.fn().mockResolvedValue(false),
  };

  const mockTerminalState: any = {
    addTerminal: vi.fn(),
    generateTerminalId: vi.fn(() => 'term-1'),
  };

  const mockTerminalService: any = {
    startSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
  };

  const mockToastState: any = {
    error: vi.fn(),
    success: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      { provide: SystemState, useValue: mockSystemState },
      { provide: AppState, useValue: mockAppState },
      { provide: SystemService, useValue: mockSystemService },
      { provide: KeychainService, useValue: mockKeychainService },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: TerminalService, useValue: mockTerminalService },
      { provide: ToastState, useValue: mockToastState },
    ],
  });

  return runInInjectionContext(injector, () => new SystemListComponent());
}

describe('SystemListComponent', () => {
  let component: SystemListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('getOsIcon', () => {
    it('should return penguin for linux', () => {
      expect(component.getOsIcon('linux')).toBe('🐧');
    });

    it('should return apple for macos', () => {
      expect(component.getOsIcon('macos')).toBe('🍎');
    });

    it('should return windows emoji for windows', () => {
      expect(component.getOsIcon('windows')).toBe('🪟');
    });

    it('should return laptop for unknown', () => {
      expect(component.getOsIcon('unknown')).toBe('💻');
    });

    it('should return laptop for undefined', () => {
      expect(component.getOsIcon(undefined)).toBe('💻');
    });
  });

  describe('getOsName', () => {
    it('should return Linux for linux', () => {
      expect(component.getOsName('linux')).toBe('Linux');
    });

    it('should return macOS for macos', () => {
      expect(component.getOsName('macos')).toBe('macOS');
    });

    it('should return Windows for windows', () => {
      expect(component.getOsName('windows')).toBe('Windows');
    });

    it('should return Unknown for unknown type', () => {
      expect(component.getOsName('unknown')).toBe('Unknown');
    });

    it('should return Unknown for undefined', () => {
      expect(component.getOsName(undefined)).toBe('Unknown');
    });
  });

  describe('getLoadLevel', () => {
    it('should return unknown when metrics is null', () => {
      const result = component.getLoadLevel(null);
      expect(result.level).toBe('unknown');
      expect(result.dots).toBe(0);
      expect(result.score).toBe(0);
    });

    it('should return low when composite score < 30', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 10,
        memoryUsagePercent: 20,
        swapUsagePercent: 0,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('low');
      expect(result.color).toBe('text-green-500');
      expect(result.dots).toBe(1);
    });

    it('should return medium when composite score 30-60', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 50,
        memoryUsagePercent: 40,
        swapUsagePercent: 0,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('medium');
      expect(result.color).toBe('text-amber-500');
      expect(result.dots).toBe(3);
    });

    it('should return high when composite score 60-85', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 80,
        memoryUsagePercent: 70,
        swapUsagePercent: 50,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('high');
      expect(result.color).toBe('text-red-500');
      expect(result.dots).toBe(4);
    });

    it('should return critical when composite score >= 85', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 100,
        memoryUsagePercent: 95,
        swapUsagePercent: 80,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('critical');
      expect(result.color).toBe('text-red-600');
      expect(result.dots).toBe(5);
    });

    it('should handle null swapUsagePercent as 0', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 10,
        memoryUsagePercent: 10,
        swapUsagePercent: null,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.level).toBe('low');
    });

    it('should include score in tooltip', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 50,
        memoryUsagePercent: 40,
        swapUsagePercent: 0,
      };
      const result = component.getLoadLevel(metrics);
      expect(result.tooltip).toContain('%');
    });
  });

  describe('parseJumpHosts (via onSshHostSelected)', () => {
    it('should parse simple hostname', () => {
      const parsed = (component as any).parseJumpHosts('jumphost.example.com');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].hostname).toBe('jumphost.example.com');
      expect(parsed[0].port).toBe(22);
      expect(parsed[0].username).toBe('root');
    });

    it('should parse user@host format', () => {
      const parsed = (component as any).parseJumpHosts('admin@jumphost.example.com');
      expect(parsed[0].hostname).toBe('jumphost.example.com');
      expect(parsed[0].username).toBe('admin');
    });

    it('should parse user@host:port format', () => {
      const parsed = (component as any).parseJumpHosts('user@bastion.com:2222');
      expect(parsed[0].hostname).toBe('bastion.com');
      expect(parsed[0].port).toBe(2222);
      expect(parsed[0].username).toBe('user');
    });

    it('should parse multiple jump hosts separated by commas', () => {
      const parsed = (component as any).parseJumpHosts('jump1.com,jump2.com');
      expect(parsed).toHaveLength(2);
      expect(parsed[0].hostname).toBe('jump1.com');
      expect(parsed[1].hostname).toBe('jump2.com');
    });

    it('should resolve known SSH config hosts', () => {
      // Set up sshHosts signal
      const hosts: SshHostEntry[] = [{
        host: 'mybastion',
        hostname: 'bastion.internal.com',
        user: 'ubuntu',
        port: 2222,
        identityFile: '~/.ssh/id_rsa',
      }];
      (component as any).sshHosts.set(hosts);

      const parsed = (component as any).parseJumpHosts('mybastion');
      expect(parsed[0].hostname).toBe('bastion.internal.com');
      expect(parsed[0].username).toBe('ubuntu');
      expect(parsed[0].port).toBe(2222);
      expect(parsed[0].identityFile).toBe('~/.ssh/id_rsa');
    });

    it('should fall back to alias when host alias has no hostname', () => {
      const hosts: SshHostEntry[] = [{ host: 'mybastion' }];
      (component as any).sshHosts.set(hosts);

      const parsed = (component as any).parseJumpHosts('mybastion');
      expect(parsed[0].hostname).toBe('mybastion');
    });
  });

  describe('buildJumpHostForms', () => {
    it('should build forms with default publicKey auth', () => {
      const jumpHosts = [
        { hostname: 'bastion.com', port: 22, username: 'ubuntu', identityFile: null },
      ];
      const forms = (component as any).buildJumpHostForms(jumpHosts);
      expect(forms).toHaveLength(1);
      expect(forms[0].hostname).toBe('bastion.com');
      expect(forms[0].authMethod).toBe('publicKey');
      expect(forms[0].password).toBe('');
      expect(forms[0].keyContent).toBe('');
    });

    it('should preserve identityFile from jump host', () => {
      const jumpHosts = [
        { hostname: 'bastion.com', port: 2222, username: 'admin', identityFile: '/path/to/key' },
      ];
      const forms = (component as any).buildJumpHostForms(jumpHosts);
      expect(forms[0].identityFile).toBe('/path/to/key');
      expect(forms[0].port).toBe(2222);
    });
  });

  describe('collectJumpHostCredentials', () => {
    it('should return undefined when no credentials are set', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 22,
          username: 'ubuntu',
          authMethod: 'publicKey' as const,
          password: '',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeUndefined();
    });

    it('should collect password credentials', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 22,
          username: 'ubuntu',
          authMethod: 'password' as const,
          password: 'secret',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeDefined();
      expect(result['bastion.com:22'].password).toBe('secret');
    });

    it('should collect passphrase credentials', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 2222,
          username: 'ubuntu',
          authMethod: 'publicKey' as const,
          password: '',
          passphrase: 'my-passphrase',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeDefined();
      expect(result['bastion.com:2222'].passphrase).toBe('my-passphrase');
    });

    it('should collect key content credentials', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 22,
          username: 'ubuntu',
          authMethod: 'publicKey' as const,
          password: '',
          passphrase: '',
          keyContent: '-----BEGIN RSA PRIVATE KEY-----',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeDefined();
      expect(result['bastion.com:22'].privateKey).toBe('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('should use bracketed notation for IPv6 hostnames', () => {
      const forms = [
        {
          hostname: '::1',
          port: 22,
          username: 'ubuntu',
          authMethod: 'password' as const,
          password: 'pw',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeDefined();
      expect(result['[::1]:22']).toBeDefined();
    });

    it('should handle multiple jump hosts', () => {
      const forms = [
        {
          hostname: 'jump1.com',
          port: 22,
          username: 'user',
          authMethod: 'password' as const,
          password: 'pw1',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
        {
          hostname: 'jump2.com',
          port: 22,
          username: 'user',
          authMethod: 'password' as const,
          password: 'pw2',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).collectJumpHostCredentials(forms);
      expect(result).toBeDefined();
      expect(Object.keys(result)).toHaveLength(2);
    });
  });

  describe('buildJumpHostsFromForms', () => {
    it('should build JumpHost array from forms', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 2222,
          username: 'admin',
          authMethod: 'publicKey' as const,
          password: '',
          passphrase: '',
          keyContent: 'key-content',
          identityFile: '/path/key',
        },
      ];
      const result = (component as any).buildJumpHostsFromForms(forms);
      expect(result).toHaveLength(1);
      expect(result[0].hostname).toBe('bastion.com');
      expect(result[0].port).toBe(2222);
      expect(result[0].username).toBe('admin');
      expect(result[0].authMethod).toBe('publicKey');
      expect(result[0].privateKeyContent).toBe('key-content');
      expect(result[0].identityFile).toBe('/path/key');
    });

    it('should set privateKeyContent to null when empty', () => {
      const forms = [
        {
          hostname: 'bastion.com',
          port: 22,
          username: 'ubuntu',
          authMethod: 'password' as const,
          password: 'pw',
          passphrase: '',
          keyContent: '',
          identityFile: null,
        },
      ];
      const result = (component as any).buildJumpHostsFromForms(forms);
      expect(result[0].privateKeyContent).toBeNull();
    });
  });

  describe('openEditDialog', () => {
    it('should populate edit form from system', () => {
      const system: ContainerSystem = {
        id: 'sys-1',
        name: 'My Server',
        hostname: 'server.com',
        connectionType: 'remote',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker', 'podman'],
        autoConnect: true,
        sshConfig: {
          username: 'deploy',
          port: 2222,
          authMethod: 'publicKey',
          privateKeyPath: '/home/user/.ssh/id_ed25519',
          privateKeyContent: null,
          connectionTimeout: 30,
          proxyCommand: null,
          proxyJump: null,
          sshConfigHost: null,
        },
      };

      component.openEditDialog(system);

      expect(component.editForm.name).toBe('My Server');
      expect(component.editForm.hostname).toBe('server.com');
      expect(component.editForm.sshUsername).toBe('deploy');
      expect(component.editForm.sshPort).toBe(2222);
      expect(component.editForm.sshAuthMethod).toBe('publicKey');
      expect(component.editForm.sshKeyPath).toBe('/home/user/.ssh/id_ed25519');
      expect(component.showEditDialog).toBe(true);
      expect(component.editingSystemId).toBe('sys-1');
    });

    it('should use key paste method when privateKeyContent is set', () => {
      const system: ContainerSystem = {
        id: 'sys-1',
        name: 'Server',
        hostname: 'server.com',
        connectionType: 'remote',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: false,
        sshConfig: {
          username: 'root',
          port: 22,
          authMethod: 'publicKey',
          privateKeyPath: null,
          privateKeyContent: '-----BEGIN RSA PRIVATE KEY-----',
          connectionTimeout: 30,
          proxyCommand: null,
          proxyJump: null,
          sshConfigHost: null,
        },
      };

      component.openEditDialog(system);

      expect(component.editForm.sshKeyImportMethod).toBe('paste');
      expect(component.editForm.sshKeyContent).toBe('-----BEGIN RSA PRIVATE KEY-----');
    });

    it('should populate editJumpHostForms from existing proxyJump', () => {
      const system: ContainerSystem = {
        id: 'sys-1',
        name: 'Server',
        hostname: 'server.com',
        connectionType: 'remote',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: false,
        sshConfig: {
          username: 'root',
          port: 22,
          authMethod: 'password',
          privateKeyPath: null,
          privateKeyContent: null,
          connectionTimeout: 30,
          proxyCommand: null,
          proxyJump: [
            { hostname: 'bastion.com', port: 22, username: 'ubuntu', identityFile: null },
          ],
          sshConfigHost: null,
        },
      };

      component.openEditDialog(system);

      expect(component.editJumpHostForms).toHaveLength(1);
      expect(component.editJumpHostForms[0].hostname).toBe('bastion.com');
    });

    it('should handle local connection type with no sshConfig', () => {
      const system: ContainerSystem = {
        id: 'sys-local',
        name: 'Local Docker',
        hostname: 'localhost',
        connectionType: 'local',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: true,
        sshConfig: null,
      };

      component.openEditDialog(system);

      expect(component.editForm.connectionType).toBe('local');
      expect(component.editForm.sshUsername).toBe('root');
      expect(component.editForm.sshPort).toBe(22);
    });
  });

  describe('resetForm', () => {
    it('should reset add form to defaults', () => {
      component.addForm.name = 'test';
      component.addForm.hostname = 'server.com';
      component.addForm.sshPassword = 'secret';
      (component as any).selectedSshHost = 'my-host';
      (component as any).jumpHostForms = [{ hostname: 'bastion.com' }];

      (component as any).resetForm();

      expect(component.addForm.name).toBe('');
      expect(component.addForm.hostname).toBe('');
      expect(component.addForm.sshPassword).toBe('');
      expect((component as any).selectedSshHost).toBe('');
      expect((component as any).jumpHostForms).toHaveLength(0);
    });
  });

  describe('getConnectionState', () => {
    it('should delegate to systemState', () => {
      component.systemState.getConnectionState = vi.fn(() => 'connected');
      const result = component.getConnectionState('sys-1');
      expect(result).toBe('connected');
      expect(component.systemState.getConnectionState).toHaveBeenCalledWith('sys-1');
    });
  });

  describe('getExtendedInfo', () => {
    it('should delegate to systemState', () => {
      const info = { username: 'root', isRoot: true, canSudo: true, osType: 'linux' as const };
      component.systemState.getExtendedInfo = vi.fn(() => info);
      const result = component.getExtendedInfo('sys-1');
      expect(result).toEqual(info);
    });
  });

  describe('getLiveMetrics', () => {
    it('should delegate to systemState', () => {
      const metrics: LiveSystemMetrics = {
        systemId: 'sys-1',
        timestamp: Date.now(),
        cpuUsagePercent: 50,
        memoryUsagePercent: 60,
      };
      component.systemState.getLiveMetrics = vi.fn(() => metrics);
      const result = component.getLiveMetrics('sys-1');
      expect(result).toEqual(metrics);
    });
  });

  describe('loadDots', () => {
    it('should have 5 dots for rendering', () => {
      expect(component.loadDots).toHaveLength(5);
      expect(component.loadDots).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('disconnect', () => {
    it('should call disconnectSystem and clearDataForSystem', async () => {
      await component.disconnect('sys-1');
      expect(component.systemState.disconnectSystem).toHaveBeenCalledWith('sys-1');
      expect((component as any).appState.clearDataForSystem).toHaveBeenCalledWith('sys-1');
    });
  });

  describe('onSshHostSelected with empty selection', () => {
    it('should reset proxy settings when empty host selected', async () => {
      (component as any).selectedHostProxyCommand = 'nc';
      (component as any).selectedHostProxyJump = 'bastion';

      await component.onSshHostSelected('');

      expect((component as any).selectedSshHost).toBe('');
    });
  });

  describe('browseForSshKey', () => {
    it('should set add form key path on successful browse', async () => {
      (component as any).systemService.browseSshKey = vi.fn().mockResolvedValue('/home/user/.ssh/id_rsa');
      await component.browseForSshKey('add');
      expect(component.addForm.sshKeyPath).toBe('/home/user/.ssh/id_rsa');
    });

    it('should set edit form key path on successful browse', async () => {
      (component as any).systemService.browseSshKey = vi.fn().mockResolvedValue('/home/user/.ssh/id_ed25519');
      await component.browseForSshKey('edit');
      expect(component.editForm.sshKeyPath).toBe('/home/user/.ssh/id_ed25519');
    });

    it('should set error when .pub file is selected', async () => {
      (component as any).systemService.browseSshKey = vi.fn().mockResolvedValue('/home/user/.ssh/id_rsa.pub');
      await component.browseForSshKey('add');
      expect(component.systemState.setError).toHaveBeenCalledWith(
        expect.stringContaining('private key')
      );
    });

    it('should do nothing when browse is cancelled', async () => {
      (component as any).systemService.browseSshKey = vi.fn().mockResolvedValue(null);
      component.addForm.sshKeyPath = '';
      await component.browseForSshKey('add');
      expect(component.addForm.sshKeyPath).toBe('');
    });
  });

  describe('importKeyFromFile', () => {
    it('should set add form key content on successful import', async () => {
      (component as any).systemService.browseAndImportSshKey = vi
        .fn()
        .mockResolvedValue('-----BEGIN RSA PRIVATE KEY-----');
      await component.importKeyFromFile('add');
      expect(component.addForm.sshKeyContent).toBe('-----BEGIN RSA PRIVATE KEY-----');
      expect(component.importingKey()).toBe(false);
    });

    it('should set edit form key content on successful import', async () => {
      (component as any).systemService.browseAndImportSshKey = vi
        .fn()
        .mockResolvedValue('-----BEGIN EC PRIVATE KEY-----');
      await component.importKeyFromFile('edit');
      expect(component.editForm.sshKeyContent).toBe('-----BEGIN EC PRIVATE KEY-----');
    });

    it('should set error and reset importing on failure', async () => {
      (component as any).systemService.browseAndImportSshKey = vi
        .fn()
        .mockRejectedValue(new Error('file read failed'));
      await component.importKeyFromFile('add');
      expect(component.importingKey()).toBe(false);
      expect(component.systemState.setError).toHaveBeenCalled();
    });
  });

  describe('dockTerminal', () => {
    it('should do nothing for unknown system', async () => {
      component.systemState.systems = vi.fn(() => []);
      await component.dockTerminal('unknown');
      expect((component as any).terminalService.startSession).not.toHaveBeenCalled();
    });

    it('should start session and add terminal for known system', async () => {
      const systems: ContainerSystem[] = [{
        id: 'sys-1',
        name: 'My Server',
        hostname: 'server.com',
        connectionType: 'local',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: false,
        sshConfig: null,
      }];
      component.systemState.systems = vi.fn(() => systems);
      (component as any).terminalService.startSession = vi.fn().mockResolvedValue({ id: 'sess-1' });

      await component.dockTerminal('sys-1');

      expect((component as any).terminalService.startSession).toHaveBeenCalledWith('sys-1');
      expect((component as any).terminalState.addTerminal).toHaveBeenCalled();
    });

    it('should show toast error if terminal start fails', async () => {
      const systems: ContainerSystem[] = [{
        id: 'sys-1',
        name: 'My Server',
        hostname: 'server.com',
        connectionType: 'local',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: false,
        sshConfig: null,
      }];
      component.systemState.systems = vi.fn(() => systems);
      (component as any).terminalService.startSession = vi
        .fn()
        .mockRejectedValue(new Error('terminal failed'));

      await component.dockTerminal('sys-1');

      expect((component as any).toast.error).toHaveBeenCalledWith(
        expect.stringContaining('terminal failed')
      );
    });
  });
});
