import { describe, it, expect, beforeEach } from 'vitest';
import { CommandDetector } from './command-detector';

describe('CommandDetector', () => {
  let detector: CommandDetector;

  beforeEach(() => {
    detector = new CommandDetector();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should not be in a command on creation', () => {
      expect(detector.isCommandInProgress()).toBe(false);
    });

    it('should have -1 as current command start line', () => {
      expect(detector.getCurrentCommandStartLine()).toBe(-1);
    });
  });

  // ── Prompt detection ───────────────────────────────────────────────────────

  describe('prompt detection — built-in patterns', () => {
    it('should detect bash $ prompt', () => {
      const events = detector.processOutput('user@host:~$ ', 5);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect root # prompt', () => {
      const events = detector.processOutput('root@server:/# ', 0);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect zsh % prompt', () => {
      const events = detector.processOutput('user@host % ', 3);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect generic > prompt', () => {
      const events = detector.processOutput('C:\\Users\\test> ', 2);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect PowerShell PS prompt', () => {
      const events = detector.processOutput('PS C:\\Users\\user> ', 1);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect Windows CMD prompt', () => {
      const events = detector.processOutput('C:\\Users\\test>', 0);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect starship/oh-my-posh ❯ prompt', () => {
      const events = detector.processOutput('❯ ', 10);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect fish shell ⋊> prompt', () => {
      const events = detector.processOutput('⋊> ', 4);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should detect arrow → prompt', () => {
      const events = detector.processOutput('→ ', 7);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });
  });

  // ── Command start detection ────────────────────────────────────────────────

  describe('command-start detection', () => {
    function processPromptThenCommand(promptLine: string, commandLine: string, line = 5): ReturnType<CommandDetector['processOutput']> {
      detector.processOutput(promptLine, line);
      return detector.processOutput(commandLine, line + 1);
    }

    it('should detect command-start after a prompt', () => {
      detector.processOutput('user@host:~$ ', 5);
      const events = detector.processOutput('docker ps -a', 6);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should include command text in command-start event', () => {
      detector.processOutput('user@host:~$ ', 5);
      const events = detector.processOutput('docker ps -a', 6);
      const startEvent = events.find((e) => e.type === 'command-start') as any;
      expect(startEvent?.command).toBe('docker ps -a');
    });

    it('should set isCommandInProgress after command-start', () => {
      detector.processOutput('user@host:~$ ', 5);
      detector.processOutput('docker ps', 6);
      expect(detector.isCommandInProgress()).toBe(true);
    });

    it('should detect git command', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('git status', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect npm command', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('npm install', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect cd command', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('cd /tmp', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect sudo command', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('sudo apt update', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect command with pipe operator', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('ls | grep foo', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect command with redirection operator', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('echo hello > out.txt', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should detect relative path execution', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('./run.sh', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should not detect command-start for very long output lines', () => {
      detector.processOutput('$ ', 0);
      const longLine = 'a'.repeat(501);
      const events = detector.processOutput(longLine, 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });

    it('should not detect command-start for error: prefixed output', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('error: something went wrong', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });

    it('should not detect command-start for warning: prefixed output', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('warning: something', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });

    it('should not detect command-start before any prompt is seen', () => {
      const events = detector.processOutput('docker ps', 0);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });
  });

  // ── Command end detection ──────────────────────────────────────────────────

  describe('command-end detection', () => {
    it('should emit command-end when a new prompt appears after a command', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('docker ps', 1);
      const events = detector.processOutput('$ ', 10);
      expect(events.some((e) => e.type === 'command-end')).toBe(true);
    });

    it('should also emit prompt-detected together with command-end', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('docker ps', 1);
      const events = detector.processOutput('$ ', 10);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
      expect(events.some((e) => e.type === 'command-end')).toBe(true);
    });

    it('should set isCommandInProgress to false after command-end', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('ls -la', 1);
      expect(detector.isCommandInProgress()).toBe(true);
      detector.processOutput('$ ', 5);
      expect(detector.isCommandInProgress()).toBe(false);
    });
  });

  // ── reset ──────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset isCommandInProgress to false', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('docker ps', 1);
      detector.reset();
      expect(detector.isCommandInProgress()).toBe(false);
    });

    it('should reset currentCommandStartLine to -1', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('docker ps', 1);
      detector.reset();
      expect(detector.getCurrentCommandStartLine()).toBe(-1);
    });

    it('should stop generating events after reset (no prompt in context)', () => {
      detector.processOutput('$ ', 0);
      detector.processOutput('ls', 1);
      detector.reset();
      const events = detector.processOutput('ls', 2);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });
  });

  // ── Custom prompt patterns ────────────────────────────────────────────────

  describe('custom prompt patterns', () => {
    it('should detect prompt with added custom pattern', () => {
      const customPattern = /MYPROMPT>\s*$/;
      detector.addPromptPattern(customPattern);
      const events = detector.processOutput('MYPROMPT> ', 0);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(true);
    });

    it('should return true from removePromptPattern for existing pattern', () => {
      const pattern = /TEST>\s*$/;
      detector.addPromptPattern(pattern);
      const result = detector.removePromptPattern(pattern);
      expect(result).toBe(true);
    });

    it('should return false from removePromptPattern for non-existent pattern', () => {
      const pattern = /NOTADDED>\s*$/;
      const result = detector.removePromptPattern(pattern);
      expect(result).toBe(false);
    });

    it('should not detect removed custom pattern', () => {
      // Use a pattern that does NOT match any built-in patterns (no > % $ # at end)
      const pattern = /XYZUNIQUE_PROMPT_123:\s*$/;
      detector.addPromptPattern(pattern);
      detector.removePromptPattern(pattern);
      const events = detector.processOutput('XYZUNIQUE_PROMPT_123: ', 0);
      expect(events.some((e) => e.type === 'prompt-detected')).toBe(false);
    });

    it('should clear all custom patterns via clearCustomPatterns', () => {
      // Use patterns that do NOT match any built-in patterns (no > % $ # at end)
      detector.addPromptPattern(/ALPHA_PROMPT_END:/);
      detector.addPromptPattern(/BETA_PROMPT_END:/);
      detector.clearCustomPatterns();
      const e1 = detector.processOutput('ALPHA_PROMPT_END: hello', 0);
      const e2 = detector.processOutput('BETA_PROMPT_END: world', 1);
      expect(e1.some((e) => e.type === 'prompt-detected')).toBe(false);
      expect(e2.some((e) => e.type === 'prompt-detected')).toBe(false);
    });
  });

  // ── markCommandStart / markCommandEnd ────────────────────────────────────

  describe('markCommandStart / markCommandEnd', () => {
    it('should set isCommandInProgress to true on markCommandStart', () => {
      detector.markCommandStart(5, 'some command');
      expect(detector.isCommandInProgress()).toBe(true);
    });

    it('should set currentCommandStartLine on markCommandStart', () => {
      detector.markCommandStart(10, 'ls');
      expect(detector.getCurrentCommandStartLine()).toBe(10);
    });

    it('should set isCommandInProgress to false on markCommandEnd', () => {
      detector.markCommandStart(5, 'ls');
      detector.markCommandEnd();
      expect(detector.isCommandInProgress()).toBe(false);
    });

    it('should reset currentCommandStartLine to -1 on markCommandEnd', () => {
      detector.markCommandStart(5, 'ls');
      detector.markCommandEnd();
      expect(detector.getCurrentCommandStartLine()).toBe(-1);
    });
  });

  // ── Multiple lines in single processOutput call ────────────────────────────

  describe('multi-line processOutput', () => {
    it('should handle multiple lines with prompt + command in one call', () => {
      const events = detector.processOutput('user@host:~$\ndocker ps', 5);
      const types = events.map((e) => e.type);
      expect(types).toContain('prompt-detected');
    });

    it('should skip empty lines', () => {
      const events = detector.processOutput('\n\n\n', 0);
      expect(events).toHaveLength(0);
    });

    it('should handle Windows-style CRLF line endings', () => {
      const events = detector.processOutput('user@host:~$\r\ndocker ps', 5);
      const types = events.map((e) => e.type);
      expect(types).toContain('prompt-detected');
    });
  });

  // ── Short command heuristic ────────────────────────────────────────────────

  describe('short command heuristic', () => {
    it('should treat a short word without spaces as a command', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('ls', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should treat a line < 200 chars as a likely command', () => {
      detector.processOutput('$ ', 0);
      const shortLine = 'some-output-line that is moderately long but under 200 chars';
      const events = detector.processOutput(shortLine, 1);
      // Should be treated as command since it's under 200 chars
      expect(events.some((e) => e.type === 'command-start')).toBe(true);
    });

    it('should not detect command-start for ls output (total N lines)', () => {
      detector.processOutput('$ ', 0);
      const events = detector.processOutput('total 64', 1);
      expect(events.some((e) => e.type === 'command-start')).toBe(false);
    });
  });
});
