// @editedBy SherrySherry 2026-11-19
/** Stable host identifiers keep existing conversations and access grants attached to their host. */
export const consoleHosts = [
  { id: 'friend', name: '친구친구이야기해,마' },
  { id: 'schedule', name: '일정기억해,마' },
  { id: 'mindfulness', name: '마음챙김해,마' },
  { id: 'diet', name: '다이어트해,마' },
  { id: 'creative', name: '창작해,마' },
  { id: 'pet', name: '키워달라해마해,마' },
] as const;
export type HostId = typeof consoleHosts[number]['id'];
