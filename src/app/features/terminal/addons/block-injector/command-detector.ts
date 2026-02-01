import type { CommandEvent } from './types';

/**
 * Shell prompt patterns for common shells.
 * These regex patterns match the end of a line that looks like a shell prompt.
 */
const PROMPT_PATTERNS: RegExp[] = [
  // Bash/Zsh: user@host:path$ or user@host:path#
  /[$#]\s*$/,

  // PowerShell: PS C:\path>
  /PS\s+[A-Za-z]:.*>\s*$/,

  // Windows CMD: C:\path>
  /^[A-Za-z]:\\[^>]*>\s*$/,

  // Generic > prompt (common in many shells)
  />\s*$/,

  // Zsh: user%
  /%\s*$/,

  // Starship/Oh-My-Posh styled prompts
  /[❯➜→]\s*$/,

  // Fish shell
  /⋊>\s*$/,
];

/**
 * Patterns that indicate command output is starting (after command entry)
 */
const OUTPUT_START_PATTERNS: RegExp[] = [
  // Common error prefixes
  /^(error|Error|ERROR):/,
  /^(warning|Warning|WARNING):/,

  // Common command output
  /^total\s+\d+/,  // ls -l output
  /^\s*\d+\s+\w+/,  // ps output
];

/**
 * CommandDetector detects command boundaries from terminal output.
 *
 * Uses heuristic prompt pattern matching to identify when:
 * - A new prompt appears (command likely ended)
 * - A command is being entered
 * - Output is being produced
 *
 * Note: This is heuristic-based and may not work perfectly for all shells
 * or custom prompts. For more reliable detection, shell integration hooks
 * can be used (implemented separately).
 */
export class CommandDetector {
  private lastPromptLine = -1;
  private currentCommandStartLine = -1;
  private lastLineContent = '';
  private isInCommand = false;
  private outputBuffer = '';

  /** Custom prompt patterns (can be added by user) */
  private customPromptPatterns: RegExp[] = [];

  /**
   * Process terminal output and detect command events.
   *
   * @param data The raw terminal output data
   * @param currentLine The current cursor line in the buffer
   * @returns Array of detected command events
   */
  processOutput(data: string, currentLine: number): CommandEvent[] {
    const events: CommandEvent[] = [];

    // Split data into lines
    const lines = data.split(/\r?\n/);

    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Check if this line matches a prompt pattern
      if (this.isPromptLine(line)) {
        // If we were in a command, it has ended
        if (this.isInCommand && this.currentCommandStartLine >= 0) {
          events.push({
            type: 'command-end',
            line: currentLine,
            // Exit code not reliably detectable from output alone
          });
          this.isInCommand = false;
        }

        // A new prompt means we're ready for a new command
        events.push({
          type: 'prompt-detected',
          line: currentLine,
        });

        this.lastPromptLine = currentLine;
        this.outputBuffer = '';
      } else if (this.lastPromptLine >= 0 && !this.isInCommand) {
        // If we have a prompt and receive non-prompt text, a command is starting
        // This is the command being typed/entered
        if (this.isLikelyCommand(line)) {
          events.push({
            type: 'command-start',
            line: this.lastPromptLine,
            command: line.trim(),
          });
          this.currentCommandStartLine = this.lastPromptLine;
          this.isInCommand = true;
        }
      }

      this.lastLineContent = line;
    }

    return events;
  }

  /**
   * Reset the detector state.
   * Call this when starting a new terminal session.
   */
  reset(): void {
    this.lastPromptLine = -1;
    this.currentCommandStartLine = -1;
    this.lastLineContent = '';
    this.isInCommand = false;
    this.outputBuffer = '';
  }

  /**
   * Add a custom prompt pattern.
   */
  addPromptPattern(pattern: RegExp): void {
    this.customPromptPatterns.push(pattern);
  }

  /**
   * Remove a custom prompt pattern.
   */
  removePromptPattern(pattern: RegExp): boolean {
    const index = this.customPromptPatterns.indexOf(pattern);
    if (index >= 0) {
      this.customPromptPatterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all custom prompt patterns.
   */
  clearCustomPatterns(): void {
    this.customPromptPatterns = [];
  }

  /**
   * Check if the detector is currently in a command (between start and end).
   */
  isCommandInProgress(): boolean {
    return this.isInCommand;
  }

  /**
   * Get the line where the current command started.
   */
  getCurrentCommandStartLine(): number {
    return this.currentCommandStartLine;
  }

  /**
   * Manually mark a command as started.
   * Useful when command detection is handled externally.
   */
  markCommandStart(line: number, command: string): void {
    this.currentCommandStartLine = line;
    this.isInCommand = true;
  }

  /**
   * Manually mark a command as ended.
   * Useful when command detection is handled externally.
   */
  markCommandEnd(): void {
    this.isInCommand = false;
    this.currentCommandStartLine = -1;
  }

  /**
   * Check if a line matches any prompt pattern.
   */
  private isPromptLine(line: string): boolean {
    // Check custom patterns first
    for (const pattern of this.customPromptPatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }

    // Check built-in patterns
    for (const pattern of PROMPT_PATTERNS) {
      if (pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a line is likely a command (not output).
   */
  private isLikelyCommand(line: string): boolean {
    const trimmed = line.trim();

    // Empty lines are not commands
    if (!trimmed) return false;

    // Very long lines are unlikely to be commands (probably output)
    if (trimmed.length > 500) return false;

    // Lines starting with common output patterns are not commands
    for (const pattern of OUTPUT_START_PATTERNS) {
      if (pattern.test(trimmed)) {
        return false;
      }
    }

    // If it starts with a common command or looks like a path, it's likely a command
    const commandStarts = [
      'cd ', 'ls', 'dir', 'pwd', 'cat', 'echo', 'grep', 'find',
      'docker', 'npm', 'yarn', 'pnpm', 'node', 'python', 'pip',
      'git', 'cargo', 'rustc', 'go ', 'make', 'cmake', 'mkdir',
      'rm ', 'cp ', 'mv ', 'touch', 'chmod', 'chown',
      'curl', 'wget', 'ssh', 'scp', 'rsync',
      'sudo', 'apt', 'yum', 'brew', 'winget', 'choco',
      'ng ', 'npx ', 'tauri',
      './', '../', '~/',
      'powershell', 'cmd', 'Get-', 'Set-', 'New-', 'Remove-',
    ];

    const lowerTrimmed = trimmed.toLowerCase();
    for (const start of commandStarts) {
      if (lowerTrimmed.startsWith(start.toLowerCase())) {
        return true;
      }
    }

    // If it contains common shell operators, probably a command
    if (/[|&;><]/.test(trimmed)) {
      return true;
    }

    // If it's a short line without spaces (like a simple command), probably a command
    if (trimmed.length < 20 && !trimmed.includes(' ')) {
      return true;
    }

    // Default: assume it could be a command if short enough
    return trimmed.length < 200;
  }
}
