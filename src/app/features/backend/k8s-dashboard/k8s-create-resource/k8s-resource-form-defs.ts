/**
 * Form field definitions for K8s resource creation.
 * Pure data — no Angular dependencies.
 *
 * Form definitions are organized by category:
 *   k8s-workload-forms.ts   — Deployment, StatefulSet, DaemonSet, Job, CronJob, Pod, HPA, PDB
 *   k8s-networking-forms.ts — Service, Ingress, NetworkPolicy
 *   k8s-config-forms.ts     — ConfigMap, Secret
 *   k8s-storage-forms.ts    — PersistentVolume, StorageClass, PVC
 *   k8s-rbac-forms.ts       — ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding
 *   k8s-cluster-forms.ts    — ResourceQuota, LimitRange
 */

export type {
  FieldType,
  FormFieldDef,
  FormSectionDef,
  ResourceFormDef,
  ContainerPortModel,
  EnvVarModel,
  ContainerModel,
  ServicePortModel,
  KeyValuePair,
  IngressRuleModel,
  RbacRuleModel,
  NetworkPolicyRuleModel,
  FormModel,
} from './k8s-resource-form.types';

import { WORKLOAD_FORM_DEFS } from './k8s-workload-forms';
import { NETWORKING_FORM_DEFS } from './k8s-networking-forms';
import { CONFIG_FORM_DEFS } from './k8s-config-forms';
import { STORAGE_FORM_DEFS } from './k8s-storage-forms';
import { RBAC_FORM_DEFS } from './k8s-rbac-forms';
import { CLUSTER_FORM_DEFS } from './k8s-cluster-forms';
import type { ResourceFormDef, ContainerModel } from './k8s-resource-form.types';

const RESOURCE_FORM_DEFS = new Map<string, ResourceFormDef>();

for (const def of [
  ...WORKLOAD_FORM_DEFS,
  ...NETWORKING_FORM_DEFS,
  ...CONFIG_FORM_DEFS,
  ...STORAGE_FORM_DEFS,
  ...RBAC_FORM_DEFS,
  ...CLUSTER_FORM_DEFS,
]) {
  RESOURCE_FORM_DEFS.set(def.resourceType, def);
}

export function hasFormDef(resourceType: string): boolean {
  return RESOURCE_FORM_DEFS.has(resourceType);
}

export function getFormDef(resourceType: string): ResourceFormDef | undefined {
  return RESOURCE_FORM_DEFS.get(resourceType);
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

export function createDefaultFormModel() {
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
