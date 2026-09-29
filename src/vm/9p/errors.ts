import {
  EACCES,
  EBUSY,
  EIO,
  ENOENT,
  ENOSPC,
  ENOTDIR,
  ENOTEMPTY,
} from './constants';

export class P9Error extends Error {
  constructor(readonly errno: number) {
    super(`9p error ${errno}`);
    this.name = 'P9Error';
  }
}

export function isDomError(
  error: unknown,
  ...names: string[]
): error is DOMException {
  return error instanceof DOMException && names.includes(error.name);
}

export async function ignoreNotFound(op: () => Promise<void>): Promise<void> {
  try {
    await op();
  } catch (error) {
    if (!isDomError(error, 'NotFoundError')) throw error;
  }
}

export function mapError(error: unknown): number {
  if (error instanceof P9Error) return error.errno;
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotFoundError':
        return ENOENT;
      case 'NotAllowedError':
        return EACCES;
      case 'TypeMismatchError':
        return ENOTDIR;
      case 'InvalidModificationError':
        return ENOTEMPTY;
      case 'NoModificationAllowedError':
        return EBUSY;
      case 'QuotaExceededError':
        return ENOSPC;
      case 'InvalidStateError':
        return EBUSY;
      default:
        return EIO;
    }
  }
  return EIO;
}
