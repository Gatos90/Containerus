const EXTENSION_MAP: Record<string, string> = {
  // Web
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',

  // Data / Config
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', svg: 'xml',
  toml: 'ini', ini: 'ini', env: 'ini',
  conf: 'ini', cfg: 'ini', properties: 'ini',

  // Shell / DevOps
  sh: 'shell', bash: 'shell', zsh: 'shell',

  // Languages
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  lua: 'lua',
  r: 'r',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',

  // Markup
  md: 'markdown', mdx: 'markdown',

  // Misc
  tf: 'hcl',
};

const FILENAME_MAP: Record<string, string> = {
  Dockerfile: 'dockerfile',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  Makefile: 'shell',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
};

export function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? '';

  if (FILENAME_MAP[fileName]) {
    return FILENAME_MAP[fileName];
  }

  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
  return EXTENSION_MAP[ext] ?? 'plaintext';
}
