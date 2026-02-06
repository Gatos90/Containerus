import { describe, it, expect } from 'vitest';
import { ContainerImage, getImageFullName, getImageSizeHuman } from './image.model';

function makeImage(overrides: Partial<ContainerImage> = {}): ContainerImage {
  return {
    id: 'sha256:abc123',
    name: 'nginx',
    tag: 'latest',
    size: 1024 * 1024 * 50, // 50 MB
    runtime: 'docker',
    systemId: 'sys-1',
    ...overrides,
  };
}

describe('Image Model Utilities', () => {
  describe('getImageFullName', () => {
    it('should return name:tag when tag exists', () => {
      const image = makeImage({ name: 'nginx', tag: 'latest' });
      expect(getImageFullName(image)).toBe('nginx:latest');
    });

    it('should return just name when tag is <none>', () => {
      const image = makeImage({ name: 'nginx', tag: '<none>' });
      expect(getImageFullName(image)).toBe('nginx');
    });

    it('should return just name when tag is empty', () => {
      const image = makeImage({ name: 'nginx', tag: '' });
      expect(getImageFullName(image)).toBe('nginx');
    });

    it('should handle custom tags', () => {
      const image = makeImage({ name: 'myapp', tag: 'v1.2.3' });
      expect(getImageFullName(image)).toBe('myapp:v1.2.3');
    });

    it('should handle repository prefix in name', () => {
      const image = makeImage({ name: 'docker.io/library/nginx', tag: 'alpine' });
      expect(getImageFullName(image)).toBe('docker.io/library/nginx:alpine');
    });
  });

  describe('getImageSizeHuman', () => {
    it('should format bytes', () => {
      const image = makeImage({ size: 500 });
      expect(getImageSizeHuman(image)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      const image = makeImage({ size: 1024 * 5 });
      expect(getImageSizeHuman(image)).toBe('5.00 KB');
    });

    it('should format megabytes', () => {
      const image = makeImage({ size: 1024 * 1024 * 150 });
      expect(getImageSizeHuman(image)).toBe('150.00 MB');
    });

    it('should format gigabytes', () => {
      const image = makeImage({ size: 1024 * 1024 * 1024 * 2 });
      expect(getImageSizeHuman(image)).toBe('2.00 GB');
    });

    it('should handle fractional sizes', () => {
      const image = makeImage({ size: 1024 * 1024 * 1024 + 1024 * 1024 * 512 });
      expect(getImageSizeHuman(image)).toBe('1.50 GB');
    });

    it('should handle zero size', () => {
      const image = makeImage({ size: 0 });
      expect(getImageSizeHuman(image)).toBe('0 B');
    });
  });
});
