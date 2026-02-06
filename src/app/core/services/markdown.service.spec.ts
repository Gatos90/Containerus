import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownService } from './markdown.service';

describe('MarkdownService', () => {
  let service: MarkdownService;

  beforeEach(() => {
    service = new MarkdownService();
  });

  describe('parse', () => {
    it('should parse bold text', () => {
      const result = service.parse('**bold**');
      expect(result).toContain('<strong>bold</strong>');
    });

    it('should parse italic text', () => {
      const result = service.parse('*italic*');
      expect(result).toContain('<em>italic</em>');
    });

    it('should parse headers', () => {
      const result = service.parse('# Header');
      expect(result).toContain('<h1');
      expect(result).toContain('Header');
    });

    it('should parse code blocks', () => {
      const result = service.parse('```\ncode\n```');
      expect(result).toContain('<code');
      expect(result).toContain('code');
    });

    it('should parse inline code', () => {
      const result = service.parse('`inline code`');
      expect(result).toContain('<code>inline code</code>');
    });

    it('should parse links', () => {
      const result = service.parse('[link](https://example.com)');
      expect(result).toContain('<a');
      expect(result).toContain('https://example.com');
    });

    it('should parse unordered lists', () => {
      const result = service.parse('- item 1\n- item 2');
      expect(result).toContain('<li>');
      expect(result).toContain('item 1');
      expect(result).toContain('item 2');
    });

    it('should parse ordered lists', () => {
      const result = service.parse('1. first\n2. second');
      expect(result).toContain('<ol');
      expect(result).toContain('first');
    });

    it('should parse tables', () => {
      const result = service.parse('| A | B |\n| --- | --- |\n| 1 | 2 |');
      expect(result).toContain('<table');
      expect(result).toContain('<th');
    });

    it('should handle empty string', () => {
      const result = service.parse('');
      expect(result).toBe('');
    });
  });

  describe('parseIncremental', () => {
    it('should parse complete markdown normally', () => {
      const result = service.parseIncremental('**bold** text');
      expect(result).toContain('<strong>bold</strong>');
    });

    it('should handle incomplete code blocks', () => {
      const result = service.parseIncremental('Some text\n```python\nprint("hi")');
      expect(result).toContain('streaming-text');
      expect(result).toContain('```python');
    });

    it('should handle complete code blocks', () => {
      const result = service.parseIncremental('```\ncode\n```');
      expect(result).toContain('<code');
      expect(result).not.toContain('streaming-text');
    });

    it('should handle complete content with no incomplete structures', () => {
      const result = service.parseIncremental('Hello **world**');
      expect(result).toContain('<strong>world</strong>');
      expect(result).not.toContain('streaming-text');
    });

    it('should escape HTML in incomplete sections', () => {
      const result = service.parseIncremental('```\n<script>alert("xss")</script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });
});
