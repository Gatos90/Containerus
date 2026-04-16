/**
 * Parses a K8s YAML manifest string back into a FormModel.
 * Uses js-yaml for YAML parsing. Returns null on parse failure.
 */

import * as yaml from 'js-yaml';
import {
  FormModel, ContainerModel, KeyValuePair, ServicePortModel,
  IngressRuleModel, createDefaultFormModel, createDefaultContainer,
} from './k8s-resource-form-defs';

// ============================================================================
// Public API
// ============================================================================

export function yamlToForm(resourceType: string, yamlString: string, currentModel: FormModel): FormModel | null {
  try {
    const parsed = yaml.load(yamlString) as any;
    if (!parsed || typeof parsed !== 'object') return null;

    const parser = FORM_PARSERS[resourceType];
    if (!parser) return null;

    return parser(parsed, currentModel);
  } catch {
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function objToKv(obj: Record<string, any> | undefined | null): KeyValuePair[] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }));
}

function parseContainer(c: any): ContainerModel {
  if (!c || typeof c !== 'object') return createDefaultContainer();
  return {
    name: c.name ?? '',
    image: c.image ?? '',
    ports: (c.ports ?? []).map((p: any) => ({
      containerPort: p.containerPort ?? 80,
      protocol: p.protocol ?? 'TCP',
    })),
    env: (c.env ?? []).map((e: any) => ({
      name: e.name ?? '',
      value: e.value ?? '',
    })),
    command: Array.isArray(c.command) ? c.command.join(' ') : (c.command ?? ''),
    cpuRequest: c.resources?.requests?.cpu ?? '',
    cpuLimit: c.resources?.limits?.cpu ?? '',
    memRequest: c.resources?.requests?.memory ?? '',
    memLimit: c.resources?.limits?.memory ?? '',
  };
}

function parseContainers(obj: any): ContainerModel[] {
  const containers = obj.spec?.template?.spec?.containers ?? obj.spec?.containers ?? [];
  if (!Array.isArray(containers) || containers.length === 0) {
    return [createDefaultContainer()];
  }
  return containers.map(parseContainer);
}

function parseRbacRuleFields(rules: any[] | undefined): { rbacApiGroups: string; rbacResources: string; rbacVerbs: string } {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { rbacApiGroups: '""', rbacResources: 'pods', rbacVerbs: 'get, list, watch' };
  }
  // Merge all rules into comma-separated strings (first rule takes priority for simple form)
  const r = rules[0];
  return {
    rbacApiGroups: (r.apiGroups ?? ['']).map((g: string) => g === '' ? '""' : g).join(', '),
    rbacResources: (r.resources ?? []).join(', '),
    rbacVerbs: (r.verbs ?? []).join(', '),
  };
}

function parseRestartPolicy(obj: any): string {
  return obj.spec?.template?.spec?.restartPolicy ?? 'Never';
}

// ============================================================================
// Parsers per resource type
// ============================================================================

const FORM_PARSERS: Record<string, (obj: any, current: FormModel) => FormModel> = {

  deployments: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    replicas: obj.spec?.replicas ?? current.replicas,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    containers: parseContainers(obj),
    strategyType: obj.spec?.strategy?.type ?? 'RollingUpdate',
    maxUnavailable: obj.spec?.strategy?.rollingUpdate?.maxUnavailable?.toString() ?? '25%',
    maxSurge: obj.spec?.strategy?.rollingUpdate?.maxSurge?.toString() ?? '25%',
    nodeSelector: objToKv(obj.spec?.template?.spec?.nodeSelector),
  }),

  statefulsets: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    replicas: obj.spec?.replicas ?? current.replicas,
    serviceName: obj.spec?.serviceName ?? '',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    containers: parseContainers(obj),
    nodeSelector: objToKv(obj.spec?.template?.spec?.nodeSelector),
  }),

  daemonsets: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    containers: parseContainers(obj),
    nodeSelector: objToKv(obj.spec?.template?.spec?.nodeSelector),
  }),

  jobs: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    containers: parseContainers({ spec: { template: obj.spec?.template } }),
    restartPolicy: parseRestartPolicy(obj),
    backoffLimit: obj.spec?.backoffLimit ?? 3,
  }),

  cronjobs: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    schedule: obj.spec?.schedule ?? '*/5 * * * *',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    containers: parseContainers({ spec: { template: obj.spec?.jobTemplate?.spec?.template } }),
    concurrencyPolicy: obj.spec?.concurrencyPolicy ?? 'Allow',
    restartPolicy: obj.spec?.jobTemplate?.spec?.template?.spec?.restartPolicy ?? 'Never',
    backoffLimit: obj.spec?.jobTemplate?.spec?.backoffLimit ?? 3,
  }),

  services: (obj, current) => {
    const ports: ServicePortModel[] = (obj.spec?.ports ?? []).map((p: any) => ({
      name: p.name ?? '',
      port: p.port ?? 80,
      targetPort: p.targetPort ?? p.port ?? 80,
      protocol: p.protocol ?? 'TCP',
      nodePort: p.nodePort,
    }));
    return {
      ...createDefaultFormModel(),
      name: obj.metadata?.name ?? current.name,
      serviceType: obj.spec?.type ?? 'ClusterIP',
      selector: objToKv(obj.spec?.selector),
      ports: ports.length > 0 ? ports : current.ports,
      labels: objToKv(obj.metadata?.labels),
      annotations: objToKv(obj.metadata?.annotations),
    };
  },

  configmaps: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    data: objToKv(obj.data).length > 0 ? objToKv(obj.data) : current.data,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  secrets: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    secretType: obj.type ?? 'Opaque',
    data: objToKv(obj.stringData ?? obj.data).length > 0 ? objToKv(obj.stringData ?? obj.data) : current.data,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  ingresses: (obj, current) => {
    const rules: IngressRuleModel[] = (obj.spec?.rules ?? []).flatMap((r: any) =>
      (r.http?.paths ?? []).map((p: any) => ({
        host: r.host ?? '',
        path: p.path ?? '/',
        pathType: p.pathType ?? 'Prefix',
        serviceName: p.backend?.service?.name ?? '',
        servicePort: p.backend?.service?.port?.number ?? 80,
      }))
    );
    return {
      ...createDefaultFormModel(),
      name: obj.metadata?.name ?? current.name,
      ingressRules: rules.length > 0 ? rules : current.ingressRules,
      labels: objToKv(obj.metadata?.labels),
      annotations: objToKv(obj.metadata?.annotations),
    };
  },

  pvcs: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    storageSize: obj.spec?.resources?.requests?.storage ?? '1Gi',
    accessMode: obj.spec?.accessModes?.[0] ?? 'ReadWriteOnce',
    storageClassName: obj.spec?.storageClassName ?? '',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  pods: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    restartPolicy: obj.spec?.restartPolicy ?? 'Always',
    containers: (obj.spec?.containers ?? []).length > 0
      ? (obj.spec.containers).map(parseContainer)
      : [createDefaultContainer()],
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
    nodeSelector: objToKv(obj.spec?.nodeSelector),
  }),

  horizontalpodautoscalers: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    scaleTargetKind: obj.spec?.scaleTargetRef?.kind ?? 'Deployment',
    scaleTargetName: obj.spec?.scaleTargetRef?.name ?? '',
    minReplicas: obj.spec?.minReplicas ?? 1,
    maxReplicas: obj.spec?.maxReplicas ?? 10,
    targetCpuUtilization: obj.spec?.metrics?.[0]?.resource?.target?.averageUtilization ?? 80,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  poddisruptionbudgets: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    minAvailable: String(obj.spec?.minAvailable ?? '1'),
    selector: objToKv(obj.spec?.selector?.matchLabels),
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  networkpolicies: (obj, current) => {
    const types = obj.spec?.policyTypes ?? ['Ingress'];
    const policyTypes = (types.includes('Ingress') && types.includes('Egress'))
      ? 'Both' : (types[0] ?? 'Ingress');
    return {
      ...createDefaultFormModel(),
      name: obj.metadata?.name ?? current.name,
      netpolPodSelector: objToKv(obj.spec?.podSelector?.matchLabels),
      policyTypes,
      labels: objToKv(obj.metadata?.labels),
      annotations: objToKv(obj.metadata?.annotations),
    };
  },

  resourcequotas: (obj, current) => {
    const hard = obj.spec?.hard ?? {};
    return {
      ...createDefaultFormModel(),
      name: obj.metadata?.name ?? current.name,
      quotaHardPods: hard.pods ?? '',
      quotaHardCpuRequests: hard['requests.cpu'] ?? '',
      quotaHardMemRequests: hard['requests.memory'] ?? '',
      quotaHardCpuLimits: hard['limits.cpu'] ?? '',
      quotaHardMemLimits: hard['limits.memory'] ?? '',
      labels: objToKv(obj.metadata?.labels),
      annotations: objToKv(obj.metadata?.annotations),
    };
  },

  limitranges: (obj, current) => {
    const limit = obj.spec?.limits?.[0] ?? {};
    return {
      ...createDefaultFormModel(),
      name: obj.metadata?.name ?? current.name,
      limitDefaultCpu: limit.default?.cpu ?? '',
      limitDefaultMem: limit.default?.memory ?? '',
      limitDefaultRequestCpu: limit.defaultRequest?.cpu ?? '',
      limitDefaultRequestMem: limit.defaultRequest?.memory ?? '',
      labels: objToKv(obj.metadata?.labels),
      annotations: objToKv(obj.metadata?.annotations),
    };
  },

  serviceaccounts: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  persistentvolumes: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    storageSize: obj.spec?.capacity?.storage ?? '10Gi',
    accessMode: obj.spec?.accessModes?.[0] ?? 'ReadWriteOnce',
    reclaimPolicy: obj.spec?.persistentVolumeReclaimPolicy ?? 'Retain',
    hostPath: obj.spec?.hostPath?.path ?? '',
    storageClassName: obj.spec?.storageClassName ?? '',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  storageclasses: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    provisioner: obj.provisioner ?? '',
    volumeBindingMode: obj.volumeBindingMode ?? 'WaitForFirstConsumer',
    reclaimPolicy: obj.reclaimPolicy ?? 'Delete',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  roles: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    ...parseRbacRuleFields(obj.rules),
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  clusterroles: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    ...parseRbacRuleFields(obj.rules),
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  rolebindings: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    roleRefKind: obj.roleRef?.kind ?? 'Role',
    roleRefName: obj.roleRef?.name ?? '',
    subjectKind: obj.subjects?.[0]?.kind ?? 'ServiceAccount',
    subjectName: obj.subjects?.[0]?.name ?? '',
    subjectNamespace: obj.subjects?.[0]?.namespace ?? '',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),

  clusterrolebindings: (obj, current) => ({
    ...createDefaultFormModel(),
    name: obj.metadata?.name ?? current.name,
    roleRefName: obj.roleRef?.name ?? '',
    subjectKind: obj.subjects?.[0]?.kind ?? 'ServiceAccount',
    subjectName: obj.subjects?.[0]?.name ?? '',
    subjectNamespace: obj.subjects?.[0]?.namespace ?? '',
    labels: objToKv(obj.metadata?.labels),
    annotations: objToKv(obj.metadata?.annotations),
  }),
};
