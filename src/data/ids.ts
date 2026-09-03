import { randomUUID } from 'node:crypto';

/** Short prefixed id for stored records. Not security-sensitive. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}
