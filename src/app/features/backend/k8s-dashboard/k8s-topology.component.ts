import {
  Component, Input, Output, EventEmitter, signal, computed,
  OnChanges, SimpleChanges, ElementRef, ViewChild, AfterViewInit, OnDestroy,
} from '@angular/core';
import { LucideAngularModule, Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-angular';
import { K8sTopology, K8sTopologyNode, K8sTopologyEdge } from '../../../core/models/backend.model';

interface LayoutNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  status: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
}

interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
  relation: string;
}

const KIND_ORDER: Record<string, number> = {
  Deployment: 0, StatefulSet: 0, DaemonSet: 0,
  ReplicaSet: 1,
  Pod: 2,
  Service: 3,
};

const KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Deployment: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  StatefulSet: { bg: '#3b1f5e', border: '#a855f7', text: '#d8b4fe' },
  DaemonSet: { bg: '#3b1f3b', border: '#ec4899', text: '#f9a8d4' },
  ReplicaSet: { bg: '#1a3340', border: '#0891b2', text: '#67e8f9' },
  Pod: { bg: '#1a3326', border: '#22c55e', text: '#86efac' },
  Service: { bg: '#3b3520', border: '#eab308', text: '#fde047' },
};

const STATUS_INDICATORS: Record<string, string> = {
  Running: '#22c55e', ready: '#22c55e', Active: '#22c55e',
  Pending: '#eab308', waiting: '#eab308',
  Failed: '#ef4444', CrashLoopBackOff: '#ef4444',
  Succeeded: '#3b82f6',
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const COL_GAP = 100;
const ROW_GAP = 20;

@Component({
  selector: 'app-k8s-topology',
  imports: [LucideAngularModule],
  template: `
    <div class="relative w-full h-full min-h-[400px] bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
      <!-- Controls -->
      <div class="absolute top-3 right-3 z-10 flex items-center gap-1">
        <button (click)="zoomIn()" class="bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 p-1.5 rounded" title="Zoom in">
          <lucide-icon [img]="ZoomIn" [size]="14" />
        </button>
        <button (click)="zoomOut()" class="bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 p-1.5 rounded" title="Zoom out">
          <lucide-icon [img]="ZoomOut" [size]="14" />
        </button>
        <button (click)="fitToView()" class="bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 p-1.5 rounded" title="Fit to view">
          <lucide-icon [img]="Maximize2" [size]="14" />
        </button>
      </div>

      <!-- Legend -->
      <div class="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2">
        @for (item of legendItems; track item.kind) {
          <span class="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
            [style.background]="item.bg" [style.color]="item.text">
            <span class="w-1.5 h-1.5 rounded-full" [style.background]="item.border"></span>
            {{ item.kind }}
          </span>
        }
      </div>

      @if (loading()) {
        <div class="absolute inset-0 flex items-center justify-center">
          <lucide-icon [img]="Loader2" [size]="20" class="animate-spin text-zinc-500" />
        </div>
      } @else if (layoutNodes().length === 0) {
        <div class="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
          No resources found in this namespace
        </div>
      } @else {
        <svg
          #svgEl
          class="w-full h-full cursor-grab active:cursor-grabbing"
          [attr.viewBox]="viewBox()"
          (mousedown)="onPanStart($event)"
          (wheel)="onWheel($event)"
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#52525b" />
            </marker>
          </defs>

          <!-- Edges -->
          @for (edge of layoutEdges(); track edge.from.id + '-' + edge.to.id) {
            <line
              [attr.x1]="edge.from.x + edge.from.width"
              [attr.y1]="edge.from.y + edge.from.height / 2"
              [attr.x2]="edge.to.x"
              [attr.y2]="edge.to.y + edge.to.height / 2"
              stroke="#3f3f46"
              stroke-width="1.5"
              [attr.stroke-dasharray]="edge.relation === 'routes-to' ? '5,3' : 'none'"
              marker-end="url(#arrowhead)"
            />
          }

          <!-- Nodes -->
          @for (node of layoutNodes(); track node.id) {
            <g
              class="cursor-pointer"
              (click)="onNodeClick(node)"
            >
              <rect
                [attr.x]="node.x" [attr.y]="node.y"
                [attr.width]="node.width" [attr.height]="node.height"
                rx="6" ry="6"
                [attr.fill]="getNodeColor(node.kind).bg"
                [attr.stroke]="getNodeColor(node.kind).border"
                stroke-width="1.5"
                class="transition-opacity"
              />
              <!-- Status indicator -->
              <circle
                [attr.cx]="node.x + 12" [attr.cy]="node.y + node.height / 2"
                r="4"
                [attr.fill]="getStatusColor(node.status)"
              />
              <!-- Kind label -->
              <text
                [attr.x]="node.x + 22" [attr.y]="node.y + 18"
                [attr.fill]="getNodeColor(node.kind).text"
                font-size="9" font-weight="500" opacity="0.7"
              >{{ node.kind }}</text>
              <!-- Name -->
              <text
                [attr.x]="node.x + 22" [attr.y]="node.y + 34"
                [attr.fill]="getNodeColor(node.kind).text"
                font-size="11" font-family="monospace"
              >{{ truncateName(node.name, 20) }}</text>
            </g>
          }
        </svg>
      }
    </div>
  `,
})
export class K8sTopologyComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() topology: K8sTopology | null = null;
  @Input() loading = signal(false);
  @Output() resourceSelect = new EventEmitter<{ kind: string; name: string; namespace: string }>();

  @ViewChild('svgEl') svgEl!: ElementRef<SVGSVGElement>;

  readonly Loader2 = Loader2;
  readonly ZoomIn = ZoomIn;
  readonly ZoomOut = ZoomOut;
  readonly Maximize2 = Maximize2;

  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartPanX = 0;
  private panStartPanY = 0;
  private boundOnPanMove = this.onPanMove.bind(this);
  private boundOnPanEnd = this.onPanEnd.bind(this);
  private contentWidth = 800;
  private contentHeight = 400;

  layoutNodes = signal<LayoutNode[]>([]);
  layoutEdges = signal<LayoutEdge[]>([]);
  viewBox = signal('0 0 800 400');

  readonly legendItems = Object.entries(KIND_COLORS).map(([kind, c]) => ({ kind, ...c }));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['topology']) {
      this.computeLayout();
    }
  }

  ngAfterViewInit(): void {
    this.fitToView();
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundOnPanMove);
    document.removeEventListener('mouseup', this.boundOnPanEnd);
  }

  private computeLayout(): void {
    if (!this.topology || this.topology.nodes.length === 0) {
      this.layoutNodes.set([]);
      this.layoutEdges.set([]);
      return;
    }

    // Group nodes by column
    const columns = new Map<number, K8sTopologyNode[]>();
    for (const node of this.topology.nodes) {
      const col = KIND_ORDER[node.kind] ?? 2;
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col)!.push(node);
    }

    // Sort columns
    const sortedCols = [...columns.keys()].sort((a, b) => a - b);

    const nodeMap = new Map<string, LayoutNode>();
    let maxY = 0;

    for (let colIdx = 0; colIdx < sortedCols.length; colIdx++) {
      const colKey = sortedCols[colIdx];
      const colNodes = columns.get(colKey)!;
      const x = 40 + colIdx * (NODE_WIDTH + COL_GAP);

      for (let rowIdx = 0; rowIdx < colNodes.length; rowIdx++) {
        const n = colNodes[rowIdx];
        const y = 40 + rowIdx * (NODE_HEIGHT + ROW_GAP);
        const layoutNode: LayoutNode = {
          id: `${n.kind}/${n.name}`,
          kind: n.kind,
          name: n.name,
          namespace: n.namespace,
          status: n.status,
          x,
          y,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          column: colIdx,
        };
        nodeMap.set(layoutNode.id, layoutNode);
        if (y + NODE_HEIGHT > maxY) maxY = y + NODE_HEIGHT;
      }
    }

    // Build edges
    const edges: LayoutEdge[] = [];
    if (this.topology.edges) {
      for (const e of this.topology.edges) {
        const from = nodeMap.get(`${e.from.kind}/${e.from.name}`);
        const to = nodeMap.get(`${e.to.kind}/${e.to.name}`);
        if (from && to) {
          // Swap direction if needed so edges go left→right
          if (from.column <= to.column) {
            edges.push({ from, to, relation: e.relation });
          } else {
            edges.push({ from: to, to: from, relation: e.relation });
          }
        }
      }
    }

    this.contentWidth = 40 + sortedCols.length * (NODE_WIDTH + COL_GAP) + 40;
    this.contentHeight = maxY + 60;

    this.layoutNodes.set([...nodeMap.values()]);
    this.layoutEdges.set(edges);
    this.updateViewBox();
  }

  private updateViewBox(): void {
    const w = this.contentWidth / this.zoom;
    const h = this.contentHeight / this.zoom;
    this.viewBox.set(`${this.panX} ${this.panY} ${w} ${h}`);
  }

  fitToView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateViewBox();
  }

  zoomIn(): void {
    this.zoom = Math.min(this.zoom * 1.25, 3);
    this.updateViewBox();
  }

  zoomOut(): void {
    this.zoom = Math.max(this.zoom / 1.25, 0.3);
    this.updateViewBox();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn();
    else this.zoomOut();
  }

  onPanStart(event: MouseEvent): void {
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.panStartPanX = this.panX;
    this.panStartPanY = this.panY;
    document.addEventListener('mousemove', this.boundOnPanMove);
    document.addEventListener('mouseup', this.boundOnPanEnd);
  }

  private onPanMove(event: MouseEvent): void {
    if (!this.isPanning) return;
    const scale = this.contentWidth / (this.zoom * (this.svgEl?.nativeElement?.clientWidth || 800));
    this.panX = this.panStartPanX - (event.clientX - this.panStartX) * scale;
    this.panY = this.panStartPanY - (event.clientY - this.panStartY) * scale;
    this.updateViewBox();
  }

  private onPanEnd(): void {
    this.isPanning = false;
    document.removeEventListener('mousemove', this.boundOnPanMove);
    document.removeEventListener('mouseup', this.boundOnPanEnd);
  }

  onNodeClick(node: LayoutNode): void {
    // Map kind back to plural lowercase for the detail panel
    const kindMap: Record<string, string> = {
      Pod: 'pods', Deployment: 'deployments', StatefulSet: 'statefulsets',
      DaemonSet: 'daemonsets', ReplicaSet: 'replicasets', Service: 'services',
    };
    this.resourceSelect.emit({
      kind: kindMap[node.kind] ?? node.kind.toLowerCase() + 's',
      name: node.name,
      namespace: node.namespace,
    });
  }

  getNodeColor(kind: string): { bg: string; border: string; text: string } {
    return KIND_COLORS[kind] ?? { bg: '#27272a', border: '#52525b', text: '#a1a1aa' };
  }

  getStatusColor(status: string): string {
    return STATUS_INDICATORS[status] ?? '#52525b';
  }

  truncateName(name: string, max: number): string {
    return name.length > max ? name.slice(0, max - 1) + '\u2026' : name;
  }
}
