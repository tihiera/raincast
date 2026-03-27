export type GenerationPhase =
  | "idle"
  | "planning"
  | "generating"
  | "staging"
  | "checkpoint"
  | "validating"
  | "investigating"
  | "fixing"
  | "ready"
  | "failed";

export interface GenerationError {
  title: string;
  detail?: string;
}

export interface ValidationLogs {
  stdout: string[];
  stderr: string[];
}

export interface GenerationStatus {
  phase: GenerationPhase;
  message?: string;
  filesDone?: number;
  filesTotal?: number;
  checkpointLabel?: string;
  error?: GenerationError;
  validationLogs?: ValidationLogs;
  rolledBack?: boolean;
  fixAttempt?: number;
  fixMaxAttempts?: number;
}

export const INITIAL_STATUS: GenerationStatus = { phase: "idle" };

export const PHASE_ORDER: GenerationPhase[] = [
  "planning",
  "generating",
  "staging",
  "checkpoint",
  "validating",
  "ready",
];

export const PHASE_LABELS: Record<GenerationPhase, string> = {
  idle: "Idle",
  planning: "Planning",
  generating: "Generating files",
  staging: "Staging",
  checkpoint: "Applying checkpoint",
  validating: "Validating",
  investigating: "Investigating errors",
  fixing: "Self-healing",
  ready: "Preview ready",
  failed: "Failed",
};
