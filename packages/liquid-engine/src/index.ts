export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface LiquidInspectionResult {
  readonly original: string;
  readonly translatableSegments: readonly string[];
  readonly issues: readonly ValidationIssue[];
}

const EMPTY_TEMPLATE_ISSUE: ValidationIssue = {
  code: "empty_template",
  message: "Template content must not be empty."
};

export function inspectLiquidTemplate(
  template: string
): LiquidInspectionResult {
  if (template.length === 0) {
    return {
      original: template,
      translatableSegments: [],
      issues: [EMPTY_TEMPLATE_ISSUE]
    };
  }

  return {
    original: template,
    translatableSegments: [],
    issues: []
  };
}
