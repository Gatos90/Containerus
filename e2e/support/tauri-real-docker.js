/**
 * Browser-injectable IPC shim for real-Docker E2E.
 *
 * Unlike `tauri-mock.js`, this shim forwards container/image/volume/network
 * commands to the Node test process via `window.__E2E_DOCKER__.*`, which is
 * exposed through Playwright's `page.exposeFunction`. Everything else (app
 * settings, SSH config, terminals, AI) is stubbed with safe defaults so the
 * Angular app boots.
 */
(function () {
  'use strict';

  var SYSTEM_ID = 'e2e-local-docker';

  var preSeededSystem = {
    id: SYSTEM_ID,
    name: 'E2E Local Docker',
    hostname: 'localhost',
    connectionType: 'local',
    primaryRuntime: 'docker',
    availableRuntimes: ['docker'],
    autoConnect: true,
    sshConfig: null,
  };

  var defaultAppSettings = {
    sshConfigPaths: [],
    lastSeenVersion: '999.0.0',
  };

  function ready() {
    return new Promise(function (resolve) {
      var check = function () {
        if (window.__E2E_DOCKER__ && window.__E2E_DOCKER__.ready) return resolve();
        setTimeout(check, 20);
      };
      check();
    });
  }

  async function bridge(fn) {
    await ready();
    return fn(window.__E2E_DOCKER__);
  }

  function handleInvoke(cmd, args) {
    args = args || {};
    switch (cmd) {
      // ── System ─────────────────────────────────────────────────────────
      case 'list_systems':
        return Promise.resolve([preSeededSystem]);
      case 'add_system': {
        var req = args.request || {};
        return Promise.resolve({
          ...preSeededSystem,
          name: req.name || preSeededSystem.name,
          hostname: req.hostname || preSeededSystem.hostname,
        });
      }
      case 'update_system':
      case 'remove_system':
        return Promise.resolve(null);
      case 'connect_system':
        return Promise.resolve('connected');
      case 'disconnect_system':
        return Promise.resolve('disconnected');
      case 'get_connection_state':
        return Promise.resolve('connected');
      case 'detect_runtimes':
        return Promise.resolve(['docker']);
      case 'get_extended_system_info':
        return Promise.resolve({ username: 'e2e', hostname: 'localhost', cores: 4, totalMemory: 8192, uptime: 0, platform: 'linux' });
      case 'get_live_metrics':
        return Promise.resolve({ cpuUsage: 0, memoryUsed: 0, memoryTotal: 8192, diskUsed: 0, diskTotal: 102400, swapUsed: 0, swapTotal: 0, load1: 0, load5: 0, load15: 0 });
      case 'start_system_monitoring':
      case 'stop_system_monitoring':
        return Promise.resolve(null);

      // ── Backend (multi-backend connection plumbing) ────────────────────
      case 'list_backend_connections':
      case 'list_backend_systems':
        return Promise.resolve([]);
      case 'add_backend_connection':
      case 'remove_backend_connection':
      case 'update_backend_connection':
        return Promise.resolve(null);

      // ── SSH ────────────────────────────────────────────────────────────
      case 'has_ssh_config':
        return Promise.resolve(false);
      case 'list_ssh_config_hosts':
        return Promise.resolve([]);
      case 'get_ssh_host_config':
        return Promise.resolve(null);
      case 'get_ssh_credentials':
        return Promise.resolve({ username: '', authMethod: 'Password', password: null, privateKey: null, passphrase: null });
      case 'store_ssh_credentials':
      case 'import_ssh_key_from_file':
      case 'remove_known_host':
        return Promise.resolve(cmd === 'import_ssh_key_from_file' ? '' : null);

      // ── Containers ─────────────────────────────────────────────────────
      case 'list_containers':
        return bridge(function (b) { return b.listContainers(SYSTEM_ID); });
      case 'perform_container_action':
        return bridge(function (b) { return b.performContainerAction(args.containerId, args.action); });
      case 'inspect_container':
        return bridge(function (b) { return b.inspectContainer(args.containerId); });
      case 'get_container_logs':
        return bridge(function (b) { return b.getContainerLogs(args.containerId, args.tail || 100); });

      // ── Images ─────────────────────────────────────────────────────────
      case 'list_images':
        return bridge(function (b) { return b.listImages(SYSTEM_ID); });
      case 'pull_image':
        return bridge(function (b) { return b.pullImage(args.image); });
      case 'remove_image':
        return bridge(function (b) { return b.removeImage(args.image || args.imageId); });
      case 'build_image':
        return Promise.resolve(null);

      // ── Volumes ────────────────────────────────────────────────────────
      case 'list_volumes':
        return bridge(function (b) { return b.listVolumes(SYSTEM_ID); });
      case 'create_volume':
        return bridge(function (b) { return b.createVolume(args.name); });
      case 'remove_volume':
        return bridge(function (b) { return b.removeVolume(args.name); });

      // ── Networks ───────────────────────────────────────────────────────
      case 'list_networks':
        return bridge(function (b) { return b.listNetworks(SYSTEM_ID); });
      case 'create_network':
        return bridge(function (b) { return b.createNetwork(args.name, args.driver || 'bridge'); });
      case 'remove_network':
        return bridge(function (b) { return b.removeNetwork(args.name); });
      case 'connect_container_to_network':
      case 'disconnect_container_from_network':
        return Promise.resolve(null);

      // ── Terminal / Port forwarding ─────────────────────────────────────
      case 'create_terminal_session':
        return Promise.resolve('mock-terminal-session-id');
      case 'send_terminal_input':
      case 'resize_terminal':
      case 'close_terminal_session':
        return Promise.resolve(null);
      case 'fetch_shell_history':
        return Promise.resolve([]);
      case 'list_port_forwards':
        return Promise.resolve([]);
      case 'create_port_forward':
        return Promise.resolve({ id: 'mock-pf-1', localPort: 0, remoteHost: 'localhost', remotePort: 0 });
      case 'remove_port_forward':
        return Promise.resolve(null);

      // ── AI / Agent ─────────────────────────────────────────────────────
      case 'get_ai_settings_cmd':
        return Promise.resolve({
          provider: 'openai',
          model: '',
          apiKey: '',
          baseUrl: '',
          temperature: 0.2,
          maxTokens: 2048,
          enabled: false,
        });
      case 'list_ai_models':
      case 'list_models_for_provider':
        return Promise.resolve([]);
      case 'pull_ollama_model':
      case 'delete_ollama_model':
        return Promise.resolve(null);
      case 'test_ai_connection':
      case 'test_ai_connection_with_settings':
        return Promise.resolve({ success: false, message: 'AI disabled in E2E' });
      case 'submit_agent_query':
        return Promise.resolve({ thought: '', commands: [], response: '' });
      case 'get_shell_suggestion':
        return Promise.resolve('');
      case 'update_ai_settings_cmd':
        return Promise.resolve(null);

      // ── App settings / misc ────────────────────────────────────────────
      case 'get_app_settings':
        return Promise.resolve(defaultAppSettings);
      case 'update_app_settings':
        return Promise.resolve(null);
      case 'get_changelog':
        return Promise.resolve('');

      // ── Command templates ──────────────────────────────────────────────
      case 'list_command_templates':
        return Promise.resolve([]);
      case 'get_command_template':
        return Promise.resolve(null);
      case 'create_command_template':
        return Promise.resolve({ id: 'mock-cmd-1', name: 'Test', command: 'echo test', description: '', isFavorite: false, isBuiltin: false, variables: [], tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      case 'update_command_template':
      case 'delete_command_template':
      case 'toggle_command_favorite':
      case 'duplicate_command_template':
        return Promise.resolve(null);

      // ── File browser ───────────────────────────────────────────────────
      case 'list_directory':
        return Promise.resolve({ path: '/', entries: [] });
      case 'read_file':
        return Promise.resolve('');
      case 'write_file':
      case 'create_directory':
      case 'delete_path':
      case 'rename_path':
      case 'download_file':
      case 'upload_file':
        return Promise.resolve(null);

      // ── Compose ────────────────────────────────────────────────────────
      case 'compose_up':
      case 'compose_down':
      case 'compose_restart':
      case 'compose_logs':
        return Promise.resolve('');

      // ── Tauri plugins ──────────────────────────────────────────────────
      case 'plugin:os|platform':
        return Promise.resolve('linux');
      case 'plugin:os|version':
        return Promise.resolve('22.04');
      case 'plugin:os|arch':
        return Promise.resolve('x86_64');
      case 'plugin:process|exit':
      case 'plugin:dialog|open':
      case 'plugin:dialog|save':
      case 'plugin:opener|open_url':
      case 'plugin:updater|check':
        return Promise.resolve(null);
      case 'plugin:event|listen':
        return Promise.resolve(Math.floor(Math.random() * 100000));
      case 'plugin:event|unlisten':
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        return Promise.resolve(null);

      // ── Agent session ──────────────────────────────────────────────────
      case 'start_agent_session':
        return Promise.resolve({ id: 'mock-agent-session', systemId: null });
      case 'close_agent_session':
      case 'cancel_agent_query':
        return Promise.resolve(null);

      default:
        console.warn('[tauri-real-docker] Unhandled command:', cmd, args);
        return Promise.resolve(null);
    }
  }

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
  window.__TAURI_INTERNALS__.listen = function () {
    return Promise.resolve(function () {});
  };
  window.__TAURI_INTERNALS__.emit = function () {
    return Promise.resolve(null);
  };
})();
