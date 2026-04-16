/**
 * Converts a FormModel into a K8s YAML manifest string.
 * No external dependencies — uses a hand-rolled YAML serializer
 * extracted from k8s-resource-detail.component.ts.
 */

import { FormModel, ContainerModel, KeyValuePair } from './k8s-resource-form-defs';

// ============================================================================
// Public API
// ============================================================================

export function formToYaml(resourceType: string, model: FormModel, namespace: string): string {
  const builder = FORM_BUILDERS[resourceType];
  if (!builder) return '';
  const obj = builder(model, namespace);
  return objectToYaml(obj, 0);
}

// ============================================================================
// YAML serializer (extracted from k8s-resource-detail.component.ts)
// ============================================================================

export function objectToYaml(obj: any, indent: number): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(': ') || obj.includes('#') || obj === '' || obj === 'true' || obj === 'false') {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

  const prefix = '  '.repeat(indent);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const inner = objectToYaml(item, indent + 1);
        const firstLine = inner.split('\n')[0];
        const rest = inner.split('\n').slice(1).join('\n');
        return `${prefix}- ${firstLine}${rest ? '\n' + rest : ''}`;
      }
      return `${prefix}- ${objectToYaml(item, 0)}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries.map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        const inner = objectToYaml(value, indent + 1);
        if (Array.isArray(value) && value.length > 0) {
          return `${prefix}${key}:\n${inner}`;
        }
        if (typeof value === 'object' && Object.keys(value).length > 0) {
          return `${prefix}${key}:\n${inner}`;
        }
        return `${prefix}${key}: ${inner}`;
      }
      return `${prefix}${key}: ${objectToYaml(value, 0)}`;
    }).join('\n');
  }

  return String(obj);
}

// ============================================================================
// Helpers
// ============================================================================

function kvToObj(pairs: KeyValuePair[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const p of pairs) {
    if (p.key.trim()) obj[p.key.trim()] = p.value;
  }
  return obj;
}

function hasKv(pairs: KeyValuePair[]): boolean {
  return pairs.some(p => p.key.trim() !== '');
}

function buildMetadata(name: string, namespace: string | null, labels: KeyValuePair[], annotations: KeyValuePair[]): any {
  const meta: any = { name };
  if (namespace) meta.namespace = namespace;
  if (hasKv(labels)) meta.labels = kvToObj(labels);
  if (hasKv(annotations)) meta.annotations = kvToObj(annotations);
  return meta;
}

function buildContainerSpec(c: ContainerModel): any {
  const spec: any = { name: c.name || 'main', image: c.image || 'nginx:latest' };
  const ports = c.ports.filter(p => p.containerPort > 0);
  if (ports.length > 0) {
    spec.ports = ports.map(p => ({ containerPort: p.containerPort, protocol: p.protocol || 'TCP' }));
  }
  const env = c.env.filter(e => e.name.trim());
  if (env.length > 0) {
    spec.env = env.map(e => ({ name: e.name, value: e.value }));
  }
  if (c.command.trim()) {
    spec.command = c.command.split(/\s+/);
  }
  const resources: any = {};
  if (c.cpuRequest || c.memRequest) {
    resources.requests = {};
    if (c.cpuRequest) resources.requests.cpu = c.cpuRequest;
    if (c.memRequest) resources.requests.memory = c.memRequest;
  }
  if (c.cpuLimit || c.memLimit) {
    resources.limits = {};
    if (c.cpuLimit) resources.limits.cpu = c.cpuLimit;
    if (c.memLimit) resources.limits.memory = c.memLimit;
  }
  if (Object.keys(resources).length > 0) spec.resources = resources;
  return spec;
}

function buildRbacRulesFromModel(m: FormModel): any[] {
  if (!m.rbacResources.trim()) return [];
  return [{
    apiGroups: m.rbacApiGroups.split(',').map(g => g.trim().replace(/^""$/, '')),
    resources: m.rbacResources.split(',').map(r => r.trim()),
    verbs: m.rbacVerbs.split(',').map(v => v.trim()),
  }];
}

function workloadLabels(model: FormModel): Record<string, string> {
  return { app: model.name, ...kvToObj(model.labels) };
}

function podTemplateSpec(model: FormModel): any {
  const spec: any = {
    containers: model.containers.map(buildContainerSpec),
  };
  if (hasKv(model.nodeSelector)) {
    spec.nodeSelector = kvToObj(model.nodeSelector);
  }
  return spec;
}

// ============================================================================
// Builder functions per resource type
// ============================================================================

const FORM_BUILDERS: Record<string, (m: FormModel, ns: string) => any> = {

  deployments: (m, ns) => {
    const labels = workloadLabels(m);
    const obj: any = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        replicas: m.replicas,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: podTemplateSpec(m),
        },
      },
    };
    if (m.strategyType === 'Recreate') {
      obj.spec.strategy = { type: 'Recreate' };
    } else if (m.maxUnavailable !== '25%' || m.maxSurge !== '25%') {
      obj.spec.strategy = {
        type: 'RollingUpdate',
        rollingUpdate: { maxUnavailable: m.maxUnavailable, maxSurge: m.maxSurge },
      };
    }
    return obj;
  },

  statefulsets: (m, ns) => {
    const labels = workloadLabels(m);
    return {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        replicas: m.replicas,
        serviceName: m.serviceName || m.name,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: podTemplateSpec(m),
        },
      },
    };
  },

  daemonsets: (m, ns) => {
    const labels = workloadLabels(m);
    return {
      apiVersion: 'apps/v1',
      kind: 'DaemonSet',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: podTemplateSpec(m),
        },
      },
    };
  },

  jobs: (m, ns) => {
    const spec = podTemplateSpec(m);
    spec.restartPolicy = m.restartPolicy || 'Never';
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        backoffLimit: m.backoffLimit,
        template: { spec },
      },
    };
  },

  cronjobs: (m, ns) => {
    const spec = podTemplateSpec(m);
    spec.restartPolicy = m.restartPolicy || 'Never';
    const obj: any = {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        schedule: m.schedule || '*/5 * * * *',
        jobTemplate: {
          spec: {
            backoffLimit: m.backoffLimit,
            template: { spec },
          },
        },
      },
    };
    if (m.concurrencyPolicy !== 'Allow') {
      obj.spec.concurrencyPolicy = m.concurrencyPolicy;
    }
    return obj;
  },

  services: (m, ns) => {
    const ports = m.ports.filter(p => p.port > 0).map(p => {
      const sp: any = { port: p.port, targetPort: p.targetPort || p.port, protocol: p.protocol || 'TCP' };
      if (p.name) sp.name = p.name;
      if (p.nodePort && m.serviceType === 'NodePort') sp.nodePort = p.nodePort;
      return sp;
    });
    return {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        type: m.serviceType || 'ClusterIP',
        selector: kvToObj(m.selector),
        ports,
      },
    };
  },

  configmaps: (m, ns) => ({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    data: kvToObj(m.data),
  }),

  secrets: (m, ns) => ({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    type: m.secretType || 'Opaque',
    stringData: kvToObj(m.data),
  }),

  ingresses: (m, ns) => {
    const rules = m.ingressRules.filter(r => r.serviceName).map(r => ({
      ...(r.host && { host: r.host }),
      http: {
        paths: [{
          path: r.path || '/',
          pathType: r.pathType || 'Prefix',
          backend: {
            service: {
              name: r.serviceName,
              port: { number: r.servicePort || 80 },
            },
          },
        }],
      },
    }));
    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: { rules },
    };
  },

  pvcs: (m, ns) => {
    const spec: any = {
      accessModes: [m.accessMode || 'ReadWriteOnce'],
      resources: { requests: { storage: m.storageSize || '1Gi' } },
    };
    if (m.storageClassName) spec.storageClassName = m.storageClassName;
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec,
    };
  },

  pods: (m, ns) => {
    const spec: any = {
      containers: m.containers.map(buildContainerSpec),
    };
    if (m.restartPolicy && m.restartPolicy !== 'Always') {
      spec.restartPolicy = m.restartPolicy;
    }
    if (hasKv(m.nodeSelector)) {
      spec.nodeSelector = kvToObj(m.nodeSelector);
    }
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec,
    };
  },

  horizontalpodautoscalers: (m, ns) => ({
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    spec: {
      scaleTargetRef: {
        apiVersion: 'apps/v1',
        kind: m.scaleTargetKind || 'Deployment',
        name: m.scaleTargetName || m.name,
      },
      minReplicas: m.minReplicas || 1,
      maxReplicas: m.maxReplicas || 10,
      metrics: [{
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: {
            type: 'Utilization',
            averageUtilization: m.targetCpuUtilization || 80,
          },
        },
      }],
    },
  }),

  poddisruptionbudgets: (m, ns) => ({
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    spec: {
      minAvailable: isNaN(Number(m.minAvailable)) ? m.minAvailable : Number(m.minAvailable),
      selector: { matchLabels: kvToObj(m.selector) },
    },
  }),

  networkpolicies: (m, ns) => {
    const policyTypes = m.policyTypes === 'Both'
      ? ['Ingress', 'Egress']
      : [m.policyTypes || 'Ingress'];
    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        podSelector: { matchLabels: kvToObj(m.netpolPodSelector) },
        policyTypes,
      },
    };
  },

  resourcequotas: (m, ns) => {
    const hard: Record<string, string> = {};
    if (m.quotaHardPods) hard['pods'] = m.quotaHardPods;
    if (m.quotaHardCpuRequests) hard['requests.cpu'] = m.quotaHardCpuRequests;
    if (m.quotaHardMemRequests) hard['requests.memory'] = m.quotaHardMemRequests;
    if (m.quotaHardCpuLimits) hard['limits.cpu'] = m.quotaHardCpuLimits;
    if (m.quotaHardMemLimits) hard['limits.memory'] = m.quotaHardMemLimits;
    return {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: { hard },
    };
  },

  limitranges: (m, ns) => {
    const def: Record<string, string> = {};
    const defReq: Record<string, string> = {};
    if (m.limitDefaultCpu) def['cpu'] = m.limitDefaultCpu;
    if (m.limitDefaultMem) def['memory'] = m.limitDefaultMem;
    if (m.limitDefaultRequestCpu) defReq['cpu'] = m.limitDefaultRequestCpu;
    if (m.limitDefaultRequestMem) defReq['memory'] = m.limitDefaultRequestMem;
    return {
      apiVersion: 'v1',
      kind: 'LimitRange',
      metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
      spec: {
        limits: [{
          ...(Object.keys(def).length > 0 && { default: def }),
          ...(Object.keys(defReq).length > 0 && { defaultRequest: defReq }),
          type: 'Container',
        }],
      },
    };
  },

  serviceaccounts: (m, ns) => ({
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
  }),

  persistentvolumes: (m, _ns) => {
    const spec: any = {
      capacity: { storage: m.storageSize || '10Gi' },
      accessModes: [m.accessMode || 'ReadWriteOnce'],
      persistentVolumeReclaimPolicy: m.reclaimPolicy || 'Retain',
    };
    if (m.hostPath) spec.hostPath = { path: m.hostPath };
    if (m.storageClassName) spec.storageClassName = m.storageClassName;
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: buildMetadata(m.name, null, m.labels, m.annotations),
      spec,
    };
  },

  storageclasses: (m, _ns) => ({
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: buildMetadata(m.name, null, m.labels, m.annotations),
    provisioner: m.provisioner || 'kubernetes.io/no-provisioner',
    volumeBindingMode: m.volumeBindingMode || 'WaitForFirstConsumer',
    reclaimPolicy: m.reclaimPolicy || 'Delete',
  }),

  roles: (m, ns) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    rules: buildRbacRulesFromModel(m),
  }),

  clusterroles: (m, _ns) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: buildMetadata(m.name, null, m.labels, m.annotations),
    rules: buildRbacRulesFromModel(m),
  }),

  rolebindings: (m, ns) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: buildMetadata(m.name, ns, m.labels, m.annotations),
    subjects: [{
      kind: m.subjectKind || 'ServiceAccount',
      name: m.subjectName,
      ...(m.subjectNamespace && { namespace: m.subjectNamespace }),
    }],
    roleRef: {
      kind: m.roleRefKind || 'Role',
      name: m.roleRefName,
      apiGroup: 'rbac.authorization.k8s.io',
    },
  }),

  clusterrolebindings: (m, _ns) => ({
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: buildMetadata(m.name, null, m.labels, m.annotations),
    subjects: [{
      kind: m.subjectKind || 'ServiceAccount',
      name: m.subjectName,
      ...(m.subjectNamespace && { namespace: m.subjectNamespace }),
    }],
    roleRef: {
      kind: 'ClusterRole',
      name: m.roleRefName,
      apiGroup: 'rbac.authorization.k8s.io',
    },
  }),
};
