import { describe, it, expect } from 'vitest';
import {
  CommandTemplate,
  CommandCategory,
  parseVariables,
  getRuntimePrefix,
  substituteVariables,
  hasUnresolvedVariables,
  getCategoryLabel,
  getCategoryIcon,
  getRuntimeLabel,
  getRuntimeIcon,
  isCompatibleWithRuntime,
  isCompatibleWithSystem,
  sortTemplates,
  groupByCategory,
  VARIABLE_SUGGESTIONS,
} from './command-template.model';

function makeTemplate(overrides: Partial<CommandTemplate> = {}): CommandTemplate {
  return {
    id: 'test-1',
    name: 'Test Template',
    description: 'A test template',
    command: 'docker ps',
    category: 'container-management',
    tags: [],
    variables: [],
    compatibility: { runtimes: [] },
    isFavorite: false,
    isBuiltIn: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Command Template Model Utilities', () => {
  describe('parseVariables', () => {
    it('should parse variable names from command string', () => {
      const result = parseVariables('${RUNTIME} run -d -p ${HOST_PORT}:${CONTAINER_PORT} ${IMAGE_NAME}');
      expect(result).toEqual(['RUNTIME', 'HOST_PORT', 'CONTAINER_PORT', 'IMAGE_NAME']);
    });

    it('should return empty array for no variables', () => {
      expect(parseVariables('docker ps -a')).toEqual([]);
    });

    it('should deduplicate variable names', () => {
      const result = parseVariables('${NAME} and ${NAME} again');
      expect(result).toEqual(['NAME']);
    });

    it('should only match uppercase variable names', () => {
      const result = parseVariables('${lowercase} ${UPPERCASE} ${_UNDERSCORE}');
      expect(result).toEqual(['UPPERCASE', '_UNDERSCORE']);
    });

    it('should handle variables with numbers', () => {
      const result = parseVariables('${VAR1} ${VAR_2}');
      expect(result).toEqual(['VAR1', 'VAR_2']);
    });
  });

  describe('getRuntimePrefix', () => {
    it('should return docker for docker', () => {
      expect(getRuntimePrefix('docker')).toBe('docker');
    });

    it('should return podman for podman', () => {
      expect(getRuntimePrefix('podman')).toBe('podman');
    });

    it('should return container for apple', () => {
      expect(getRuntimePrefix('apple')).toBe('container');
    });
  });

  describe('substituteVariables', () => {
    it('should substitute provided values', () => {
      const result = substituteVariables(
        '${RUNTIME} run ${IMAGE_NAME}',
        { IMAGE_NAME: 'nginx:latest' },
        'docker'
      );
      expect(result).toBe('docker run nginx:latest');
    });

    it('should auto-substitute RUNTIME', () => {
      const result = substituteVariables('${RUNTIME} ps', {}, 'podman');
      expect(result).toBe('podman ps');
    });

    it('should keep unresolved variables', () => {
      const result = substituteVariables('${RUNTIME} run ${IMAGE_NAME}', {});
      expect(result).toBe('${RUNTIME} run ${IMAGE_NAME}');
    });

    it('should prefer explicit value over auto-substitution', () => {
      const result = substituteVariables('${RUNTIME} ps', { RUNTIME: 'nerdctl' }, 'docker');
      expect(result).toBe('nerdctl ps');
    });
  });

  describe('hasUnresolvedVariables', () => {
    it('should return true when variables remain', () => {
      expect(hasUnresolvedVariables('docker run ${IMAGE_NAME}')).toBe(true);
    });

    it('should return false when all resolved', () => {
      expect(hasUnresolvedVariables('docker run nginx:latest')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasUnresolvedVariables('')).toBe(false);
    });
  });

  describe('getCategoryLabel', () => {
    it('should return proper labels for all categories', () => {
      expect(getCategoryLabel('container-management')).toBe('Container Management');
      expect(getCategoryLabel('debugging')).toBe('Debugging');
      expect(getCategoryLabel('networking')).toBe('Networking');
      expect(getCategoryLabel('images')).toBe('Images');
      expect(getCategoryLabel('volumes')).toBe('Volumes');
      expect(getCategoryLabel('system')).toBe('System');
      expect(getCategoryLabel('pods')).toBe('Pods');
      expect(getCategoryLabel('custom')).toBe('Custom');
    });
  });

  describe('getCategoryIcon', () => {
    it('should return icons for all categories', () => {
      expect(getCategoryIcon('container-management')).toBe('package');
      expect(getCategoryIcon('debugging')).toBe('bug');
      expect(getCategoryIcon('networking')).toBe('network');
      expect(getCategoryIcon('images')).toBe('layers');
      expect(getCategoryIcon('volumes')).toBe('hard-drive');
      expect(getCategoryIcon('system')).toBe('settings');
      expect(getCategoryIcon('pods')).toBe('boxes');
      expect(getCategoryIcon('custom')).toBe('terminal');
    });
  });

  describe('getRuntimeLabel', () => {
    it('should return proper labels', () => {
      expect(getRuntimeLabel('docker')).toBe('Docker');
      expect(getRuntimeLabel('podman')).toBe('Podman');
      expect(getRuntimeLabel('apple')).toBe('Apple');
    });
  });

  describe('getRuntimeIcon', () => {
    it('should return proper icons', () => {
      expect(getRuntimeIcon('docker')).toBe('ship');
      expect(getRuntimeIcon('podman')).toBe('container');
      expect(getRuntimeIcon('apple')).toBe('apple');
    });
  });

  describe('isCompatibleWithRuntime', () => {
    it('should be compatible when runtimes list is empty (universal)', () => {
      const template = makeTemplate({ compatibility: { runtimes: [] } });
      expect(isCompatibleWithRuntime(template, 'docker')).toBe(true);
      expect(isCompatibleWithRuntime(template, 'podman')).toBe(true);
    });

    it('should be compatible when runtime is in the list', () => {
      const template = makeTemplate({ compatibility: { runtimes: ['docker', 'podman'] } });
      expect(isCompatibleWithRuntime(template, 'docker')).toBe(true);
      expect(isCompatibleWithRuntime(template, 'podman')).toBe(true);
    });

    it('should not be compatible when runtime is not in the list', () => {
      const template = makeTemplate({ compatibility: { runtimes: ['docker'] } });
      expect(isCompatibleWithRuntime(template, 'apple')).toBe(false);
    });
  });

  describe('isCompatibleWithSystem', () => {
    it('should be compatible when systemIds is undefined', () => {
      const template = makeTemplate({ compatibility: { runtimes: [] } });
      expect(isCompatibleWithSystem(template, 'sys-1')).toBe(true);
    });

    it('should be compatible when systemIds is empty', () => {
      const template = makeTemplate({ compatibility: { runtimes: [], systemIds: [] } });
      expect(isCompatibleWithSystem(template, 'sys-1')).toBe(true);
    });

    it('should be compatible when systemId is in the list', () => {
      const template = makeTemplate({ compatibility: { runtimes: [], systemIds: ['sys-1', 'sys-2'] } });
      expect(isCompatibleWithSystem(template, 'sys-1')).toBe(true);
    });

    it('should not be compatible when systemId is not in the list', () => {
      const template = makeTemplate({ compatibility: { runtimes: [], systemIds: ['sys-1'] } });
      expect(isCompatibleWithSystem(template, 'sys-3')).toBe(false);
    });
  });

  describe('sortTemplates', () => {
    it('should sort favorites first', () => {
      const templates = [
        makeTemplate({ id: '1', name: 'B', isFavorite: false, category: 'system' }),
        makeTemplate({ id: '2', name: 'A', isFavorite: true, category: 'system' }),
      ];
      const sorted = sortTemplates(templates);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('1');
    });

    it('should sort by category within same favorite status', () => {
      const templates = [
        makeTemplate({ id: '1', name: 'Z', category: 'volumes' }),
        makeTemplate({ id: '2', name: 'A', category: 'debugging' }),
      ];
      const sorted = sortTemplates(templates);
      expect(sorted[0].category).toBe('debugging');
      expect(sorted[1].category).toBe('volumes');
    });

    it('should sort by name within same category', () => {
      const templates = [
        makeTemplate({ id: '1', name: 'Zebra', category: 'system' }),
        makeTemplate({ id: '2', name: 'Alpha', category: 'system' }),
      ];
      const sorted = sortTemplates(templates);
      expect(sorted[0].name).toBe('Alpha');
      expect(sorted[1].name).toBe('Zebra');
    });

    it('should not mutate original array', () => {
      const templates = [
        makeTemplate({ id: '1', name: 'B' }),
        makeTemplate({ id: '2', name: 'A' }),
      ];
      sortTemplates(templates);
      expect(templates[0].id).toBe('1');
    });
  });

  describe('groupByCategory', () => {
    it('should group templates by their category', () => {
      const templates = [
        makeTemplate({ id: '1', category: 'system' }),
        makeTemplate({ id: '2', category: 'debugging' }),
        makeTemplate({ id: '3', category: 'system' }),
      ];
      const grouped = groupByCategory(templates);
      expect(grouped['system']).toHaveLength(2);
      expect(grouped['debugging']).toHaveLength(1);
      expect(grouped['networking']).toHaveLength(0);
    });

    it('should return empty arrays for unused categories', () => {
      const grouped = groupByCategory([]);
      expect(grouped['container-management']).toEqual([]);
      expect(grouped['debugging']).toEqual([]);
      expect(grouped['networking']).toEqual([]);
      expect(grouped['images']).toEqual([]);
      expect(grouped['volumes']).toEqual([]);
      expect(grouped['system']).toEqual([]);
      expect(grouped['pods']).toEqual([]);
      expect(grouped['custom']).toEqual([]);
    });
  });

  describe('VARIABLE_SUGGESTIONS', () => {
    it('should contain common variables', () => {
      expect(VARIABLE_SUGGESTIONS['RUNTIME']).toBeDefined();
      expect(VARIABLE_SUGGESTIONS['CONTAINER_NAME']).toBeDefined();
      expect(VARIABLE_SUGGESTIONS['IMAGE_NAME']).toBeDefined();
      expect(VARIABLE_SUGGESTIONS['HOST_PORT']).toBeDefined();
      expect(VARIABLE_SUGGESTIONS['CONTAINER_PORT']).toBeDefined();
    });
  });
});
