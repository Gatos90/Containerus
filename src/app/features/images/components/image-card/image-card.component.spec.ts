import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { ImageCardComponent } from './image-card.component';

setupTestBed();
import { ContainerImage } from '../../../../core/models/image.model';
import { Container } from '../../../../core/models/container.model';

function makeImage(overrides: Partial<ContainerImage> = {}): ContainerImage {
  return {
    id: 'sha256:abc123def456789012345',
    name: 'nginx',
    tag: 'latest',
    size: 50 * 1024 * 1024, // 50 MB
    created: '2024-01-15T00:00:00Z',
    repository: 'library/nginx',
    runtime: 'docker',
    systemId: 'sys-1',
    digest: 'sha256:abcdef1234567890abcdef',
    architecture: 'amd64',
    os: 'linux',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-1',
    name: 'test-container',
    image: 'nginx:latest',
    status: 'running',
    runtime: 'docker',
    systemId: 'sys-1',
    createdAt: '2024-01-01T00:00:00Z',
    ports: [],
    volumes: [],
    networks: [],
    labels: {},
    networkSettings: { networks: {} },
    ...overrides,
  } as Container;
}

describe('ImageCardComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ImageCardComponent>>;
  let component: ImageCardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImageCardComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).overrideComponent(ImageCardComponent, { set: { imports: [] } });
    fixture = TestBed.createComponent(ImageCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('image', makeImage());
    fixture.componentRef.setInput('containers', []);
  });

  describe('shortId', () => {
    it('strips sha256: prefix and returns first 12 characters', () => {
      fixture.componentRef.setInput('image', makeImage({ id: 'sha256:abc123def456789' }));
      expect(component.shortId()).toBe('abc123def456');
    });

    it('returns first 12 chars when no sha256 prefix', () => {
      fixture.componentRef.setInput('image', makeImage({ id: 'abc123def456789' }));
      expect(component.shortId()).toBe('abc123def456');
    });

    it('handles short ids without truncation', () => {
      fixture.componentRef.setInput('image', makeImage({ id: 'short' }));
      expect(component.shortId()).toBe('short');
    });
  });

  describe('containerCount', () => {
    it('returns the correct number of containers', () => {
      fixture.componentRef.setInput('containers', [makeContainer(), makeContainer({ id: 'c-2' })]);
      expect(component.containerCount()).toBe(2);
    });

    it('returns 0 for empty container list', () => {
      fixture.componentRef.setInput('containers', []);
      expect(component.containerCount()).toBe(0);
    });
  });

  describe('fullName', () => {
    it('combines name and tag', () => {
      fixture.componentRef.setInput('image', makeImage({ name: 'nginx', tag: 'latest' }));
      expect(component.fullName()).toBe('nginx:latest');
    });

    it('returns just name when tag is <none>', () => {
      fixture.componentRef.setInput('image', makeImage({ name: 'nginx', tag: '<none>' }));
      expect(component.fullName()).toBe('nginx');
    });

    it('returns just name when tag is empty string', () => {
      fixture.componentRef.setInput('image', makeImage({ name: 'my-image', tag: '' }));
      expect(component.fullName()).toBe('my-image');
    });
  });

  describe('sizeHuman', () => {
    it('formats bytes as bytes when under 1 KB', () => {
      fixture.componentRef.setInput('image', makeImage({ size: 512 }));
      expect(component.sizeHuman()).toBe('512 B');
    });

    it('formats size in KB', () => {
      fixture.componentRef.setInput('image', makeImage({ size: 2048 }));
      expect(component.sizeHuman()).toBe('2.00 KB');
    });

    it('formats size in MB', () => {
      fixture.componentRef.setInput('image', makeImage({ size: 50 * 1024 * 1024 }));
      expect(component.sizeHuman()).toContain('MB');
    });

    it('formats size in GB', () => {
      fixture.componentRef.setInput('image', makeImage({ size: 2 * 1024 * 1024 * 1024 }));
      expect(component.sizeHuman()).toContain('GB');
    });
  });

  describe('archDisplay', () => {
    it('combines os and architecture when both present', () => {
      fixture.componentRef.setInput('image', makeImage({ os: 'linux', architecture: 'amd64' }));
      expect(component.archDisplay()).toBe('linux/amd64');
    });

    it('returns just architecture when os is absent', () => {
      fixture.componentRef.setInput('image', makeImage({ os: null, architecture: 'arm64' }));
      expect(component.archDisplay()).toBe('arm64');
    });

    it('returns null when both are absent', () => {
      fixture.componentRef.setInput('image', makeImage({ os: null, architecture: null }));
      expect(component.archDisplay()).toBeNull();
    });
  });

  describe('truncatedDigest', () => {
    it('truncates long digests', () => {
      fixture.componentRef.setInput('image', makeImage({ digest: 'sha256:abcdef1234567890' }));
      const result = component.truncatedDigest();
      expect(result).toContain('...');
      expect(result!.length).toBeLessThan('sha256:abcdef1234567890'.length);
    });

    it('returns short digests unchanged', () => {
      fixture.componentRef.setInput('image', makeImage({ digest: 'sha256:short' }));
      expect(component.truncatedDigest()).toBe('sha256:short');
    });

    it('returns null when digest is absent', () => {
      fixture.componentRef.setInput('image', makeImage({ digest: null }));
      expect(component.truncatedDigest()).toBeNull();
    });
  });

  describe('relativeTime', () => {
    it('returns null when created is null', () => {
      fixture.componentRef.setInput('image', makeImage({ created: null }));
      expect(component.relativeTime()).toBeNull();
    });

    it('returns "Today" for today', () => {
      const today = new Date().toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: today }));
      expect(component.relativeTime()).toBe('Today');
    });

    it('returns "Yesterday" for 1 day ago', () => {
      const yesterday = new Date(Date.now() - 86400000 * 1.5).toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: yesterday }));
      expect(component.relativeTime()).toBe('Yesterday');
    });

    it('returns days ago for within a week', () => {
      const fiveDaysAgo = new Date(Date.now() - 86400000 * 5).toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: fiveDaysAgo }));
      expect(component.relativeTime()).toBe('5 days ago');
    });

    it('returns weeks ago for within a month', () => {
      const twoWeeksAgo = new Date(Date.now() - 86400000 * 14).toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: twoWeeksAgo }));
      expect(component.relativeTime()).toBe('2 weeks ago');
    });

    it('returns months ago for within a year', () => {
      const twoMonthsAgo = new Date(Date.now() - 86400000 * 65).toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: twoMonthsAgo }));
      expect(component.relativeTime()).toBe('2 months ago');
    });

    it('returns years ago for over a year', () => {
      const twoYearsAgo = new Date(Date.now() - 86400000 * 730).toISOString();
      fixture.componentRef.setInput('image', makeImage({ created: twoYearsAgo }));
      expect(component.relativeTime()).toBe('2 years ago');
    });
  });

  describe('onDelete', () => {
    it('stops event propagation', () => {
      const event = { stopPropagation: vi.fn() } as unknown as Event;
      const emitSpy = vi.spyOn(component.deleted, 'emit');
      component.onDelete(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('emits deleted event', () => {
      const event = { stopPropagation: vi.fn() } as unknown as Event;
      const emitSpy = vi.spyOn(component.deleted, 'emit');
      component.onDelete(event);
      expect(emitSpy).toHaveBeenCalled();
    });
  });
});
