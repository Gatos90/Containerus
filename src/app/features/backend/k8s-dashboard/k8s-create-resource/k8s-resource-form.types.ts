/**
 * Type definitions for K8s resource form definitions and runtime form model.
 * Imported by category form files and by k8s-resource-form-defs.ts.
 */

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
  serviceType: string;
  selector: KeyValuePair[];
  ports: ServicePortModel[];
  data: KeyValuePair[];
  secretType: string;
  schedule: string;
  concurrencyPolicy: string;
  restartPolicy: string;
  backoffLimit: number;
  storageSize: string;
  storageClassName: string;
  accessMode: string;
  reclaimPolicy: string;
  hostPath: string;
  ingressRules: IngressRuleModel[];
  serviceName: string;
  strategyType: string;
  maxUnavailable: string;
  maxSurge: string;
  nodeSelector: KeyValuePair[];
  scaleTargetKind: string;
  scaleTargetName: string;
  minReplicas: number;
  maxReplicas: number;
  targetCpuUtilization: number;
  minAvailable: string;
  policyTypes: string;
  netpolPodSelector: KeyValuePair[];
  netpolIngressRules: NetworkPolicyRuleModel[];
  quotaHardPods: string;
  quotaHardCpuRequests: string;
  quotaHardMemRequests: string;
  quotaHardCpuLimits: string;
  quotaHardMemLimits: string;
  limitDefaultCpu: string;
  limitDefaultMem: string;
  limitDefaultRequestCpu: string;
  limitDefaultRequestMem: string;
  provisioner: string;
  volumeBindingMode: string;
  rbacApiGroups: string;
  rbacResources: string;
  rbacVerbs: string;
  roleRefKind: string;
  roleRefName: string;
  subjectKind: string;
  subjectName: string;
  subjectNamespace: string;
}
