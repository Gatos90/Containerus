import { ContainerRuntime } from './container.model';

export type CommandCategory =
  | 'container-management'
  | 'debugging'
  | 'networking'
  | 'images'
  | 'volumes'
  | 'system'
  | 'pods'
  | 'custom';

export interface TemplateVariable {
  name: string;
  description: string;
  defaultValue?: string;
  required: boolean;
}

export interface CommandCompatibility {
  runtimes: ContainerRuntime[];
  systemIds?: string[];
}

export interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  command: string;
  category: CommandCategory;
  tags: string[];
  variables: TemplateVariable[];
  compatibility: CommandCompatibility;
  isFavorite: boolean;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommandTemplateRequest {
  name: string;
  description: string;
  command: string;
  category: CommandCategory;
  tags: string[];
  variables: TemplateVariable[];
  compatibility: CommandCompatibility;
  isFavorite: boolean;
}

export interface UpdateCommandTemplateRequest {
  id: string;
  name?: string;
  description?: string;
  command?: string;
  category?: CommandCategory;
  tags?: string[];
  variables?: TemplateVariable[];
  compatibility?: CommandCompatibility;
  isFavorite?: boolean;
}

// Utility functions

/**
 * Parse variable names from a command template string
 * @param command - The command string with ${VARIABLE_NAME} placeholders
 * @returns Array of variable names found in the command
 */
export const parseVariables = (command: string): string[] => {
  const regex = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(command)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1]);
    }
  }
  return matches;
};

/**
 * Get the runtime prefix for command substitution
 * @param runtime - The container runtime
 * @returns The CLI command prefix for the runtime
 */
export const getRuntimePrefix = (runtime: ContainerRuntime): string => {
  switch (runtime) {
    case 'docker':
      return 'docker';
    case 'podman':
      return 'podman';
    case 'apple':
      return 'container';
    default:
      return 'docker';
  }
};

/**
 * Substitute variable placeholders with actual values
 * @param command - The command string with ${VARIABLE_NAME} placeholders
 * @param values - Record mapping variable names to their values
 * @param runtime - Optional runtime for auto-substituting ${RUNTIME}
 * @returns The command string with all placeholders replaced
 */
export const substituteVariables = (
  command: string,
  values: Record<string, string>,
  runtime?: ContainerRuntime
): string => {
  return command.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName) => {
    // Check for explicit value first
    if (values[varName] !== undefined) {
      return values[varName];
    }
    // Auto-substitute RUNTIME based on connected system
    if (varName === 'RUNTIME' && runtime) {
      return getRuntimePrefix(runtime);
    }
    // Keep placeholder if not found
    return `\${${varName}}`;
  });
};

/**
 * Check if a command has any unresolved variables
 */
export const hasUnresolvedVariables = (command: string): boolean => {
  return /\$\{[A-Z_][A-Z0-9_]*\}/.test(command);
};

/**
 * Get the display label for a command category
 */
export const getCategoryLabel = (category: CommandCategory): string => {
  switch (category) {
    case 'container-management':
      return 'Container Management';
    case 'debugging':
      return 'Debugging';
    case 'networking':
      return 'Networking';
    case 'images':
      return 'Images';
    case 'volumes':
      return 'Volumes';
    case 'system':
      return 'System';
    case 'pods':
      return 'Pods';
    case 'custom':
      return 'Custom';
    default:
      return category;
  }
};

/**
 * Get the icon name for a command category
 */
export const getCategoryIcon = (category: CommandCategory): string => {
  switch (category) {
    case 'container-management':
      return 'package';
    case 'debugging':
      return 'bug';
    case 'networking':
      return 'network';
    case 'images':
      return 'layers';
    case 'volumes':
      return 'hard-drive';
    case 'system':
      return 'settings';
    case 'pods':
      return 'boxes';
    case 'custom':
      return 'terminal';
    default:
      return 'terminal';
  }
};

/**
 * Get runtime display info
 */
export const getRuntimeLabel = (runtime: ContainerRuntime): string => {
  switch (runtime) {
    case 'docker':
      return 'Docker';
    case 'podman':
      return 'Podman';
    case 'apple':
      return 'Apple';
    default:
      return runtime;
  }
};

/**
 * Get the runtime icon character for display
 */
export const getRuntimeIcon = (runtime: ContainerRuntime): string => {
  switch (runtime) {
    case 'docker':
      return 'ship';
    case 'podman':
      return 'container';
    case 'apple':
      return 'apple';
    default:
      return 'box';
  }
};

/**
 * Check if a command template is compatible with a given runtime
 */
export const isCompatibleWithRuntime = (
  template: CommandTemplate,
  runtime: ContainerRuntime
): boolean => {
  return (
    template.compatibility.runtimes.length === 0 ||
    template.compatibility.runtimes.includes(runtime)
  );
};

/**
 * Check if a command template is compatible with a given system
 */
export const isCompatibleWithSystem = (
  template: CommandTemplate,
  systemId: string
): boolean => {
  return (
    !template.compatibility.systemIds ||
    template.compatibility.systemIds.length === 0 ||
    template.compatibility.systemIds.includes(systemId)
  );
};

/**
 * Sort categories for display (favorites first, then by category)
 */
export const sortTemplates = (templates: CommandTemplate[]): CommandTemplate[] => {
  return [...templates].sort((a, b) => {
    // Favorites first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    // Then by category
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    // Then by name
    return a.name.localeCompare(b.name);
  });
};

/**
 * Group templates by category
 */
export const groupByCategory = (
  templates: CommandTemplate[]
): Record<CommandCategory, CommandTemplate[]> => {
  const groups: Record<CommandCategory, CommandTemplate[]> = {
    'container-management': [],
    debugging: [],
    networking: [],
    images: [],
    volumes: [],
    system: [],
    pods: [],
    custom: [],
  };

  for (const template of templates) {
    groups[template.category].push(template);
  }

  return groups;
};

/**
 * Get a map of common variable names to their suggested sources
 */
export const VARIABLE_SUGGESTIONS: Record<string, string> = {
  RUNTIME: 'Container runtime (docker/podman) - auto-detected from connected system',
  CONTAINER_NAME: 'Select from running containers',
  CONTAINER_ID: 'Select from running containers',
  IMAGE_NAME: 'Select from available images',
  NETWORK_NAME: 'Select from available networks',
  VOLUME_NAME: 'Select from available volumes',
  SYSTEM_ID: 'Select from connected systems',
  POD_NAME: 'Select from available pods (Podman)',
  HOST_PORT: 'Port on host machine',
  CONTAINER_PORT: 'Port inside container',
  HOST_PATH: 'Path on host filesystem',
  CONTAINER_PATH: 'Path inside container',
  SHELL: 'Shell to execute (e.g., /bin/bash, /bin/sh)',
  COMMAND: 'Command to execute',
  NEW_NAME: 'New container name',
  LINES: 'Number of log lines',
  SOURCE_IMAGE: 'Source image to tag',
  TARGET_IMAGE: 'Target image name',
  BUILD_PATH: 'Build context path',
  FILENAME: 'Output filename',
  SEARCH_TERM: 'Search query',
  YAML_FILE: 'Path to YAML file',
  USER: 'Username for exec',
  ENV_VAR: 'Environment variable name',
  ENV_VALUE: 'Environment variable value',
};
