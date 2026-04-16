/**
 * Browser-injectable script that mocks Tauri's internal IPC mechanism.
 * Injected via Playwright's addInitScript() before Angular loads.
 *
 * Tauri v2 exposes window.__TAURI_INTERNALS__.invoke for all Rust command calls.
 * Plugins use the "plugin:<name>|<command>" prefix format.
 */
(function () {
  'use strict';

  var mockSystems = [];
  var mockContainers = [];
  var mockImages = [];
  var mockVolumes = [];
  var mockNetworks = [];
  var mockCommandTemplates = [];

  var defaultAppSettings = {
    sshConfigPaths: [],
    lastSeenVersion: '999.0.0',
  };

  function handleInvoke(cmd, args) {
    switch (cmd) {
      // ── System ──────────────────────────────────────────────────────────
      case 'list_systems':
        return Promise.resolve(mockSystems);
      case 'add_system':
        return Promise.resolve({ id: 'mock-system-1', name: args && args.request && args.request.name || 'Mock System', hostname: args && args.request && args.request.hostname || 'localhost', connectionType: 'Local', primaryRuntime: 'Docker', availableRuntimes: ['Docker'], autoConnect: false });
      case 'update_system':
        return Promise.resolve(null);
      case 'remove_system':
        return Promise.resolve(null);
      case 'connect_system':
        return Promise.resolve(null);
      case 'disconnect_system':
        return Promise.resolve(null);
      case 'get_connection_state':
        return Promise.resolve('Disconnected');
      case 'detect_runtimes':
        return Promise.resolve(['Docker']);
      case 'get_extended_system_info':
        return Promise.resolve({ username: 'user', hostname: 'localhost', cores: 4, totalMemory: 8192, uptime: 3600, platform: 'linux' });
      case 'get_live_metrics':
        return Promise.resolve({ cpuUsage: 5.0, memoryUsed: 1024, memoryTotal: 8192, diskUsed: 10240, diskTotal: 102400, swapUsed: 0, swapTotal: 1024, load1: 0.1, load5: 0.1, load15: 0.1 });
      case 'start_system_monitoring':
      case 'stop_system_monitoring':
        return Promise.resolve(null);

      // ── SSH ──────────────────────────────────────────────────────────────
      case 'has_ssh_config':
        return Promise.resolve(false);
      case 'list_ssh_config_hosts':
        return Promise.resolve([]);
      case 'get_ssh_host_config':
        return Promise.resolve(null);
      case 'get_ssh_credentials':
        return Promise.resolve({ username: '', authMethod: 'Password', password: null, privateKey: null, passphrase: null });
      case 'store_ssh_credentials':
        return Promise.resolve(null);
      case 'import_ssh_key_from_file':
        return Promise.resolve('');
      case 'remove_known_host':
        return Promise.resolve(null);

      // ── Containers ───────────────────────────────────────────────────────
      case 'list_containers':
        return Promise.resolve(mockContainers);
      case 'perform_container_action':
        return Promise.resolve(null);
      case 'inspect_container':
        return Promise.resolve({ id: 'mock-id', name: 'mock-container', image: 'nginx:latest', status: 'running', ports: [], env: [], mounts: [], labels: {}, networkSettings: {} });
      case 'get_container_logs':
        return Promise.resolve('');

      // ── Images ───────────────────────────────────────────────────────────
      case 'list_images':
        return Promise.resolve(mockImages);
      case 'pull_image':
        return Promise.resolve(null);
      case 'remove_image':
        return Promise.resolve(null);
      case 'build_image':
        return Promise.resolve(null);

      // ── Volumes ──────────────────────────────────────────────────────────
      case 'list_volumes':
        return Promise.resolve(mockVolumes);
      case 'create_volume':
        return Promise.resolve(null);
      case 'remove_volume':
        return Promise.resolve(null);

      // ── Networks ─────────────────────────────────────────────────────────
      case 'list_networks':
        return Promise.resolve(mockNetworks);
      case 'create_network':
        return Promise.resolve(null);
      case 'remove_network':
        return Promise.resolve(null);
      case 'connect_container_to_network':
      case 'disconnect_container_from_network':
        return Promise.resolve(null);

      // ── Terminal ─────────────────────────────────────────────────────────
      case 'create_terminal_session':
        return Promise.resolve('mock-terminal-session-id');
      case 'send_terminal_input':
        return Promise.resolve(null);
      case 'resize_terminal':
        return Promise.resolve(null);
      case 'close_terminal_session':
        return Promise.resolve(null);
      case 'fetch_shell_history':
        return Promise.resolve([]);

      // ── Port forwarding ──────────────────────────────────────────────────
      case 'list_port_forwards':
        return Promise.resolve([]);
      case 'create_port_forward':
        return Promise.resolve({ id: 'mock-pf-1', localPort: 8080, remoteHost: 'localhost', remotePort: 80 });
      case 'remove_port_forward':
        return Promise.resolve(null);

      // ── AI / Agent ───────────────────────────────────────────────────────
      case 'list_ai_models':
        return Promise.resolve([]);
      case 'list_models_for_provider':
        return Promise.resolve([]);
      case 'pull_ollama_model':
      case 'delete_ollama_model':
        return Promise.resolve(null);
      case 'test_ai_connection':
      case 'test_ai_connection_with_settings':
        return Promise.resolve({ success: false, message: 'Mock: AI not configured' });
      case 'submit_agent_query':
        return Promise.resolve({ thought: 'Mock response', commands: [], response: 'AI not available in tests' });
      case 'get_shell_suggestion':
        return Promise.resolve('');
      case 'update_ai_settings_cmd':
        return Promise.resolve(null);

      // ── App settings ─────────────────────────────────────────────────────
      case 'get_app_settings':
        return Promise.resolve(defaultAppSettings);
      case 'update_app_settings':
        return Promise.resolve(null);
      case 'get_changelog':
        return Promise.resolve('');

      // ── Command templates ─────────────────────────────────────────────────
      case 'list_command_templates':
        return Promise.resolve(mockCommandTemplates);
      case 'get_command_template':
        return Promise.resolve(null);
      case 'create_command_template':
        return Promise.resolve({ id: 'mock-cmd-1', name: 'Test', command: 'echo test', description: '', isFavorite: false, isBuiltin: false, variables: [], tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      case 'update_command_template':
        return Promise.resolve(null);
      case 'delete_command_template':
        return Promise.resolve(null);
      case 'toggle_command_favorite':
        return Promise.resolve(null);
      case 'duplicate_command_template':
        return Promise.resolve(null);

      // ── File browser ─────────────────────────────────────────────────────
      case 'list_directory':
        return Promise.resolve({ path: '/', entries: [] });
      case 'read_file':
        return Promise.resolve('');
      case 'write_file':
        return Promise.resolve(null);
      case 'create_directory':
        return Promise.resolve(null);
      case 'delete_path':
        return Promise.resolve(null);
      case 'rename_path':
        return Promise.resolve(null);
      case 'download_file':
        return Promise.resolve(null);
      case 'upload_file':
        return Promise.resolve(null);

      // ── Compose ──────────────────────────────────────────────────────────
      case 'compose_up':
      case 'compose_down':
      case 'compose_restart':
      case 'compose_logs':
        return Promise.resolve('');

      // ── Tauri plugins ────────────────────────────────────────────────────
      case 'plugin:os|platform':
        return Promise.resolve('linux');
      case 'plugin:os|version':
        return Promise.resolve('22.04');
      case 'plugin:os|arch':
        return Promise.resolve('x86_64');
      case 'plugin:process|exit':
        return Promise.resolve(null);
      case 'plugin:dialog|open':
        return Promise.resolve(null);
      case 'plugin:dialog|save':
        return Promise.resolve(null);
      case 'plugin:opener|open_url':
        return Promise.resolve(null);
      case 'plugin:updater|check':
        return Promise.resolve(null);

      // ── Tauri event system (used by @tauri-apps/api/event listen/emit) ──
      case 'plugin:event|listen':
        return Promise.resolve(Math.floor(Math.random() * 100000));
      case 'plugin:event|unlisten':
        return Promise.resolve(null);
      case 'plugin:event|emit':
        return Promise.resolve(null);
      case 'plugin:event|emit_to':
        return Promise.resolve(null);

      // ── Agent session (used by warp-terminal) ────────────────────────────
      case 'start_agent_session':
        return Promise.resolve({ id: 'mock-agent-session', systemId: null });
      case 'close_agent_session':
        return Promise.resolve(null);
      case 'cancel_agent_query':
        return Promise.resolve(null);

      default:
        console.warn('[tauri-mock] Unhandled command:', cmd, args);
        return Promise.resolve(null);
    }
  }

  // Minimal transformCallback needed for Tauri internals
  var _callbacks = {};
  function transformCallback(callback, once) {
    var uid = 'cb_' + Math.random().toString(36).slice(2, 9);
    _callbacks[uid] = { callback: callback, once: !!once };
    return uid;
  }

  window.__TAURI_INTERNALS__ = {
    invoke: handleInvoke,
    transformCallback: transformCallback,
    convertFileSrc: function (path) { return path; },
    metadata: {
      currentWindow: { label: 'main' },
      windows: [{ label: 'main' }],
    },
    plugins: {},
  };

  // Also mock the event system to avoid errors
  window.__TAURI_INTERNALS__.listen = function () {
    return Promise.resolve(function () {});
  };
  window.__TAURI_INTERNALS__.emit = function () {
    return Promise.resolve(null);
  };
})();
