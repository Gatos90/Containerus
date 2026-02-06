import { ContainerRuntime } from './container.model';

export type FileType = 'file' | 'directory' | 'symlink' | 'other';
export type FileSortOption = 'name' | 'size' | 'modified' | 'type';
export type SortDirection = 'asc' | 'desc';

export interface FileEntry {
  name: string;
  path: string;
  fileType: FileType;
  size: number;
  permissions: string;
  owner: string;
  group: string;
  modified: string;
  symlinkTarget?: string | null;
  isHidden: boolean;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  parentPath?: string | null;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  isBinary: boolean;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};

export const isTextFile = (name: string): boolean => {
  const textExtensions = new Set([
    'txt', 'md', 'log', 'json', 'yaml', 'yml', 'toml', 'xml',
    'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'java', 'c',
    'cpp', 'h', 'rb', 'sh', 'bash', 'zsh', 'fish', 'conf',
    'cfg', 'ini', 'env', 'csv', 'sql', 'graphql', 'proto',
    'vue', 'svelte', 'jsx', 'tsx', 'scss', 'less', 'svg',
  ]);
  const baseName = name.toLowerCase();
  const ext = baseName.split('.').pop() ?? '';
  return textExtensions.has(ext) ||
    ['dockerfile', 'makefile', 'readme', 'license', 'changelog', '.gitignore', '.env', '.dockerignore'].includes(baseName);
};
