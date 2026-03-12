import { z } from "zod";

export const ConceptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  is_core: z.boolean().default(false),
  target_tier: z.enum(["DWD", "DWS", "ADS"]),
});

export const ModuleSchema = z.object({
  title: z.string().min(1),
  concepts: z.array(ConceptSchema).min(1),
});

export const ConceptMapSchema = z.object({
  modules: z.array(ModuleSchema).min(1),
});

export type ConceptMap = z.infer<typeof ConceptMapSchema>;
