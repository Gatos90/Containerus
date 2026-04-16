import { ResourceFormDef } from './k8s-resource-form.types';

export const CLUSTER_FORM_DEFS: ResourceFormDef[] = [
  {
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
  },
  {
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
  },
];
