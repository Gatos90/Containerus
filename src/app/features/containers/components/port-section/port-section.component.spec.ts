import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { PortSectionComponent } from './port-section.component';
import { ClipboardService } from '../../../../core/services/clipboard.service';
import type { PortMapping } from '../../../../core/models/container.model';

const makePort = (containerPort: number, hostPort = containerPort): PortMapping => ({
  hostIp: '0.0.0.0',
  hostPort,
  containerPort,
  protocol: 'tcp',
});

function makeComponent(ports: PortMapping[] = []): {
  component: PortSectionComponent;
  mockClipboard: any;
} {
  const mockClipboard: any = {
    copyPorts: vi.fn().mockResolvedValue(true),
  };

  const injector = Injector.create({
    providers: [{ provide: ClipboardService, useValue: mockClipboard }],
  });

  const component = runInInjectionContext(injector, () => new PortSectionComponent());

  (component as any).ports = signal(ports);
  (component as any).containerId = signal('ctr-1');
  (component as any).systemId = signal('sys-1');
  (component as any).showManageButton = signal(false);

  return { component, mockClipboard };
}

describe('PortSectionComponent', () => {
  let component: PortSectionComponent;
  let mockClipboard: any;

  beforeEach(() => {
    ({ component, mockClipboard } = makeComponent([makePort(80, 8080)]));
  });

  // ─── Construction & constants ────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose Lucide icon references', () => {
    expect(component.Network).toBeDefined();
    expect(component.Copy).toBeDefined();
    expect(component.Settings).toBeDefined();
    expect(component.ChevronDown).toBeDefined();
    expect(component.ChevronUp).toBeDefined();
  });

  it('should have COLLAPSE_THRESHOLD of 2', () => {
    expect(component.COLLAPSE_THRESHOLD).toBe(2);
  });

  // ─── expanded signal ─────────────────────────────────────────────────────

  it('should start in collapsed state', () => {
    expect(component.expanded()).toBe(false);
  });

  it('should toggle expanded state to true on first call', () => {
    component.toggleExpanded();
    expect(component.expanded()).toBe(true);
  });

  it('should toggle back to false on second call', () => {
    component.toggleExpanded();
    component.toggleExpanded();
    expect(component.expanded()).toBe(false);
  });

  // ─── isCollapsible computed ───────────────────────────────────────────────

  it('should not be collapsible when ports count equals threshold', () => {
    ({ component } = makeComponent([makePort(80), makePort(443)]));
    expect(component.isCollapsible()).toBe(false);
  });

  it('should not be collapsible when ports count is below threshold', () => {
    ({ component } = makeComponent([makePort(80)]));
    expect(component.isCollapsible()).toBe(false);
  });

  it('should be collapsible when ports count exceeds threshold', () => {
    ({ component } = makeComponent([makePort(80), makePort(443), makePort(8080)]));
    expect(component.isCollapsible()).toBe(true);
  });

  // ─── visiblePorts computed ────────────────────────────────────────────────

  it('should show all ports when total is at or below threshold', () => {
    const ports = [makePort(80), makePort(443)];
    ({ component } = makeComponent(ports));
    expect(component.visiblePorts()).toHaveLength(2);
  });

  it('should show only COLLAPSE_THRESHOLD ports when collapsible and collapsed', () => {
    const ports = [makePort(80), makePort(443), makePort(8080), makePort(9000)];
    ({ component } = makeComponent(ports));
    // collapsed by default
    expect(component.visiblePorts()).toHaveLength(2);
  });

  it('should show all ports when collapsible and expanded', () => {
    const ports = [makePort(80), makePort(443), makePort(8080), makePort(9000)];
    ({ component } = makeComponent(ports));
    component.toggleExpanded();
    expect(component.visiblePorts()).toHaveLength(4);
  });

  it('should show all ports when not collapsible regardless of expanded state', () => {
    const ports = [makePort(80)];
    ({ component } = makeComponent(ports));
    component.toggleExpanded(); // doesn't matter
    expect(component.visiblePorts()).toHaveLength(1);
  });

  // ─── hiddenCount computed ─────────────────────────────────────────────────

  it('should return 0 hidden ports when not collapsible', () => {
    const ports = [makePort(80), makePort(443)];
    ({ component } = makeComponent(ports));
    expect(component.hiddenCount()).toBe(0);
  });

  it('should return correct hidden count when collapsible and collapsed', () => {
    const ports = [makePort(80), makePort(443), makePort(8080), makePort(9000)];
    ({ component } = makeComponent(ports));
    expect(component.hiddenCount()).toBe(2);
  });

  it('should return 0 hidden count when expanded', () => {
    const ports = [makePort(80), makePort(443), makePort(8080)];
    ({ component } = makeComponent(ports));
    component.toggleExpanded();
    expect(component.hiddenCount()).toBe(0);
  });

  it('should return correct hidden count with exactly one extra port', () => {
    const ports = [makePort(80), makePort(443), makePort(8080)];
    ({ component } = makeComponent(ports));
    expect(component.hiddenCount()).toBe(1);
  });

  // ─── copyAllPorts ─────────────────────────────────────────────────────────

  it('should call clipboard.copyPorts with all ports', async () => {
    const ports = [makePort(80, 8080), makePort(443, 4430)];
    ({ component, mockClipboard } = makeComponent(ports));

    await component.copyAllPorts();

    expect(mockClipboard.copyPorts).toHaveBeenCalledWith(ports);
  });

  it('should call clipboard.copyPorts even with empty port list', async () => {
    ({ component, mockClipboard } = makeComponent([]));

    await component.copyAllPorts();

    expect(mockClipboard.copyPorts).toHaveBeenCalledWith([]);
  });
});
