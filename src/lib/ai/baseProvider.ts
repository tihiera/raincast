/**
 * Base AI provider — wires shared prompt templates to a thin ModelAdapter.
 *
 * Each concrete provider (Gemini, Anthropic, OpenAI) only implements ModelAdapter:
 *   - generate(system, user, json?) → string
 *   - generateStream(system, user, onChunk) → void
 *
 * All prompt construction, JSON parsing, and response validation lives here once.
 */

import type {
  AiProvider,
  AiProviderId,
  QueryDecision,
  GenerationPlan,
  BuildPlan,
  CheckpointFiles,
  EditPlan,
  FixPlan,
  FixPatch,
  ProposFixArgs,
  InvestigateErrorsArgs,
  InvestigationPlan,
  DiagnosticFixArgs,
} from "./types";
import type { LayoutArchetype } from "../generation/templates";
import {
  formatMessages,
  extractImages,
  parseJson,
  buildAnalyzeQuery,
  buildChatRespond,
  buildGeneratePlan,
  buildPlanBuild,
  buildGenerateCheckpointFiles,
  buildPlanEdits,
  buildApplyOneEdit,
  buildProposeFix,
  buildInvestigateErrors,
  buildDiagnosticFix,
  buildSuggestAppNames,
  buildGenerateLogos,
  buildRefineLogos,
  buildBriefStatus,
  buildShipErrorSummary,
  buildShipFix,
} from "./prompts";

/** Image data passed to the adapter — provider maps it to its SDK format. */
export interface AdapterImage {
  mime: string;
  base64: string;
}

// ── Transient error retry ──

/** Errors that are worth retrying (network issues, rate limits, server errors). */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("socket hang up") ||
    lower.includes("fetch failed") ||
    lower.includes("503") ||
    lower.includes("429") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("504") ||
    lower.includes("overloaded") ||
    lower.includes("rate limit")
  );
}

/** Retry an async operation with exponential backoff for transient errors. */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; label?: string } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 10;
  const label = opts.label ?? "operation";
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientError(err)) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000); // 1s, 2s, 4s, 8s
        console.warn(`[${label}] Attempt ${attempt}/${maxRetries} failed (transient): ${err instanceof Error ? err.message : err}. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}

/** Thin adapter that each provider implements — just the SDK call. */
export interface ModelAdapter {
  /** Send system+user prompt, get raw text back. */
  generate(system: string, user: string, opts?: { json?: boolean; model?: "fast" | "pro"; images?: AdapterImage[] }): Promise<string>;
  /** Streaming variant — calls onChunk with incremental text. */
  generateStream(system: string, user: string, onChunk: (text: string) => void, opts?: { model?: "fast" | "pro"; images?: AdapterImage[] }): Promise<void>;
  /** Generate an image from a text prompt. Returns base64 PNG. Optional — only some providers support this. */
  generateImage?(prompt: string): Promise<{ base64: string; mime: string } | null>;
}

/** Try to generate an image using Gemini, regardless of active provider. Returns null if unavailable. */
export async function borrowGeminiImageGen(
  prompt: string,
  referenceImage?: { base64: string; mime: string },
): Promise<{ base64: string; mime: string } | null> {
  try {
    // Dynamically import to avoid circular deps and check if Gemini key is available
    const { getGeminiApiKey } = await import("./settings");
    if (!getGeminiApiKey()) return null;
    const { getProviderById } = await import("./registry");
    const gemini = getProviderById("gemini");
    if (!gemini) return null;
    // Access the adapter's generateImage through the registry
    // Since we can't access the adapter directly, we use the Gemini SDK directly
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: getGeminiApiKey()! });

    // If we have a reference image, pass it as multimodal input for editing
    const contents = referenceImage
      ? [
          { text: prompt },
          { inlineData: { data: referenceImage.base64, mimeType: referenceImage.mime } },
        ]
      : prompt;

    const response = await client.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { base64: part.inlineData.data, mime: part.inlineData.mimeType || "image/png" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function createProvider(
  id: AiProviderId,
  label: string,
  supportsImages: boolean,
  adapter: ModelAdapter,
): AiProvider {
  return {
    id,
    label,
    supportsImages,

    // ── Query Analyzer ──
    async analyzeQuery({ messages, hasProject }): Promise<QueryDecision> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildAnalyzeQuery(conversation, hasProject);

      try {
        const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "fast", images });
        const parsed = parseJson<QueryDecision>(text);

        if (parsed && typeof parsed.intent === "string" && typeof parsed.message === "string") {
          return {
            intent: parsed.intent,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
            message: parsed.message,
            layoutArchetype: typeof parsed.layoutArchetype === "string" ? parsed.layoutArchetype as LayoutArchetype : undefined,
            needsBackend: typeof parsed.needsBackend === "boolean" ? parsed.needsBackend : undefined,
          };
        }

        return {
          intent: "chat", confidence: 0.1,
          summary: "",
          message: "I had trouble understanding that. Could you try again?",
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Unknown error";
        return {
          intent: "chat", confidence: 0,
          summary: "",
          message: `Something went wrong: ${detail}`,
        };
      }
    },

    // ── Chat Respond ──
    async chatRespond({ messages }): Promise<string> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildChatRespond(conversation);

      try {
        return await adapter.generate(prompt.system, prompt.user, { model: "fast", images });
      } catch (err) {
        return `Sorry, something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`;
      }
    },

    // ── Chat Respond (streaming) ──
    async chatRespondStream({ messages, onChunk }): Promise<void> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildChatRespond(conversation);

      try {
        await adapter.generateStream(prompt.system, prompt.user, onChunk, { model: "fast", images });
      } catch (err) {
        console.error("[chatRespondStream]", err);
        onChunk(`Sorry, something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },

    // ── Plan Generation ──
    async generatePlan({ messages, mode, scaffoldContext, protectedFiles, existingFiles, systemInfo }): Promise<GenerationPlan> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildGeneratePlan({ conversation, mode, scaffoldContext, protectedFiles, existingFiles, systemInfo });

      for (let attempt = 1; attempt <= 6; attempt++) {
        let text: string;
        try {
          text = await retryWithBackoff(
            () => adapter.generate(prompt.system, prompt.user, { json: true, model: "pro", images }),
            { label: "generatePlan" },
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[generatePlan] Network error (attempt ${attempt}/6): ${errMsg}`);
          if (attempt < 6) { await new Promise((r) => setTimeout(r, 2000)); continue; }
          throw new Error(`Network error during plan generation after ${attempt} attempts: ${errMsg}`);
        }

        const parsed = parseJson<GenerationPlan>(text);
        if (parsed && typeof parsed.filesTotal === "number" && Array.isArray(parsed.checkpoints)) {
          return parsed;
        }

        console.error(`[generatePlan] Attempt ${attempt}/6 returned unparseable response (${text.length} chars):`, text.slice(0, 500));
      }

      throw new Error("Could not parse generation plan from AI response. The app may be too complex — try breaking it into smaller features.");
    },

    // ── Plan Build (lightweight — no code) ──
    async planBuild({ messages, scaffoldContext, protectedFiles }): Promise<{ plan: BuildPlan; rawResponse: string }> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildPlanBuild({ conversation, scaffoldContext, protectedFiles });

      for (let attempt = 1; attempt <= 6; attempt++) {
        let text: string;
        try {
          text = await retryWithBackoff(
            () => adapter.generate(prompt.system, prompt.user, { json: true, model: "pro", images }),
            { label: "planBuild" },
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[planBuild] Network error (attempt ${attempt}/6): ${errMsg}`);
          if (attempt < 6) { await new Promise((r) => setTimeout(r, 2000)); continue; }
          throw new Error(`Network error during build planning after ${attempt} attempts: ${errMsg}`);
        }

        const parsed = parseJson<BuildPlan>(text);
        if (parsed && Array.isArray(parsed.checkpoints) && parsed.checkpoints.length > 0) {
          return { plan: parsed, rawResponse: text };
        }

        console.error(`[planBuild] Attempt ${attempt}/6 returned unparseable response (${text.length} chars):`, text.slice(0, 500));
      }

      throw new Error("Could not parse build plan from AI response after 6 attempts.");
    },

    // ── Generate Checkpoint Files (one checkpoint at a time) ──
    async generateCheckpointFiles({ checkpointLabel, files, scaffoldContext, protectedFiles, previousFiles, conversation, backendCommands, systemInfo }): Promise<{ files: Array<{ path: string; content: string }>; rawResponse: string }> {
      const prompt = buildGenerateCheckpointFiles({ checkpointLabel, files, scaffoldContext, protectedFiles, previousFiles, conversation, backendCommands, systemInfo });

      for (let attempt = 1; attempt <= 6; attempt++) {
        let text: string;
        try {
          text = await retryWithBackoff(
            () => adapter.generate(prompt.system, prompt.user, { json: true, model: "pro" }),
            { label: `generateCheckpointFiles:${checkpointLabel}` },
          );
        } catch (err) {
          // Network retry exhausted — report clearly
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[generateCheckpointFiles] Network error for "${checkpointLabel}" (attempt ${attempt}/6): ${errMsg}`);
          if (attempt < 6) {
            console.log(`[generateCheckpointFiles] Will retry full generation for "${checkpointLabel}"...`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`Network error generating "${checkpointLabel}" after ${attempt} attempts: ${errMsg}`);
        }

        const parsed = parseJson<CheckpointFiles>(text);

        if (parsed && Array.isArray(parsed.files) && parsed.files.length > 0) {
          return { files: parsed.files, rawResponse: text };
        }

        console.error(`[generateCheckpointFiles] Attempt ${attempt}/6 returned unparseable response for "${checkpointLabel}" (${text.length} chars):`, text.slice(0, 500));
        if (attempt < 6) {
          console.log(`[generateCheckpointFiles] Retrying "${checkpointLabel}"...`);
        }
      }

      throw new Error(`Could not generate files for checkpoint "${checkpointLabel}" after 6 attempts.`);
    },

    // ── Plan Edits ──
    async planEdits({ messages, existingFiles }): Promise<{ plan: EditPlan; rawResponse: string }> {
      const conversation = formatMessages(messages);
      const images = extractImages(messages);
      const prompt = buildPlanEdits(conversation, existingFiles);
      const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "pro", images });
      const parsed = parseJson<EditPlan>(text);

      if (parsed && typeof parsed.label === "string" && Array.isArray(parsed.tasks)) {
        return { plan: parsed, rawResponse: text };
      }

      console.error("[planEdits] Failed to parse response:", text.slice(0, 500));
      throw new Error("Could not parse edit plan from AI response.");
    },

    // ── Apply One Edit ──
    async applyOneEdit({ task, fileContent, allFiles, previousFailures }): Promise<{ patches: FixPatch[]; rawResponse: string }> {
      const prompt = buildApplyOneEdit({ task, fileContent, allFiles, previousFailures });
      const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "pro" });
      const parsed = parseJson<{ patches: FixPatch[] }>(text);

      if (parsed && Array.isArray(parsed.patches)) {
        const patches = parsed.patches.map(p => ({ ...p, path: task.file }));
        return { patches, rawResponse: text };
      }

      console.error("[applyOneEdit] Failed to parse response:", text.slice(0, 500));
      return { patches: [], rawResponse: text };
    },

    // ── Propose Fix (self-heal) ──
    async proposeFix(args: ProposFixArgs): Promise<{ plan: FixPlan; rawResponse: string }> {
      const prompt = buildProposeFix(args);

      try {
        const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "pro" });
        const parsed = parseJson<FixPlan>(text);

        if (parsed && typeof parsed.label === "string" && Array.isArray(parsed.patches)) {
          return { plan: parsed, rawResponse: text };
        }

        console.error("[proposeFix] Failed to parse response:", text.slice(0, 500));
        return { plan: { label: "", patches: [] }, rawResponse: text };
      } catch (err) {
        console.error("[proposeFix] Error:", err);
        return { plan: { label: "", patches: [] }, rawResponse: String(err) };
      }
    },

    // ── Investigate Errors (diagnostic-driven fix phase 1) ──
    async investigateErrors(args: InvestigateErrorsArgs): Promise<{ plan: InvestigationPlan; rawResponse: string }> {
      const prompt = buildInvestigateErrors(args);
      try {
        const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "fast" });
        const parsed = parseJson<InvestigationPlan>(text);

        if (parsed && typeof parsed.reasoning === "string" && Array.isArray(parsed.requests)) {
          return { plan: parsed, rawResponse: text };
        }

        console.error("[investigateErrors] Failed to parse response:", text.slice(0, 500));
        return { plan: { reasoning: "", requests: [] }, rawResponse: text };
      } catch (err) {
        console.error("[investigateErrors] Error:", err);
        return { plan: { reasoning: "", requests: [] }, rawResponse: String(err) };
      }
    },

    // ── Diagnostic Fix (diagnostic-driven fix phase 2) ──
    async diagnosticFix(args: DiagnosticFixArgs): Promise<{ plan: FixPlan; rawResponse: string }> {
      const prompt = buildDiagnosticFix(args);
      try {
        const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "pro" });
        const parsed = parseJson<FixPlan>(text);

        if (parsed && typeof parsed.label === "string" && Array.isArray(parsed.patches)) {
          return { plan: parsed, rawResponse: text };
        }

        console.error("[diagnosticFix] Failed to parse response:", text.slice(0, 500));
        return { plan: { label: "", patches: [] }, rawResponse: text };
      } catch (err) {
        console.error("[diagnosticFix] Error:", err);
        return { plan: { label: "", patches: [] }, rawResponse: String(err) };
      }
    },

    async suggestAppNames({ messages }): Promise<string[]> {
      const conversation = formatMessages(messages);
      const prompt = buildSuggestAppNames(conversation);

      try {
        const text = await adapter.generate(prompt.system, prompt.user, { model: "fast" });
        const parsed = JSON.parse(text.trim());
        if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === "string")) {
          return parsed.slice(0, 5);
        }
        return [];
      } catch {
        return [];
      }
    },

    async generateLogos({ messages, appName }): Promise<string[]> {
      const conversation = formatMessages(messages);

      // Try real image generation (Gemini) — generates 3 variants in parallel
      try {
        const prompts = [
          `App icon for "${appName}". Minimal, geometric, flat design with a bold symbol on a rounded-rect background. Clean, modern. No text. Output ONLY the icon itself — no desktop, no dock, no window chrome, no environment around it.`,
          `App icon for "${appName}". Vibrant gradient, iOS-style depth and lighting with a sleek symbol on a rounded-rect background. Modern, polished. No text. Output ONLY the icon itself — no desktop, no dock, no window chrome, no environment around it.`,
          `App icon for "${appName}". Bold, creative, abstract interpretation with unique shapes on a rounded-rect background. Eye-catching, artistic. No text. Output ONLY the icon itself — no desktop, no dock, no window chrome, no environment around it.`,
        ];

        const results = await Promise.all(
          prompts.map((p) => borrowGeminiImageGen(p))
        );

        const images = results.filter((r): r is { base64: string; mime: string } => r !== null);
        if (images.length > 0) {
          // Return as data URLs so the UI can display them directly
          return images.map((img) => `data:${img.mime};base64,${img.base64}`);
        }
      } catch {
        // Fall through to SVG fallback
      }

      // Fallback: generate SVG logos as text
      const prompt = buildGenerateLogos(conversation, appName);
      try {
        const text = await adapter.generate(prompt.system, prompt.user, { model: "pro" });
        const parsed = JSON.parse(text.trim());
        if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === "string" && (s as string).includes("<svg"))) {
          return parsed.slice(0, 3);
        }
        return [];
      } catch {
        return [];
      }
    },

    async refineLogos({ messages, appName, currentSvg, instructions }): Promise<string[]> {
      // Try real image generation for refinements — pass the current logo as reference
      try {
        // Extract reference image from data URL or SVG
        let refImage: { base64: string; mime: string } | undefined;
        if (currentSvg.startsWith("data:")) {
          const commaIdx = currentSvg.indexOf(",");
          const header = currentSvg.slice(0, commaIdx);
          const data = currentSvg.slice(commaIdx + 1);
          const mime = header.match(/data:(.*?);/)?.[1] || "image/png";
          refImage = { base64: data, mime };
        }

        const basePrompt = refImage
          ? `Edit this app icon for "${appName}": ${instructions}. Keep the overall style and shape, just apply the requested changes. Output ONLY the icon — no desktop chrome, window frames, dock, or environment.`
          : `App icon for "${appName}". ${instructions}. Modern, polished. No text. Rounded-rect background. Output ONLY the icon — no desktop, no dock, no window chrome, no environment.`;

        const results = await Promise.all([
          borrowGeminiImageGen(basePrompt, refImage),
          borrowGeminiImageGen(basePrompt + " Slight variation.", refImage),
          borrowGeminiImageGen(basePrompt + " Alternative interpretation.", refImage),
        ]);
        const images = results.filter((r): r is { base64: string; mime: string } => r !== null);
        if (images.length > 0) {
          return images.map((img) => `data:${img.mime};base64,${img.base64}`);
        }
      } catch {
        // Fall through to SVG fallback
      }

      // Fallback: SVG refinement
      const conversation = formatMessages(messages);
      const prompt = buildRefineLogos(conversation, appName, currentSvg, instructions);
      try {
        const text = await adapter.generate(prompt.system, prompt.user, { model: "pro" });
        const parsed = JSON.parse(text.trim());
        if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === "string" && (s as string).includes("<svg"))) {
          return parsed.slice(0, 3);
        }
        return [];
      } catch {
        return [];
      }
    },

    // ── Raw Generate ──
    async rawGenerate({ system, user, json, model, images }): Promise<string> {
      return adapter.generate(system, user, { json, model: model ?? "pro", images });
    },

    // ── Stream Brief Status ──
    async streamBriefStatus({ context, onChunk }): Promise<void> {
      const prompt = buildBriefStatus(context);
      // Let the error propagate so the caller can use its own clean fallback
      await adapter.generateStream(prompt.system, prompt.user, onChunk, { model: "fast" });
    },

    // ── Summarize Ship Error (fast model) ──
    async summarizeShipError(logs: string[]): Promise<string> {
      const prompt = buildShipErrorSummary(logs);
      try {
        return await adapter.generate(prompt.system, prompt.user, { model: "fast" });
      } catch {
        return logs.slice(-30).join("\n");
      }
    },

    // ── Propose Ship Fix (pro model) ──
    async proposeShipFix({ errorSummary, fileContents }): Promise<{ plan: FixPlan; rawResponse: string }> {
      const prompt = buildShipFix({ errorSummary, fileContents });
      try {
        const text = await adapter.generate(prompt.system, prompt.user, { json: true, model: "pro" });
        const parsed = parseJson<FixPlan>(text);
        if (parsed && typeof parsed.label === "string" && Array.isArray(parsed.patches)) {
          return { plan: parsed, rawResponse: text };
        }
        return { plan: { label: "", patches: [] }, rawResponse: text };
      } catch (err) {
        return { plan: { label: "", patches: [] }, rawResponse: String(err) };
      }
    },
  };
}
