export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface LiquidInspectionResult {
  readonly original: string;
  readonly translatableSegments: readonly string[];
  readonly issues: readonly ValidationIssue[];
}
