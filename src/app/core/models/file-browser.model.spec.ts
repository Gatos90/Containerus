import { describe, it, expect } from 'vitest';
import { formatFileSize, isTextFile } from './file-browser.model';

describe('File Browser Model Utilities', () => {
  describe('formatFileSize', () => {
    it('should format zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should format terabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });

    it('should handle fractional values', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });
  });

  describe('isTextFile', () => {
    it('should recognize common text file extensions', () => {
      expect(isTextFile('file.txt')).toBe(true);
      expect(isTextFile('file.md')).toBe(true);
      expect(isTextFile('file.json')).toBe(true);
      expect(isTextFile('file.yaml')).toBe(true);
      expect(isTextFile('file.yml')).toBe(true);
      expect(isTextFile('file.toml')).toBe(true);
      expect(isTextFile('file.xml')).toBe(true);
    });

    it('should recognize programming language files', () => {
      expect(isTextFile('app.ts')).toBe(true);
      expect(isTextFile('app.js')).toBe(true);
      expect(isTextFile('main.py')).toBe(true);
      expect(isTextFile('main.rs')).toBe(true);
      expect(isTextFile('main.go')).toBe(true);
      expect(isTextFile('App.java')).toBe(true);
      expect(isTextFile('main.c')).toBe(true);
      expect(isTextFile('main.cpp')).toBe(true);
      expect(isTextFile('header.h')).toBe(true);
      expect(isTextFile('app.rb')).toBe(true);
    });

    it('should recognize web files', () => {
      expect(isTextFile('index.html')).toBe(true);
      expect(isTextFile('styles.css')).toBe(true);
      expect(isTextFile('styles.scss')).toBe(true);
      expect(isTextFile('styles.less')).toBe(true);
      expect(isTextFile('App.jsx')).toBe(true);
      expect(isTextFile('App.tsx')).toBe(true);
      expect(isTextFile('App.vue')).toBe(true);
      expect(isTextFile('App.svelte')).toBe(true);
    });

    it('should recognize config files', () => {
      expect(isTextFile('config.conf')).toBe(true);
      expect(isTextFile('settings.cfg')).toBe(true);
      expect(isTextFile('config.ini')).toBe(true);
      expect(isTextFile('.env')).toBe(true);
    });

    it('should recognize shell scripts', () => {
      expect(isTextFile('script.sh')).toBe(true);
      expect(isTextFile('script.bash')).toBe(true);
      expect(isTextFile('script.zsh')).toBe(true);
      expect(isTextFile('script.fish')).toBe(true);
    });

    it('should recognize special filenames', () => {
      expect(isTextFile('Dockerfile')).toBe(true);
      expect(isTextFile('Makefile')).toBe(true);
      expect(isTextFile('README')).toBe(true);
      expect(isTextFile('LICENSE')).toBe(true);
      expect(isTextFile('CHANGELOG')).toBe(true);
      expect(isTextFile('.gitignore')).toBe(true);
      expect(isTextFile('.dockerignore')).toBe(true);
    });

    it('should recognize data files', () => {
      expect(isTextFile('data.csv')).toBe(true);
      expect(isTextFile('query.sql')).toBe(true);
      expect(isTextFile('schema.graphql')).toBe(true);
      expect(isTextFile('message.proto')).toBe(true);
    });

    it('should recognize SVG as text', () => {
      expect(isTextFile('icon.svg')).toBe(true);
    });

    it('should not recognize binary files as text', () => {
      expect(isTextFile('image.png')).toBe(false);
      expect(isTextFile('photo.jpg')).toBe(false);
      expect(isTextFile('video.mp4')).toBe(false);
      expect(isTextFile('archive.zip')).toBe(false);
      expect(isTextFile('binary.exe')).toBe(false);
      expect(isTextFile('library.so')).toBe(false);
      expect(isTextFile('database.db')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isTextFile('FILE.TXT')).toBe(true);
      expect(isTextFile('APP.TS')).toBe(true);
      expect(isTextFile('Dockerfile')).toBe(true);
    });
  });
});
