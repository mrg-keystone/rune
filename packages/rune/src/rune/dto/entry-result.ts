import { z } from "#zod";

export const EntryResultSchema = z.object({
  path: z.string(),
  target: z.string(),
  rule: z.string(),
  violations: z.array(z.string()).min(1),
  suggestion: z.string().optional(),
});

export type ValidatedEntryResult = z.infer<typeof EntryResultSchema>;

export function validate(data: unknown): ValidatedEntryResult {
  return EntryResultSchema.parse(data);
}
