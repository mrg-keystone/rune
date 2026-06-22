// Public surface of the artifact contract (WO-3 / closes G8).
export {
  ArtifactSchema,
  BindingSchema,
  CASE_STYLES,
  CodegenSchema,
  CodegenTemplateSchema,
  FOLLOWS,
  LintRuleSchema,
  ModifierSchema,
  ProfileSchema,
  RUNE_ELEMENT_SOURCES,
  TagSchema,
} from "./schema.ts";
export type {
  Artifact,
  Binding,
  Codegen,
  CodegenTemplate,
  LintRule,
  Modifier,
  Profile,
  Tag,
} from "./schema.ts";
export { loadArtifact, semanticErrors, validateArtifact } from "./validate.ts";
export type { ArtifactError, ValidationResult } from "./validate.ts";
