export interface ManifestFile {
  path: string;
  hash: string;
}

export interface ManifestCheckpoint {
  id: string;
  label: string;
  files: ManifestFile[];
}

export interface GenerationManifest {
  genId: string;
  projectId: string;
  checkpoints: ManifestCheckpoint[];
}

export function createManifest(projectId: string, checkpoints: ManifestCheckpoint[]): GenerationManifest {
  return {
    genId: `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    checkpoints,
  };
}
