/**
 * Form field definitions for K8s resource creation.
 * Pure data — no Angular dependencies.
 */

// ============================================================================
// Type definitions
// ============================================================================

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'textarea'
  | 'toggle'
  | 'key-value'
  | 'port-list'
  | 'env-list'
  | 'container-list'
  | 'ingress-rules';

export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  helpText?: string;
  options?: { value: string; label: string }[];
  defaultValue?: any;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    patternMessage?: string;
  };
}

export interface FormSectionDef {
  id: string;
  title: string;
  advanced?: boolean;
  fields: FormFieldDef[];
}

export interface ResourceFormDef {
  resourceType: string;
  apiVersion: string;
  kind: string;
  sections: FormSectionDef[];
}

// ============================================================================
// Form model types (runtime state)
// ============================================================================

export interface ContainerPortModel {
  containerPort: number;
  protocol: string;
}

export interface EnvVarModel {
  name: string;
  value: string;
}

export interface ContainerModel {
  name: string;
  image: string;
  ports: ContainerPortModel[];
  env: EnvVarModel[];
  command: string;
  cpuRequest: string;
  cpuLimit: string;
  memRequest: string;
  memLimit: string;
}

export interface ServicePortModel {
  name: string;
  port: number;
  targetPort: number;
  protocol: string;
  nodePort?: number;
}

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface IngressRuleModel {
  host: string;
  path: string;
  pathType: string;
  serviceName: string;
  servicePort: number;
}

export interface RbacRuleModel {
  apiGroups: string;
  resources: string;
  verbs: string;
}

export interface NetworkPolicyRuleModel {
  podSelectorKey: string;
  podSelectorValue: string;
  port: number;
  protocol: string;
}

export interface FormModel {
  name: string;
  replicas: number;
  containers: ContainerModel[];
  labels: KeyValuePair[];
  annotations: KeyValuePair[];
  // Service
  serviceType: string;
  selector: KeyValuePair[];
  ports: ServicePortModel[];
  // ConfigMap/Secret
  data: KeyValuePair[];
  secretType: string;
  // CronJob/Job
  schedule: string;
  concurrencyPolicy: string;
  restartPolicy: string;
  backoffLimit: number;
  // PVC / PV
  storageSize: string;
  storageClassName: string;
  accessMode: string;
  // PV specific
  reclaimPolicy: string;
  hostPath: string;
  // Ingress
  ingressRules: IngressRuleModel[];
  // StatefulSet
  serviceName: string;
  // Strategy
  strategyType: string;
  maxUnavailable: string;
  maxSurge: string;
  nodeSelector: KeyValuePair[];
  // HPA
  scaleTargetKind: string;
  scaleTargetName: string;
  minReplicas: number;
  maxReplicas: number;
  targetCpuUtilization: number;
  // PDB
  minAvailable: string;
  // NetworkPolicy
  policyTypes: string;
  netpolPodSelector: KeyValuePair[];
  netpolIngressRules: NetworkPolicyRuleModel[];
  // ResourceQuota
  quotaHardPods: string;
  quotaHardCpuRequests: string;
  quotaHardMemRequests: string;
  quotaHardCpuLimits: string;
  quotaHardMemLimits: string;
  // LimitRange
  limitDefaultCpu: string;
  limitDefaultMem: string;
  limitDefaultRequestCpu: string;
  limitDefaultRequestMem: string;
  // StorageClass
  provisioner: string;
  volumeBindingMode: string;
  // RBAC
  rbacApiGroups: string;
  rbacResources: string;
  rbacVerbs: string;
  roleRefKind: string;
  roleRefName: string;
  subjectKind: string;
  subjectName: string;
  subjectNamespace: string;
}

export function createDefaultFormModel(): FormModel {
  return {
    name: '',
    replicas: 1,
    containers: [createDefaultContainer()],
    labels: [],
    annotations: [],
    serviceType: 'ClusterIP',
    selector: [{ key: 'app', value: '' }],
    ports: [{ name: '', port: 80, targetPort: 80, protocol: 'TCP' }],
    data: [{ key: '', value: '' }],
    secretType: 'Opaque',
    schedule: '*/5 * * * *',
    concurrencyPolicy: 'Allow',
    restartPolicy: 'Never',
    backoffLimit: 3,
    storageSize: '1Gi',
    storageClassName: '',
    accessMode: 'ReadWriteOnce',
    reclaimPolicy: 'Retain',
    hostPath: '/data/my-pv',
    ingressRules: [{ host: '', path: '/', pathType: 'Prefix', serviceName: '', servicePort: 80 }],
    serviceName: '',
    strategyType: 'RollingUpdate',
    maxUnavailable: '25%',
    maxSurge: '25%',
    nodeSelector: [],
    scaleTargetKind: 'Deployment',
    scaleTargetName: '',
    minReplicas: 1,
    maxReplicas: 10,
    targetCpuUtilization: 80,
    minAvailable: '1',
    policyTypes: 'Ingress',
    netpolPodSelector: [{ key: 'app', value: '' }],
    netpolIngressRules: [{ podSelectorKey: '', podSelectorValue: '', port: 80, protocol: 'TCP' }],
    quotaHardPods: '10',
    quotaHardCpuRequests: '4',
    quotaHardMemRequests: '8Gi',
    quotaHardCpuLimits: '8',
    quotaHardMemLimits: '16Gi',
    limitDefaultCpu: '500m',
    limitDefaultMem: '256Mi',
    limitDefaultRequestCpu: '100m',
    limitDefaultRequestMem: '128Mi',
    provisioner: 'kubernetes.io/no-provisioner',
    volumeBindingMode: 'WaitForFirstConsumer',
    rbacApiGroups: '""',
    rbacResources: 'pods',
    rbacVerbs: 'get, list, watch',
    roleRefKind: 'Role',
    roleRefName: '',
    subjectKind: 'ServiceAccount',
    subjectName: '',
    subjectNamespace: '',
  };
}

export function createDefaultContainer(): ContainerModel {
  return {
    name: 'main',
    image: '',
    ports: [{ containerPort: 80, protocol: 'TCP' }],
    env: [],
    command: '',
    cpuRequest: '',
    cpuLimit: '',
    memRequest: '',
    memLimit: '',
  };
}

// ============================================================================
// Registry
// ============================================================================

const RESOURCE_FORM_DEFS = new Map<string, ResourceFormDef>();

export function hasFormDef(resourceType: string): boolean {
  return RESOURCE_FORM_DEFS.has(resourceType);
}

export function getFormDef(resourceType: string): ResourceFormDef | undefined {
  return RESOURCE_FORM_DEFS.get(resourceType);
}

// ============================================================================
// Form definitions
// ============================================================================

// -- Deployment --
RESOURCE_FORM_DEFS.set('deployments', {
  resourceType: 'deployments',
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-deployment', required: true,
          validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
        },
        {
          key: 'replicas', label: 'Replicas', type: 'number',
          defaultValue: 1, validation: { min: 0, max: 100 },
        },
      ],
    },
    {
      id: 'containers',
      title: 'Containers',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value', helpText: 'Applied to deployment and pod template' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
    {
      id: 'strategy',
      title: 'Update Strategy',
      advanced: true,
      fields: [
        {
          key: 'strategyType', label: 'Strategy', type: 'select', defaultValue: 'RollingUpdate',
          options: [
            { value: 'RollingUpdate', label: 'Rolling Update' },
            { value: 'Recreate', label: 'Recreate' },
          ],
        },
        { key: 'maxUnavailable', label: 'Max Unavailable', type: 'text', placeholder: '25%', defaultValue: '25%' },
        { key: 'maxSurge', label: 'Max Surge', type: 'text', placeholder: '25%', defaultValue: '25%' },
      ],
    },
    {
      id: 'scheduling',
      title: 'Node Scheduling',
      advanced: true,
      fields: [
        { key: 'nodeSelector', label: 'Node Selector', type: 'key-value', helpText: 'Key-value pairs for node selection' },
      ],
    },
  ],
});

// -- StatefulSet --
RESOURCE_FORM_DEFS.set('statefulsets', {
  resourceType: 'statefulsets',
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-statefulset', required: true,
          validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
        },
        { key: 'replicas', label: 'Replicas', type: 'number', defaultValue: 1, validation: { min: 0, max: 100 } },
        {
          key: 'serviceName', label: 'Service Name', type: 'text',
          placeholder: 'my-statefulset', required: true,
          helpText: 'Headless service that governs this StatefulSet',
        },
      ],
    },
    {
      id: 'containers',
      title: 'Containers',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
    {
      id: 'scheduling',
      title: 'Node Scheduling',
      advanced: true,
      fields: [
        { key: 'nodeSelector', label: 'Node Selector', type: 'key-value' },
      ],
    },
  ],
});

// -- DaemonSet --
RESOURCE_FORM_DEFS.set('daemonsets', {
  resourceType: 'daemonsets',
  apiVersion: 'apps/v1',
  kind: 'DaemonSet',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-daemonset', required: true,
          validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
        },
      ],
    },
    {
      id: 'containers',
      title: 'Containers',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
    {
      id: 'scheduling',
      title: 'Node Scheduling',
      advanced: true,
      fields: [
        { key: 'nodeSelector', label: 'Node Selector', type: 'key-value' },
      ],
    },
  ],
});

// -- Job --
RESOURCE_FORM_DEFS.set('jobs', {
  resourceType: 'jobs',
  apiVersion: 'batch/v1',
  kind: 'Job',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-job', required: true,
        },
      ],
    },
    {
      id: 'containers',
      title: 'Containers',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'job-settings',
      title: 'Job Settings',
      advanced: true,
      fields: [
        {
          key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Never',
          options: [
            { value: 'Never', label: 'Never' },
            { value: 'OnFailure', label: 'On Failure' },
          ],
        },
        { key: 'backoffLimit', label: 'Backoff Limit', type: 'number', defaultValue: 3, validation: { min: 0, max: 100 } },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- CronJob --
RESOURCE_FORM_DEFS.set('cronjobs', {
  resourceType: 'cronjobs',
  apiVersion: 'batch/v1',
  kind: 'CronJob',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-cronjob', required: true,
        },
        {
          key: 'schedule', label: 'Schedule', type: 'text',
          placeholder: '*/5 * * * *', required: true,
          helpText: 'Cron expression (min hour dom month dow)',
        },
      ],
    },
    {
      id: 'containers',
      title: 'Job Container',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'job-settings',
      title: 'Job Settings',
      advanced: true,
      fields: [
        {
          key: 'concurrencyPolicy', label: 'Concurrency Policy', type: 'select', defaultValue: 'Allow',
          options: [
            { value: 'Allow', label: 'Allow' },
            { value: 'Forbid', label: 'Forbid' },
            { value: 'Replace', label: 'Replace' },
          ],
        },
        {
          key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Never',
          options: [
            { value: 'Never', label: 'Never' },
            { value: 'OnFailure', label: 'On Failure' },
          ],
        },
        { key: 'backoffLimit', label: 'Backoff Limit', type: 'number', defaultValue: 3, validation: { min: 0, max: 100 } },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- Service --
RESOURCE_FORM_DEFS.set('services', {
  resourceType: 'services',
  apiVersion: 'v1',
  kind: 'Service',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-service', required: true,
        },
        {
          key: 'serviceType', label: 'Type', type: 'select', defaultValue: 'ClusterIP',
          options: [
            { value: 'ClusterIP', label: 'ClusterIP' },
            { value: 'NodePort', label: 'NodePort' },
            { value: 'LoadBalancer', label: 'LoadBalancer' },
            { value: 'ExternalName', label: 'ExternalName' },
          ],
        },
      ],
    },
    {
      id: 'selector',
      title: 'Pod Selector',
      fields: [
        {
          key: 'selector', label: 'Selector', type: 'key-value', required: true,
          helpText: 'Labels to match target pods (e.g. app=my-app)',
        },
      ],
    },
    {
      id: 'ports',
      title: 'Ports',
      fields: [
        { key: 'ports', label: 'Service Ports', type: 'port-list' },
      ],
    },
    {
      id: 'advanced',
      title: 'Advanced',
      advanced: true,
      fields: [
        {
          key: 'sessionAffinity', label: 'Session Affinity', type: 'select', defaultValue: 'None',
          options: [{ value: 'None', label: 'None' }, { value: 'ClientIP', label: 'ClientIP' }],
        },
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- ConfigMap --
RESOURCE_FORM_DEFS.set('configmaps', {
  resourceType: 'configmaps',
  apiVersion: 'v1',
  kind: 'ConfigMap',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-configmap', required: true,
        },
      ],
    },
    {
      id: 'data',
      title: 'Data',
      fields: [
        { key: 'data', label: 'Configuration Data', type: 'key-value', helpText: 'Key-value pairs stored in the ConfigMap' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- Secret --
RESOURCE_FORM_DEFS.set('secrets', {
  resourceType: 'secrets',
  apiVersion: 'v1',
  kind: 'Secret',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-secret', required: true,
        },
        {
          key: 'secretType', label: 'Type', type: 'select', defaultValue: 'Opaque',
          options: [
            { value: 'Opaque', label: 'Opaque' },
            { value: 'kubernetes.io/dockerconfigjson', label: 'Docker Registry' },
            { value: 'kubernetes.io/tls', label: 'TLS' },
            { value: 'kubernetes.io/basic-auth', label: 'Basic Auth' },
            { value: 'kubernetes.io/ssh-auth', label: 'SSH Auth' },
          ],
        },
      ],
    },
    {
      id: 'data',
      title: 'Secret Data',
      fields: [
        { key: 'data', label: 'String Data', type: 'key-value', helpText: 'Values will be base64-encoded automatically' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- Ingress --
RESOURCE_FORM_DEFS.set('ingresses', {
  resourceType: 'ingresses',
  apiVersion: 'networking.k8s.io/v1',
  kind: 'Ingress',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-ingress', required: true,
        },
      ],
    },
    {
      id: 'rules',
      title: 'Routing Rules',
      fields: [
        { key: 'ingressRules', label: 'Rules', type: 'ingress-rules', helpText: 'Define host/path routing to backend services' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value', helpText: 'Used for ingress controller configuration' },
      ],
    },
  ],
});

// -- Pod --
RESOURCE_FORM_DEFS.set('pods', {
  resourceType: 'pods',
  apiVersion: 'v1',
  kind: 'Pod',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-pod', required: true,
          validation: { pattern: '^[a-z0-9][a-z0-9\\-]*[a-z0-9]$', patternMessage: 'Lowercase alphanumeric and hyphens only' },
        },
        {
          key: 'restartPolicy', label: 'Restart Policy', type: 'select', defaultValue: 'Always',
          options: [
            { value: 'Always', label: 'Always' },
            { value: 'OnFailure', label: 'On Failure' },
            { value: 'Never', label: 'Never' },
          ],
        },
      ],
    },
    {
      id: 'containers',
      title: 'Containers',
      fields: [
        { key: 'containers', label: 'Containers', type: 'container-list' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
    {
      id: 'scheduling',
      title: 'Node Scheduling',
      advanced: true,
      fields: [
        { key: 'nodeSelector', label: 'Node Selector', type: 'key-value', helpText: 'Key-value pairs for node selection' },
      ],
    },
  ],
});

// -- HorizontalPodAutoscaler --
RESOURCE_FORM_DEFS.set('horizontalpodautoscalers', {
  resourceType: 'horizontalpodautoscalers',
  apiVersion: 'autoscaling/v2',
  kind: 'HorizontalPodAutoscaler',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-hpa', required: true },
      ],
    },
    {
      id: 'target',
      title: 'Scale Target',
      fields: [
        {
          key: 'scaleTargetKind', label: 'Target Kind', type: 'select', defaultValue: 'Deployment',
          options: [
            { value: 'Deployment', label: 'Deployment' },
            { value: 'StatefulSet', label: 'StatefulSet' },
          ],
        },
        { key: 'scaleTargetName', label: 'Target Name', type: 'text', placeholder: 'my-deployment', required: true },
        { key: 'minReplicas', label: 'Min Replicas', type: 'number', defaultValue: 1, validation: { min: 1, max: 100 } },
        { key: 'maxReplicas', label: 'Max Replicas', type: 'number', defaultValue: 10, validation: { min: 1, max: 1000 } },
        {
          key: 'targetCpuUtilization', label: 'Target CPU Utilization (%)', type: 'number',
          defaultValue: 80, validation: { min: 1, max: 100 },
          helpText: 'Average CPU utilization across all pods',
        },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- PodDisruptionBudget --
RESOURCE_FORM_DEFS.set('poddisruptionbudgets', {
  resourceType: 'poddisruptionbudgets',
  apiVersion: 'policy/v1',
  kind: 'PodDisruptionBudget',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-pdb', required: true },
        {
          key: 'minAvailable', label: 'Min Available', type: 'text', placeholder: '1',
          helpText: 'Number or percentage (e.g. "1" or "50%") of pods that must remain available',
        },
      ],
    },
    {
      id: 'selector',
      title: 'Pod Selector',
      fields: [
        {
          key: 'selector', label: 'Match Labels', type: 'key-value', required: true,
          helpText: 'Labels to match target pods',
        },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- NetworkPolicy --
RESOURCE_FORM_DEFS.set('networkpolicies', {
  resourceType: 'networkpolicies',
  apiVersion: 'networking.k8s.io/v1',
  kind: 'NetworkPolicy',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-network-policy', required: true },
      ],
    },
    {
      id: 'podSelector',
      title: 'Pod Selector',
      fields: [
        {
          key: 'netpolPodSelector', label: 'Target Pods', type: 'key-value', required: true,
          helpText: 'Select pods this policy applies to (e.g. app=my-app)',
        },
      ],
    },
    {
      id: 'policyTypes',
      title: 'Policy Types',
      fields: [
        {
          key: 'policyTypes', label: 'Policy Type', type: 'select', defaultValue: 'Ingress',
          options: [
            { value: 'Ingress', label: 'Ingress only' },
            { value: 'Egress', label: 'Egress only' },
            { value: 'Both', label: 'Ingress + Egress' },
          ],
          helpText: 'Which traffic direction to control',
        },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- ResourceQuota --
RESOURCE_FORM_DEFS.set('resourcequotas', {
  resourceType: 'resourcequotas',
  apiVersion: 'v1',
  kind: 'ResourceQuota',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-quota', required: true },
      ],
    },
    {
      id: 'limits',
      title: 'Hard Limits',
      fields: [
        { key: 'quotaHardPods', label: 'Max Pods', type: 'text', placeholder: '10' },
        { key: 'quotaHardCpuRequests', label: 'CPU Requests', type: 'text', placeholder: '4', helpText: 'e.g. 4 (cores)' },
        { key: 'quotaHardMemRequests', label: 'Memory Requests', type: 'text', placeholder: '8Gi' },
        { key: 'quotaHardCpuLimits', label: 'CPU Limits', type: 'text', placeholder: '8' },
        { key: 'quotaHardMemLimits', label: 'Memory Limits', type: 'text', placeholder: '16Gi' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- LimitRange --
RESOURCE_FORM_DEFS.set('limitranges', {
  resourceType: 'limitranges',
  apiVersion: 'v1',
  kind: 'LimitRange',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-limits', required: true },
      ],
    },
    {
      id: 'defaults',
      title: 'Container Defaults',
      fields: [
        { key: 'limitDefaultCpu', label: 'Default CPU Limit', type: 'text', placeholder: '500m' },
        { key: 'limitDefaultMem', label: 'Default Memory Limit', type: 'text', placeholder: '256Mi' },
        { key: 'limitDefaultRequestCpu', label: 'Default CPU Request', type: 'text', placeholder: '100m' },
        { key: 'limitDefaultRequestMem', label: 'Default Memory Request', type: 'text', placeholder: '128Mi' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- ServiceAccount --
RESOURCE_FORM_DEFS.set('serviceaccounts', {
  resourceType: 'serviceaccounts',
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-service-account', required: true },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value', helpText: 'e.g. eks.amazonaws.com/role-arn for IAM roles' },
      ],
    },
  ],
});

// -- PersistentVolume (cluster-scoped) --
RESOURCE_FORM_DEFS.set('persistentvolumes', {
  resourceType: 'persistentvolumes',
  apiVersion: 'v1',
  kind: 'PersistentVolume',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-pv', required: true },
        { key: 'storageSize', label: 'Capacity', type: 'text', placeholder: '10Gi', required: true, helpText: 'e.g. 10Gi, 500Mi' },
        {
          key: 'accessMode', label: 'Access Mode', type: 'select', defaultValue: 'ReadWriteOnce',
          options: [
            { value: 'ReadWriteOnce', label: 'ReadWriteOnce' },
            { value: 'ReadOnlyMany', label: 'ReadOnlyMany' },
            { value: 'ReadWriteMany', label: 'ReadWriteMany' },
          ],
        },
        {
          key: 'reclaimPolicy', label: 'Reclaim Policy', type: 'select', defaultValue: 'Retain',
          options: [
            { value: 'Retain', label: 'Retain' },
            { value: 'Delete', label: 'Delete' },
            { value: 'Recycle', label: 'Recycle' },
          ],
        },
        { key: 'hostPath', label: 'Host Path', type: 'text', placeholder: '/data/my-pv', helpText: 'Path on the host node (for hostPath volumes)' },
        { key: 'storageClassName', label: 'Storage Class', type: 'text', placeholder: 'Leave empty for no class' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- StorageClass (cluster-scoped) --
RESOURCE_FORM_DEFS.set('storageclasses', {
  resourceType: 'storageclasses',
  apiVersion: 'storage.k8s.io/v1',
  kind: 'StorageClass',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-storage-class', required: true },
        { key: 'provisioner', label: 'Provisioner', type: 'text', placeholder: 'kubernetes.io/no-provisioner', required: true, helpText: 'e.g. kubernetes.io/aws-ebs, kubernetes.io/gce-pd' },
        {
          key: 'volumeBindingMode', label: 'Volume Binding Mode', type: 'select', defaultValue: 'WaitForFirstConsumer',
          options: [
            { value: 'WaitForFirstConsumer', label: 'WaitForFirstConsumer' },
            { value: 'Immediate', label: 'Immediate' },
          ],
        },
        {
          key: 'reclaimPolicy', label: 'Reclaim Policy', type: 'select', defaultValue: 'Delete',
          options: [
            { value: 'Delete', label: 'Delete' },
            { value: 'Retain', label: 'Retain' },
          ],
        },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- Role --
RESOURCE_FORM_DEFS.set('roles', {
  resourceType: 'roles',
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'Role',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-role', required: true },
      ],
    },
    {
      id: 'rules',
      title: 'Rules',
      fields: [
        { key: 'rbacApiGroups', label: 'API Groups', type: 'text', placeholder: '"" (core), apps, batch', helpText: 'Comma-separated. Use "" for core API group.' },
        { key: 'rbacResources', label: 'Resources', type: 'text', placeholder: 'pods, deployments, services', helpText: 'Comma-separated resource names' },
        { key: 'rbacVerbs', label: 'Verbs', type: 'text', placeholder: 'get, list, watch, create, delete', helpText: 'Comma-separated. Use * for all.' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- ClusterRole --
RESOURCE_FORM_DEFS.set('clusterroles', {
  resourceType: 'clusterroles',
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'ClusterRole',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-clusterrole', required: true },
      ],
    },
    {
      id: 'rules',
      title: 'Rules',
      fields: [
        { key: 'rbacApiGroups', label: 'API Groups', type: 'text', placeholder: '"" (core), apps, batch', helpText: 'Comma-separated. Use "" for core API group.' },
        { key: 'rbacResources', label: 'Resources', type: 'text', placeholder: 'pods, deployments, services', helpText: 'Comma-separated resource names' },
        { key: 'rbacVerbs', label: 'Verbs', type: 'text', placeholder: 'get, list, watch, create, delete', helpText: 'Comma-separated. Use * for all.' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- RoleBinding --
RESOURCE_FORM_DEFS.set('rolebindings', {
  resourceType: 'rolebindings',
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'RoleBinding',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-rolebinding', required: true },
      ],
    },
    {
      id: 'roleRef',
      title: 'Role Reference',
      fields: [
        {
          key: 'roleRefKind', label: 'Role Kind', type: 'select', defaultValue: 'Role',
          options: [
            { value: 'Role', label: 'Role' },
            { value: 'ClusterRole', label: 'ClusterRole' },
          ],
        },
        { key: 'roleRefName', label: 'Role Name', type: 'text', placeholder: 'my-role', required: true },
      ],
    },
    {
      id: 'subject',
      title: 'Subject',
      fields: [
        {
          key: 'subjectKind', label: 'Subject Kind', type: 'select', defaultValue: 'ServiceAccount',
          options: [
            { value: 'ServiceAccount', label: 'ServiceAccount' },
            { value: 'User', label: 'User' },
            { value: 'Group', label: 'Group' },
          ],
        },
        { key: 'subjectName', label: 'Subject Name', type: 'text', placeholder: 'my-service-account', required: true },
        { key: 'subjectNamespace', label: 'Subject Namespace', type: 'text', placeholder: 'default', helpText: 'Required for ServiceAccount subjects' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- ClusterRoleBinding --
RESOURCE_FORM_DEFS.set('clusterrolebindings', {
  resourceType: 'clusterrolebindings',
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'ClusterRoleBinding',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        { key: 'name', label: 'Name', type: 'text', placeholder: 'my-clusterrolebinding', required: true },
      ],
    },
    {
      id: 'roleRef',
      title: 'Role Reference',
      fields: [
        { key: 'roleRefName', label: 'ClusterRole Name', type: 'text', placeholder: 'my-clusterrole', required: true },
      ],
    },
    {
      id: 'subject',
      title: 'Subject',
      fields: [
        {
          key: 'subjectKind', label: 'Subject Kind', type: 'select', defaultValue: 'ServiceAccount',
          options: [
            { value: 'ServiceAccount', label: 'ServiceAccount' },
            { value: 'User', label: 'User' },
            { value: 'Group', label: 'Group' },
          ],
        },
        { key: 'subjectName', label: 'Subject Name', type: 'text', placeholder: 'my-service-account', required: true },
        { key: 'subjectNamespace', label: 'Subject Namespace', type: 'text', placeholder: 'default', helpText: 'Required for ServiceAccount subjects' },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});

// -- PVC --
RESOURCE_FORM_DEFS.set('pvcs', {
  resourceType: 'pvcs',
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  sections: [
    {
      id: 'basic',
      title: 'Basic Configuration',
      fields: [
        {
          key: 'name', label: 'Name', type: 'text',
          placeholder: 'my-pvc', required: true,
        },
        {
          key: 'storageSize', label: 'Storage Size', type: 'text',
          placeholder: '1Gi', required: true,
          helpText: 'e.g. 1Gi, 500Mi, 10Gi',
        },
        {
          key: 'accessMode', label: 'Access Mode', type: 'select', defaultValue: 'ReadWriteOnce',
          options: [
            { value: 'ReadWriteOnce', label: 'ReadWriteOnce' },
            { value: 'ReadOnlyMany', label: 'ReadOnlyMany' },
            { value: 'ReadWriteMany', label: 'ReadWriteMany' },
          ],
        },
        {
          key: 'storageClassName', label: 'Storage Class', type: 'text',
          placeholder: 'standard (leave empty for default)',
          helpText: 'Name of the StorageClass, leave empty for cluster default',
        },
      ],
    },
    {
      id: 'labels',
      title: 'Labels & Annotations',
      advanced: true,
      fields: [
        { key: 'labels', label: 'Labels', type: 'key-value' },
        { key: 'annotations', label: 'Annotations', type: 'key-value' },
      ],
    },
  ],
});
