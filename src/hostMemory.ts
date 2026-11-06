// @editedBy SherrySherry 2026-11-06
import type { StorageAdapter, JJumQuery } from './adapters/storageAdapter.ts';
import type { JJum } from './types/jjum.ts';
import type { JJumV5 } from './types/jjumV5.ts';
import { buildV5HostMemory } from './v5Memory.ts';

export interface HostMemoryScope {
  ownerId: string;
  storageId: string;
  hostId: string;
  /** 대화 영역의 출처다. 창작 대화의 모든 문장이 허구라는 판정을 뜻하지 않는다. */
  domain?: string;
  /** 서버가 확인한 이번 사용자 발화 근거만 전달한다. */
  evidenceIds?: readonly string[];
}

export interface HostMemoryAccess {
  version: 1;
  visibility: { scope: 'public' | 'private' } | { scope: 'restricted'; hostIds: string[] };
  usageByHost?: Record<string, 'background' | 'direct'>;
  knownByHost?: Record<string, { evidenceIds: string[] }>;
  domain?: string;
}

export interface HostMemoryProjection {
  jjumId: string;
  jjumName: string;
  summary: string;
  facts: { text: string }[];
  events: { date: number; summary: string }[];
  usage: 'background' | 'direct';
  alreadyKnownToHost: boolean;
  domain?: string;
}

export class HostMemoryAccessError extends Error {
  readonly code = 'HOST_MEMORY_ACCESS';
  constructor(message = 'The selected host cannot change this memory') {
    super(message);
    this.name = 'HostMemoryAccessError';
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const own = (value: Record<string, unknown> | undefined, key: string): unknown =>
  value && Object.hasOwn(value, key) ? value[key] : undefined;

function checkedScope(scope: HostMemoryScope): HostMemoryScope {
  if (!scope || ![scope.ownerId, scope.storageId, scope.hostId].every(identifier)
    || (scope.domain !== undefined && !identifier(scope.domain))
    || (scope.evidenceIds !== undefined && (!Array.isArray(scope.evidenceIds) || !scope.evidenceIds.every(identifier)))) {
    throw new HostMemoryAccessError('A valid owner, storage and host scope is required');
  }
  return structuredClone(scope);
}

/** v4에는 권한 기본값이 없다. 출처 서비스·이름·매너만으로 접근을 추정하지 않는다. */
export function readHostMemoryAccess(jjum: JJum): HostMemoryAccess | null {
  const value = jjum.context?.hostAccess;
  if (!object(value) || value.version !== 1 || !object(value.visibility)) return null;
  const visibility = value.visibility;
  if (!['private', 'restricted', 'public'].includes(String(visibility.scope))) return null;
  if (visibility.scope === 'restricted') {
    if (!Array.isArray(visibility.hostIds) || !visibility.hostIds.length || !visibility.hostIds.every(identifier)
      || new Set(visibility.hostIds).size !== visibility.hostIds.length) return null;
  } else if (Object.hasOwn(visibility, 'hostIds')) return null;
  if (value.domain !== undefined && !identifier(value.domain)) return null;
  if (value.usageByHost !== undefined && (!object(value.usageByHost)
    || Object.entries(value.usageByHost).some(([key, mode]) => !identifier(key) || !['background', 'direct'].includes(String(mode))))) return null;
  if (value.knownByHost !== undefined && (!object(value.knownByHost)
    || Object.entries(value.knownByHost).some(([key, evidence]) => !identifier(key) || !object(evidence)
      || !Array.isArray(evidence.evidenceIds) || !evidence.evidenceIds.length || !evidence.evidenceIds.every(identifier)))) return null;
  return structuredClone(value) as unknown as HostMemoryAccess;
}

function canRead(jjum: JJum, scope: HostMemoryScope): boolean {
  if (jjum.ownerId !== scope.ownerId || jjum.schemaVersion !== 4) return false;
  const access = readHostMemoryAccess(jjum);
  return !!access && (access.visibility.scope === 'public'
    || (access.visibility.scope === 'restricted' && access.visibility.hostIds.includes(scope.hostId)));
}

function canWrite(jjum: JJum, scope: HostMemoryScope): boolean {
  const access = readHostMemoryAccess(jjum);
  return canRead(jjum, scope) && access?.visibility.scope === 'restricted'
    && access.visibility.hostIds.length === 1 && access.visibility.hostIds[0] === scope.hostId
    && access.domain === scope.domain;
}

/** 호스트 입력에는 허용된 내용만 투영한다. 내부 이력·다른 쩜 참조·자유 확장은 전달하지 않는다. */
export function projectHostMemory(jjum: JJum | JJumV5, inputScope: HostMemoryScope): HostMemoryProjection | null {
  const scope = checkedScope(inputScope);
  if (jjum.ownerId !== scope.ownerId || jjum.status !== 'active') return null;
  if (jjum.schemaVersion === 5) {
    const projected = buildV5HostMemory(jjum as JJumV5, scope.hostId);
    if (!projected) return null;
    return {
      jjumId: projected.jjumId, jjumName: projected.jjumName, summary: projected.summary,
      facts: (projected.facts ?? []).map(({ text }) => ({ text })),
      events: (projected.events ?? []).map(({ date, summary }) => ({ date, summary })),
      usage: 'background', alreadyKnownToHost: projected.alreadyKnownToHost,
    };
  }
  const record = jjum as JJum;
  if (!canRead(record, scope)) return null;
  const access = readHostMemoryAccess(record)!;
  const evidence = own(access.knownByHost, scope.hostId) as { evidenceIds: string[] } | undefined;
  return {
    jjumId: record.jjumId, jjumName: record.jjumName, summary: record.summary,
    facts: record.facts.map(({ text }) => ({ text })),
    events: record.events.map(({ date, summary }) => ({ date, summary })),
    usage: own(access.usageByHost, scope.hostId) === 'direct' ? 'direct' : 'background',
    alreadyKnownToHost: !!evidence?.evidenceIds.length,
    ...(access.domain !== undefined ? { domain: access.domain } : {}),
  };
}

/**
 * 같은 쩜통 안에서 호스트별 읽기·쓰기 범위를 제한한다.
 * 공유 자료는 읽기 전용이며 새 비공개 사실이 공유 본문에 섞이지 않게 갱신 대상에서 제외한다.
 * 새 내용은 별도 쩜이 될 수 있다. 기존 자료를 자동 복제·재분류·마이그레이션하지 않는다.
 */
export function createHostMemoryStorage(base: StorageAdapter, inputScope: HostMemoryScope,
  options: { mode: 'read' | 'write' }): StorageAdapter {
  const scope = checkedScope(inputScope);
  if (!['read', 'write'].includes(options.mode)) throw new HostMemoryAccessError('Invalid host memory mode');
  const assertOwner = (ownerId: string) => {
    if (ownerId !== scope.ownerId) throw new HostMemoryAccessError('Memory owner does not match the selected conversation');
  };
  const visible = (jjum: JJum) => options.mode === 'write' ? canWrite(jjum, scope) : canRead(jjum, scope);
  const assertMutation = () => {
    if (options.mode !== 'write') throw new HostMemoryAccessError('Shared host memory views are read-only');
  };
  const getWritable = async (ownerId: string, jjumId: string) => {
    assertOwner(ownerId); assertMutation();
    const existing = await base.getJJum(ownerId, jjumId);
    if (!existing || !canWrite(existing, scope)) throw new HostMemoryAccessError();
    return existing;
  };
  const prepareSave = async (ownerId: string, jjum: JJum): Promise<JJum> => {
    assertOwner(ownerId); assertMutation();
    if (jjum.ownerId !== ownerId || jjum.schemaVersion !== 4) throw new HostMemoryAccessError();
    const existing = await base.getJJum(ownerId, jjum.jjumId);
    let access: HostMemoryAccess;
    if (existing) {
      if (!canWrite(existing, scope)) throw new HostMemoryAccessError();
      // 추출 결과나 호출자가 전달한 context로 기존 권한을 확장하지 않는다.
      access = readHostMemoryAccess(existing)!;
    } else {
      const evidenceIds = [...new Set(scope.evidenceIds ?? [])];
      access = { version: 1, visibility: { scope: 'restricted', hostIds: [scope.hostId] },
        usageByHost: { [scope.hostId]: 'direct' },
        ...(evidenceIds.length ? { knownByHost: { [scope.hostId]: { evidenceIds } } } : {}),
        ...(scope.domain !== undefined ? { domain: scope.domain } : {}) };
    }
    return { ...structuredClone(jjum), context: { ...structuredClone(existing?.context ?? {}),
      ...structuredClone(jjum.context ?? {}), hostAccess: access } };
  };
  const wrapper: StorageAdapter = {
    ...(base.coordinationScope ? { coordinationScope: base.coordinationScope } : {}),
    ...(base.withOwnerLock ? { withOwnerLock: async (ownerId, run) => {
      assertOwner(ownerId); return base.withOwnerLock!(ownerId, run);
    } } : {}),
    async getJJum(ownerId, jjumId) {
      assertOwner(ownerId);
      const jjum = await base.getJJum(ownerId, jjumId);
      return jjum && visible(jjum) ? structuredClone(jjum) : null;
    },
    async listJJums(ownerId, query?: JJumQuery) {
      assertOwner(ownerId);
      const jjums = (await base.listJJums(ownerId, query ? { ...query, limit: undefined } : undefined)).filter(visible);
      return structuredClone(query?.limit !== undefined && query.limit >= 0 ? jjums.slice(0, query.limit) : jjums);
    },
    async findByName(ownerId, name) { assertOwner(ownerId); return structuredClone((await base.findByName(ownerId, name)).filter(visible)); },
    async countJJums(ownerId, status) { return (await wrapper.listJJums(ownerId, { status })).length; },
    async putJJum(ownerId, jjum) { await base.putJJum(ownerId, await prepareSave(ownerId, jjum)); },
    async putJJums(ownerId, jjums) {
      const values: JJum[] = [];
      for (const jjum of jjums) values.push(await prepareSave(ownerId, jjum));
      await base.putJJums(ownerId, values);
    },
    async patchJJum(ownerId, jjumId, partial) {
      const current = await getWritable(ownerId, jjumId);
      if ((partial.ownerId !== undefined && partial.ownerId !== ownerId)
        || (partial.jjumId !== undefined && partial.jjumId !== jjumId)) throw new HostMemoryAccessError();
      await wrapper.putJJum(ownerId, { ...current, ...partial, ownerId, jjumId });
    },
    async deleteJJum() { throw new HostMemoryAccessError('Conversation processing cannot delete memories'); },
    async touchJJum(ownerId, jjumId, touchOptions) {
      await getWritable(ownerId, jjumId);
      for (const target of touchOptions?.seons ?? []) await getWritable(ownerId, target.targetId);
      return base.touchJJum(ownerId, jjumId, touchOptions);
    },
    async decayWeights() { throw new HostMemoryAccessError('Conversation processing cannot change other memory scopes'); },
    ...(base.compareAndSetLayaTag ? { compareAndSetLayaTag: async (ownerId, jjumId, snapshot, expected, next) => {
      await getWritable(ownerId, jjumId);
      return base.compareAndSetLayaTag!(ownerId, jjumId, snapshot, expected, next);
    } } : {}),
  };
  return wrapper;
}
