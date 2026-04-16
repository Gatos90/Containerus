import { ResourceFormDef } from './k8s-resource-form.types';

export const NETWORKING_FORM_DEFS: ResourceFormDef[] = [
  {
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
  },
  {
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
  },
  {
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
  },
];
