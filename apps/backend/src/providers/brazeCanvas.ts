export interface BrazeCanvasClientOptions {
  readonly apiKey: string;
  readonly restApiBaseUrl: string;
}

export interface CanvasMessageVariation {
  readonly messageVariationId: string;
  readonly channel: string;
  readonly name?: string;
  readonly hasTranslatableContent?: boolean | null;
}

export interface CanvasStep {
  readonly stepId: string;
  readonly stepName: string;
  readonly type: string;
  readonly channels: readonly string[];
  readonly messages: readonly CanvasMessageVariation[];
}

export interface CanvasDetailsResponse {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  readonly draft: boolean;
  readonly archived: boolean;
  readonly steps: readonly CanvasStep[];
}

export interface TranslationLocale {
  readonly uuid: string;
  readonly name: string;
  readonly country: string | null;
  readonly language: string;
  readonly localeKey: string;
}

export interface StepTranslationEntry {
  readonly translationMap: Record<string, string>;
  readonly locale: TranslationLocale;
}

export interface StepTranslationsResponse {
  readonly translations: readonly StepTranslationEntry[];
}

export interface CanvasListItem {
  readonly id: string;
  readonly name: string;
  readonly lastEdited: string;
  readonly tags: readonly string[];
}

export type CanvasNameResolution =
  | {
      readonly status: "matched";
      readonly canvasId: string;
      readonly canvas: CanvasListItem;
    }
  | {
      readonly status: "not_found";
    }
  | {
      readonly status: "ambiguous";
      readonly matches: readonly CanvasListItem[];
    };

export class BrazeCanvasClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: BrazeCanvasClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.restApiBaseUrl.replace(/\/+$/, "");
  }

  async listCanvases(page = 0): Promise<readonly CanvasListItem[]> {
    const url = new URL(`${this.baseUrl}/canvas/list`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("include_archived", "false");
    url.searchParams.set("sort_direction", "desc");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.authHeaders()
    });

    const body = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Braze GET /canvas/list returned ${response.status}: ${JSON.stringify(body)}`
      );
    }

    const rawCanvases = Array.isArray(body.canvases) ? body.canvases : [];
    return rawCanvases.map(parseCanvasListItem);
  }

  async findCanvasByName(name: string): Promise<string | null> {
    const result = await this.resolveCanvasByName(name);
    return result.status === "matched" ? result.canvasId : null;
  }

  async resolveCanvasByName(name: string): Promise<CanvasNameResolution> {
    const normalizedName = normalizeCanvasName(name);
    let page = 0;
    const maxPages = 50;
    const matches: CanvasListItem[] = [];

    while (page < maxPages) {
      const canvases = await this.listCanvases(page);

      if (canvases.length === 0) {
        break;
      }

      for (const canvas of canvases) {
        if (normalizeCanvasName(canvas.name) === normalizedName) {
          matches.push(canvas);
          if (matches.length > 1) {
            return {
              status: "ambiguous",
              matches
            };
          }
        }
      }

      page += 1;
    }

    const [match] = matches;
    if (!match) {
      return { status: "not_found" };
    }

    return {
      status: "matched",
      canvasId: match.id,
      canvas: match
    };
  }

  async getCanvasDetails(canvasId: string): Promise<CanvasDetailsResponse> {
    const url = new URL(`${this.baseUrl}/canvas/details`);
    url.searchParams.set("canvas_id", canvasId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.authHeaders()
    });

    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Braze GET /canvas/details returned ${response.status}: ${JSON.stringify(body)}`
      );
    }

    return parseCanvasDetailsResponse(body);
  }

  async getStepTranslations(
    workflowId: string,
    stepId: string,
    messageVariationId: string
  ): Promise<StepTranslationsResponse> {
    const url = new URL(`${this.baseUrl}/canvas/translations`);
    url.searchParams.set("workflow_id", workflowId);
    url.searchParams.set("step_id", stepId);
    url.searchParams.set("message_variation_id", messageVariationId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.authHeaders()
    });

    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Braze GET /canvas/translations returned ${response.status}: ${JSON.stringify(body)}`
      );
    }

    return parseStepTranslationsResponse(body);
  }

  async getStepSourceTranslations(
    workflowId: string,
    stepId: string,
    messageVariationId: string
  ): Promise<Record<string, string>> {
    const url = new URL(`${this.baseUrl}/canvas/translations/source/`);
    url.searchParams.set("workflow_id", workflowId);
    url.searchParams.set("step_id", stepId);
    url.searchParams.set("message_variation_id", messageVariationId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.authHeaders()
    });

    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Braze GET /canvas/translations/source returned ${response.status}: ${JSON.stringify(body)}`
      );
    }

    const translations = body.translations as
      | Record<string, unknown>
      | undefined;
    const translationMap =
      (translations?.translation_map as Record<string, string> | undefined) ??
      {};

    return translationMap;
  }

  async putStepTranslation(
    workflowId: string,
    stepId: string,
    messageVariationId: string,
    localeId: string,
    translationMap: Record<string, string>
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/canvas/translations`, {
      method: "PUT",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        step_id: stepId,
        message_variation_id: messageVariationId,
        locale_id: localeId,
        translation_map: translationMap
      })
    });

    const body = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        `Braze PUT /canvas/translations returned ${response.status}: ${JSON.stringify(body)}`
      );
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }
}

function parseCanvasDetailsResponse(
  body: Record<string, unknown>
): CanvasDetailsResponse {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const workflowId =
    firstNonBlankString([
      body.workflow_id,
      body.workflowId,
      body.canvas_id,
      body.canvasId,
      body.api_id,
      body.apiId,
      body.uuid,
      body.id
    ]) ?? "";

  return {
    workflowId,
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    draft: body.draft === true,
    archived: body.archived === true,
    steps: steps.map(parseCanvasStep)
  };
}

function parseCanvasStep(raw: unknown): CanvasStep {
  const step = raw as Record<string, unknown>;
  const rawMessages = step.messages as Record<string, unknown> | undefined;
  const messages: CanvasMessageVariation[] = [];

  if (rawMessages !== null && rawMessages !== undefined) {
    for (const [variationId, variationData] of Object.entries(rawMessages)) {
      const variation = variationData as Record<string, unknown>;
      messages.push({
        messageVariationId: variationId,
        channel: typeof variation.channel === "string" ? variation.channel : "unknown",
        name: typeof variation.name === "string" ? variation.name : undefined,
        hasTranslatableContent:
          typeof variation.has_translatable_content === "boolean"
            ? variation.has_translatable_content
            : null
      });
    }
  }

  return {
    stepId: typeof step.id === "string" ? step.id : "",
    stepName: typeof step.name === "string" ? step.name : "",
    type: typeof step.type === "string" ? step.type : "",
    channels: Array.isArray(step.channels)
      ? step.channels.filter((c): c is string => typeof c === "string")
      : [],
    messages
  };
}

function parseStepTranslationsResponse(
  body: Record<string, unknown>
): StepTranslationsResponse {
  const translations = Array.isArray(body.translations)
    ? body.translations
    : [];

  return {
    translations: translations.map(parseStepTranslationEntry)
  };
}

function parseStepTranslationEntry(raw: unknown): StepTranslationEntry {
  const entry = raw as Record<string, unknown>;
  const translationMap =
    (entry.translation_map as Record<string, string> | undefined) ?? {};
  const locale = entry.locale as Record<string, unknown> | undefined;

  return {
    translationMap,
    locale: {
      uuid: typeof locale?.uuid === "string" ? locale.uuid : "",
      name: typeof locale?.name === "string" ? locale.name : "",
      country: typeof locale?.country === "string" ? locale.country : null,
      language: typeof locale?.language === "string" ? locale.language : "",
      localeKey:
        typeof locale?.locale_key === "string" ? locale.locale_key : ""
    }
  };
}

function parseCanvasListItem(raw: unknown): CanvasListItem {
  const item = raw as Record<string, unknown>;
  return {
    id: typeof item.id === "string" ? item.id : "",
    name: typeof item.name === "string" ? item.name : "",
    lastEdited:
      typeof item.last_edited === "string" ? item.last_edited : "",
    tags: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === "string")
      : []
  };
}

function normalizeCanvasName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function firstNonBlankString(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
}
