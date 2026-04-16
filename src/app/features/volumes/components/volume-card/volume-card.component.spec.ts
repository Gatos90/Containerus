import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { VolumeCardComponent } from './volume-card.component';

setupTestBed();
import { Volume } from '../../../../core/models/volume.model';
import { Container } from '../../../../core/models/container.model';

function makeVolume(overrides: Partial<Volume> = {}): Volume {
  return {
    name: 'my-volume',
    driver: 'local',
    mountpoint: '/var/lib/docker/volumes/my-volume/_data',
    createdAt: '2024-01-01T00:00:00Z',
    labels: {},
    options: {},
    runtime: 'docker',
    systemId: 'sys-1',
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

describe('VolumeCardComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<VolumeCardComponent>>;
  let component: VolumeCardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [VolumeCardComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(VolumeCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('volume', makeVolume());
    fixture.componentRef.setInput('containers', []);
  });

  describe('containerCount', () => {
    it('returns the correct count of containers', () => {
      fixture.componentRef.setInput('containers', [makeContainer(), makeContainer({ id: 'c-2' })]);
      expect(component.containerCount()).toBe(2);
    });

    it('returns 0 for empty container list', () => {
      fixture.componentRef.setInput('containers', []);
      expect(component.containerCount()).toBe(0);
    });
  });

  describe('hasLabels', () => {
    it('returns true when volume has labels', () => {
      fixture.componentRef.setInput('volume', makeVolume({ labels: { env: 'prod', team: 'backend' } }));
      expect(component.hasLabels()).toBe(true);
    });

    it('returns false when labels object is empty', () => {
      fixture.componentRef.setInput('volume', makeVolume({ labels: {} }));
      expect(component.hasLabels()).toBe(false);
    });
  });

  describe('labelEntries', () => {
    it('returns entries as [key, value] tuples', () => {
      fixture.componentRef.setInput('volume', makeVolume({ labels: { env: 'prod', tier: 'db' } }));
      const entries = component.labelEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual(['env', 'prod']);
    });

    it('truncates to 3 labels', () => {
      fixture.componentRef.setInput('volume', makeVolume({
        labels: { a: '1', b: '2', c: '3', d: '4', e: '5' },
      }));
      expect(component.labelEntries()).toHaveLength(3);
    });

    it('returns empty array when no labels', () => {
      fixture.componentRef.setInput('volume', makeVolume({ labels: {} }));
      expect(component.labelEntries()).toEqual([]);
    });
  });

  describe('truncatedMountpoint', () => {
    it('returns short mountpoints unchanged', () => {
      const short = '/data/vol';
      fixture.componentRef.setInput('volume', makeVolume({ mountpoint: short }));
      expect(component.truncatedMountpoint()).toBe(short);
    });

    it('truncates mountpoints longer than 40 characters', () => {
      const long = '/var/lib/docker/volumes/really-long-volume-name-here/_data';
      fixture.componentRef.setInput('volume', makeVolume({ mountpoint: long }));
      const result = component.truncatedMountpoint();
      expect(result.startsWith('...')).toBe(true);
      expect(result.length).toBe(40); // '...' + 37 trailing chars
    });

    it('preserves the tail of long mountpoints', () => {
      const long = '/var/lib/docker/volumes/really-long-volume-name-here/_data';
      fixture.componentRef.setInput('volume', makeVolume({ mountpoint: long }));
      const result = component.truncatedMountpoint();
      expect(result.endsWith('/_data')).toBe(true);
    });
  });

  describe('onDelete', () => {
    it('stops event propagation', () => {
      const event = { stopPropagation: vi.fn() } as unknown as Event;
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
