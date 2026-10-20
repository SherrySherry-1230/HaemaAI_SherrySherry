// @editedBy SherrySherry 2026-10-20
/** 저장된 자기소개. text는 공백과 줄바꿈을 포함한 원문이다. */
export interface Introduction {
  text: string;
  displayName: string;
  revision: number;
  updatedAt: string | null;
}

export const MAX_INTRODUCTION_TEXT_BYTES = 1024 * 1024;
export const MAX_DISPLAY_NAME_CODE_POINTS = 512;

export class IntroductionStoreError extends Error {
  readonly code: 'invalid' | 'conflict' | 'locked' | 'unavailable' | 'corrupt';

  constructor(code: IntroductionStoreError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntroductionStoreError';
    this.code = code;
  }
}

export function emptyIntroduction(): Introduction {
  return { text: '', displayName: '사용자', revision: 0, updatedAt: null };
}

export function validateIntroductionOwnerId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512
      || value === '.' || value === '..' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new IntroductionStoreError('invalid', 'Introduction ownerId must be a valid non-empty identifier');
  }
}

export function validateIntroductionText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()
      || Buffer.byteLength(value, 'utf8') > MAX_INTRODUCTION_TEXT_BYTES) {
    throw new IntroductionStoreError('invalid', 'Introduction text must be non-empty and at most 1 MiB in UTF-8');
  }
}

export function validateDisplayName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value
      || Array.from(value).length > MAX_DISPLAY_NAME_CODE_POINTS
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(value)) {
    throw new IntroductionStoreError('invalid', 'Introduction displayName must be one valid string');
  }
}

export function validateIntroductionRevision(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IntroductionStoreError('invalid', 'Introduction revision must be a non-negative safe integer');
  }
}
