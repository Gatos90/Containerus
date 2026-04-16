import { down } from './compose';

export default async function globalTeardown(): Promise<void> {
  if (process.env.BACKEND_MODE_KEEP) return;
  down();
}
