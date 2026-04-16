import { ResourceFormDef } from './k8s-resource-form.types';

export const CONFIG_FORM_DEFS: ResourceFormDef[] = [
  {
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
  },
  {
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
  },
];
