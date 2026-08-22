/**
 * Zod → JSON Schema, in the dialect providers actually accept.
 *
 * Zod 4 can emit JSON Schema directly. Two adjustments are needed for provider
 * compatibility: `$ref`s must be inlined (several providers reject them), and
 * unrepresentable constructs must degrade to `any` rather than throwing — a
 * schema we cannot fully express is still better than no structured output.
 */
import { z } from 'zod';

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'output',
    unrepresentable: 'any',
    cycles: 'ref',
    reused: 'inline',
  }) as Record<string, unknown>;

  // Providers differ on `$schema`; none require it.
  delete generated.$schema;
  return generated;
}

/**
 * Compact JSON-Schema rendering for prompts, used when a provider has no
 * structured-output mode and the shape has to be described in the prompt.
 */
export function describeSchemaForPrompt(schema: z.ZodType): string {
  return JSON.stringify(toJsonSchema(schema), null, 1);
}
