export type SyncDecision = 'equal' | 'download' | 'upload' | 'conflict';
/**
 * A baseline identifies the last confirmed identical local/cloud snapshot.
 * Never overwrite either copy when both have diverged.
 */
export function decideSync(localHash: string, remoteHash: string, baselineHash: string | null): SyncDecision {
  if (localHash === remoteHash) return 'equal';
  if (baselineHash === null) return 'conflict';
  const localChanged = localHash !== baselineHash;
  const remoteChanged = remoteHash !== baselineHash;
  if (localChanged && remoteChanged) return 'conflict';
  if (remoteChanged) return 'download';
  if (localChanged) return 'upload';
  return 'conflict';
}
