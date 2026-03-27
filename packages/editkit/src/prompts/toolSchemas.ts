// ---------------------------------------------------------------------------
// JSON schemas for structured LLM output
// ---------------------------------------------------------------------------

/** Schema for a PatchPlan JSON output. */
export const patchPlanJsonSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, description: "Unique plan identifier" },
    projectId: { type: "string" as const, description: "Optional project id" },
    ops: {
      type: "array" as const,
      items: {
        oneOf: [
          {
            type: "object" as const,
            properties: {
              kind: { type: "string" as const, const: "replaceBlock" },
              path: { type: "string" as const },
              old: { type: "string" as const },
              new: { type: "string" as const },
              replaceAll: { type: "boolean" as const },
            },
            required: ["kind", "path", "old", "new"],
          },
          {
            type: "object" as const,
            properties: {
              kind: { type: "string" as const, const: "writeFile" },
              path: { type: "string" as const },
              content: { type: "string" as const },
              create: { type: "boolean" as const },
            },
            required: ["kind", "path", "content"],
          },
          {
            type: "object" as const,
            properties: {
              kind: { type: "string" as const, const: "deleteFile" },
              path: { type: "string" as const },
            },
            required: ["kind", "path"],
          },
          {
            type: "object" as const,
            properties: {
              kind: { type: "string" as const, const: "mkdir" },
              path: { type: "string" as const },
            },
            required: ["kind", "path"],
          },
        ],
      },
    },
  },
  required: ["ops"],
}

/** Description of the RAIN_EDIT block text format (for system prompts). */
export const patchBlocksFormatDescription = `\
RAIN_EDIT block format:

>>>RAIN_EDIT path="<relative-path>" kind="replaceBlock" replaceAll="false"
>>>OLD
<exact text to find>
>>>NEW
<replacement text>
>>>END

For writing new files:
>>>RAIN_EDIT path="<relative-path>" kind="writeFile" create="true"
>>>CONTENT
<file content>
>>>END

For deleting files:
>>>RAIN_EDIT path="<relative-path>" kind="deleteFile"
>>>END

For creating directories:
>>>RAIN_EDIT path="<relative-path>" kind="mkdir"
>>>END

Multiple blocks can appear in a single response. Use replaceBlock for surgical edits. Only use writeFile when creating a new file or rewriting a file entirely.`
