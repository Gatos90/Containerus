import { ContainerRuntime } from './container.model';

export interface ContainerImage {
  id: string;
  name: string;
  tag: string;
  size: number;
  created?: string | null;
  repository?: string | null;
  runtime: ContainerRuntime;
  systemId: string;
  digest?: string | null;
  architecture?: string | null;
  os?: string | null;
}

export const getImageFullName = (image: ContainerImage): string => {
  if (!image.tag || image.tag === '<none>') {
    return image.name;
  }
  return `${image.name}:${image.tag}`;
};

export const getImageSizeHuman = (image: ContainerImage): string => {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (image.size >= GB) {
    return `${(image.size / GB).toFixed(2)} GB`;
  }
  if (image.size >= MB) {
    return `${(image.size / MB).toFixed(2)} MB`;
  }
  if (image.size >= KB) {
    return `${(image.size / KB).toFixed(2)} KB`;
  }
  return `${image.size} B`;
};
