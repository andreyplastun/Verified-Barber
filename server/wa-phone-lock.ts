// Shared with the global dispatcher so response mutations and sends contend on
// exactly the same PostgreSQL advisory-lock key.
export function hashPhoneToLockId(phone: string): number {
  let hash = 0x57410000;
  for (let i = 0; i < phone.length; i++) {
    hash = ((hash << 5) - hash + phone.charCodeAt(i)) | 0;
  }
  return hash;
}