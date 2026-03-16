import { tagLiquidTemplate } from "@braze-ai-translator/liquid-engine";
import type {
  BrazeTemplatePushRequest,
  BrazeTemplatePushResult,
  BrazeTemplateSourceData,
  TemplateTranslateRequest
} from "@braze-ai-translator/schemas";

export interface BrazeTemplateTranslationsResponse {
  readonly translations: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface BrazeTemplateListItem {
  readonly email_template_id: string;
  readonly template_name: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly tags: readonly string[];
}

export interface BrazeTemplateListResult {
  readonly templates: readonly BrazeTemplateListItem[];
  readonly count: number;
}

export interface BrazeTemplateClient {
  fetchTemplateSourceData(
    request: TemplateTranslateRequest
  ): Promise<BrazeTemplateSourceData>;
  pushTranslations(
    request: BrazeTemplatePushRequest
  ): Promise<BrazeTemplatePushResult>;
}

interface BrazeEmailTemplateInfoResponse {
  readonly email_template_id: string;
  readonly template_name: string;
  readonly description?: string;
  readonly subject: string;
  readonly preheader?: string;
  readonly body?: string;
  readonly plaintext_body?: string;
  readonly should_inline_css?: boolean;
  readonly tags?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BrazeRestTemplateClientOptions {
  readonly now: () => string;
  readonly apiKey: string;
  readonly restApiBaseUrl: string;
  readonly sourceLocale?: string;
}

export class BrazeRestTemplateClient implements BrazeTemplateClient {
  private readonly taggedBodies = new Map<string, string>();
  private readonly sourceTextCache = new Map<string, Map<string, string>>();
  private readonly templateInfoCache = new Map<
    string,
    BrazeEmailTemplateInfoResponse
  >();

  constructor(private readonly options: BrazeRestTemplateClientOptions) {}

  async fetchTemplateSourceData(
    request: TemplateTranslateRequest
  ): Promise<BrazeTemplateSourceData> {
    const templateInfo = await this.getTemplateInfo(request.templateId);

    this.templateInfoCache.set(request.templateId, templateInfo);
    const body = templateInfo.body ?? "";

    if (body.trim().length === 0) {
      throw new Error(
        `Template "${request.templateId}" has no body content to translate.`
      );
    }

    const sourceLocale = this.options.sourceLocale ?? "und";
    const extractionId = `braze.template.${request.templateId}`;
    const now = this.options.now();

    const bodyResult = tagLiquidTemplate({
      rawContent: body,
      contentFieldType: "html",
      messageChannel: "email",
      contentFieldKey: "email.body_html",
      sourceLocale,
      extractionId,
      extractedAt: now,
      generatedAt: now
    });

    if (bodyResult.transformedContent !== null) {
      this.taggedBodies.set(request.templateId, bodyResult.transformedContent);
    }

    const entrySourceMap = new Map<string, string>();

    for (const entry of bodyResult.translationEntries) {
      entrySourceMap.set(entry.entryId, entry.sourceText);
    }

    this.sourceTextCache.set(request.templateId, entrySourceMap);

    if (
      bodyResult.translationEntries.length === 0 &&
      bodyResult.validationErrors.length === 0
    ) {
      throw new Error(
        `Template "${request.templateId}" has no translatable text segments in its body.`
      );
    }

    return {
      templateId: request.templateId,
      extractionId,
      sourceLocale,
      entries: bodyResult.translationEntries.map((entry) => ({
        entryId: entry.entryId,
        messageChannel: entry.messageChannel,
        contentFieldKey: entry.contentFieldKey,
        contentFieldType: entry.contentFieldType,
        sourceText: entry.sourceText,
        sourceTextChecksum: entry.sourceTextChecksum,
        sourceRange: entry.sourceRange,
        surroundingTextBefore: entry.surroundingTextBefore,
        surroundingTextAfter: entry.surroundingTextAfter,
        preservedLiquidBlocks: [...entry.preservedLiquidBlocks]
      })),
      existingTranslations: [],
      validationErrors: [...bodyResult.validationErrors],
      fetchedAt: now
    };
  }

  async pushTranslations(
    request: BrazeTemplatePushRequest
  ): Promise<BrazeTemplatePushResult> {
    const taggedBody = this.taggedBodies.get(request.templateId);

    if (taggedBody === undefined) {
      throw new Error(
        `No tagged template body cached for "${request.templateId}". ` +
          "Call fetchTemplateSourceData before pushTranslations."
      );
    }

    let targetTemplateId = request.templateId;
    let isDragAndDrop = false;

    try {
      await this.updateTemplate(request.templateId, { body: taggedBody });
    } catch (updateError) {
      isDragAndDrop =
        updateError instanceof Error &&
        updateError.message.includes("Drag-and-drop");

      if (!isDragAndDrop) {
        throw updateError;
      }

      const sourceInfo = this.templateInfoCache.get(request.templateId);
      const locales = [
        ...new Set(request.newTranslations.map((t) => t.targetLocale))
      ];
      const localeSuffix = locales.join(", ");
      const baseName =
        sourceInfo?.template_name ?? `Template ${request.templateId}`;

      const created = await this.createTemplate({
        templateName: `${baseName} [translated: ${localeSuffix}]`,
        subject: sourceInfo?.subject ?? "",
        body: taggedBody,
        preheader: sourceInfo?.preheader
      });

      targetTemplateId = created.email_template_id;
    }

    this.taggedBodies.delete(request.templateId);

    const entryIdToSourceText =
      this.sourceTextCache.get(request.templateId) ?? new Map<string, string>();

    this.sourceTextCache.delete(request.templateId);

    let sourceTranslationMap: Record<string, string> = {};

    try {
      sourceTranslationMap =
        await this.getTemplateSourceTranslations(targetTemplateId);
    } catch {
      // Source translations not available; fall back to entry IDs as keys
    }

    const brazeUuidToEntryId = buildBrazeUuidMapping(
      sourceTranslationMap,
      entryIdToSourceText,
      request.newTranslations.map((t) => t.entryId)
    );

    const localeMap = await this.buildLocaleNameToUuidMap(request.templateId);
    const translationsByLocale = groupTranslationsByLocale(
      request.newTranslations
    );

    const results: BrazeTemplatePushResult["results"] = [];
    let pushedCount = 0;

    for (const [localeName, entries] of translationsByLocale) {
      const localeUuid = localeMap.get(localeName.toLowerCase());

      if (localeUuid === undefined) {
        for (const entry of entries) {
          results.push({
            entryId: entry.entryId,
            targetLocale: entry.targetLocale,
            syncStatus: "skipped" as const,
            message: `No locale UUID found for "${localeName}" on the source template.`
          });
        }

        continue;
      }

      const translationMap: Record<string, string> = {};

      for (const entry of entries) {
        const brazeKey = brazeUuidToEntryId.get(entry.entryId) ?? entry.entryId;

        translationMap[brazeKey] = entry.translatedText;
      }

      try {
        await this.putTemplateTranslation(
          targetTemplateId,
          localeUuid,
          translationMap
        );

        for (const entry of entries) {
          results.push({
            entryId: entry.entryId,
            targetLocale: entry.targetLocale,
            syncStatus: "synced" as const,
            message: isDragAndDrop
              ? `Pushed to new template "${targetTemplateId}" via PUT translations API.`
              : "Pushed via PUT translations API."
          });
          pushedCount++;
        }
      } catch (putError) {
        const putMessage =
          putError instanceof Error ? putError.message : String(putError);

        for (const entry of entries) {
          results.push({
            entryId: entry.entryId,
            targetLocale: entry.targetLocale,
            syncStatus: "failed" as const,
            message: `PUT translations failed for ${localeName}: ${putMessage}`
          });
        }
      }
    }

    const totalEntries = request.newTranslations.length;
    let pushStatus: "success" | "partial" | "failed";

    if (pushedCount === totalEntries) {
      pushStatus = "success";
    } else if (pushedCount > 0) {
      pushStatus = "partial";
    } else {
      pushStatus = "failed";
    }

    return {
      templateId: targetTemplateId,
      pushStatus,
      pushedTranslationCount: pushedCount,
      results,
      validationErrors: [],
      completedAt: this.options.now()
    };
  }

  private async buildLocaleNameToUuidMap(
    templateId: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const response = (await this.getTemplateTranslations(templateId)) as {
        translations?: readonly {
          locale?: { uuid?: string; name?: string; locale_key?: string };
        }[];
      };

      for (const entry of response.translations ?? []) {
        const locale = entry.locale;

        if (locale?.uuid === undefined) {
          continue;
        }

        if (locale.name !== undefined) {
          map.set(locale.name.toLowerCase(), locale.uuid);
        }

        if (locale.locale_key !== undefined) {
          map.set(locale.locale_key.toLowerCase(), locale.uuid);
        }
      }
    } catch {
      // Locale discovery failed; translations will be skipped
    }

    return map;
  }

  async getTemplateSourceTranslations(
    templateId: string
  ): Promise<Record<string, string>> {
    const url = new URL(
      "/templates/email/translations/source/",
      this.options.restApiBaseUrl
    );
    url.searchParams.set("template_id", templateId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      }
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze GET /templates/email/translations/source/ returned ${response.status}: ${text}`
      );
    }

    const data = (await response.json()) as {
      translation_map?: Record<string, string>;
    };

    return data.translation_map ?? {};
  }

  async putTemplateTranslation(
    templateId: string,
    localeId: string,
    translationMap: Record<string, string>
  ): Promise<void> {
    const url = new URL(
      "/templates/email/translations/",
      this.options.restApiBaseUrl
    );

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        template_id: templateId,
        locale_id: localeId,
        translation_map: translationMap
      })
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze PUT /templates/email/translations/ returned ${response.status}: ${text}`
      );
    }
  }

  async getTemplateTranslations(
    templateId: string
  ): Promise<unknown> {
    const url = new URL(
      "/templates/email/translations/",
      this.options.restApiBaseUrl
    );
    url.searchParams.set("template_id", templateId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      }
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze GET /templates/email/translations/ returned ${response.status}: ${text}`
      );
    }

    return response.json();
  }

  async createTemplate(options: {
    readonly templateName: string;
    readonly subject: string;
    readonly body: string;
    readonly preheader?: string;
    readonly tags?: readonly string[];
  }): Promise<{ email_template_id: string }> {
    const url = new URL(
      "/templates/email/create",
      this.options.restApiBaseUrl
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        template_name: options.templateName,
        subject: options.subject,
        body: options.body,
        preheader: options.preheader ?? "",
        tags: options.tags ? [...options.tags] : []
      })
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze POST /templates/email/create returned ${response.status}: ${text}`
      );
    }

    return response.json() as Promise<{ email_template_id: string }>;
  }

  async listTemplates(
    limit = 100,
    offset = 0
  ): Promise<BrazeTemplateListResult> {
    const url = new URL(
      "/templates/email/list",
      this.options.restApiBaseUrl
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort_direction", "desc");

    if (offset > 0) {
      url.searchParams.set("offset", String(offset));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      }
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze GET /templates/email/list returned ${response.status}: ${text}`
      );
    }

    const data = (await response.json()) as {
      count: number;
      templates: BrazeTemplateListItem[];
    };

    return {
      count: data.count ?? 0,
      templates: (data.templates ?? []).map((t) => ({
        email_template_id: t.email_template_id,
        template_name: t.template_name,
        created_at: t.created_at,
        updated_at: t.updated_at,
        tags: t.tags ?? []
      }))
    };
  }

  private async getTemplateInfo(
    templateId: string
  ): Promise<BrazeEmailTemplateInfoResponse> {
    const url = new URL(
      "/templates/email/info",
      this.options.restApiBaseUrl
    );
    url.searchParams.set("email_template_id", templateId);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`
      }
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze GET /templates/email/info returned ${response.status}: ${text}`
      );
    }

    return response.json() as Promise<BrazeEmailTemplateInfoResponse>;
  }

  private async updateTemplate(
    templateId: string,
    update: { readonly body?: string; readonly subject?: string }
  ): Promise<void> {
    const url = new URL(
      "/templates/email/update",
      this.options.restApiBaseUrl
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email_template_id: templateId,
        ...update
      })
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Braze POST /templates/email/update returned ${response.status}: ${text}`
      );
    }
  }
}

function buildBrazeUuidMapping(
  sourceTranslationMap: Record<string, string>,
  entryIdToSourceText: Map<string, string>,
  entryIds: readonly string[]
): Map<string, string> {
  const entryIdToBrazeUuid = new Map<string, string>();
  const brazeEntries = Object.entries(sourceTranslationMap);

  if (brazeEntries.length === 0) {
    return entryIdToBrazeUuid;
  }

  const usedUuids = new Set<string>();

  for (const entryId of entryIds) {
    if (entryIdToBrazeUuid.has(entryId)) {
      continue;
    }

    const sourceText = entryIdToSourceText.get(entryId);

    if (sourceText !== undefined) {
      const match = brazeEntries.find(
        ([uuid, text]) => !usedUuids.has(uuid) && text === sourceText
      );

      if (match !== undefined) {
        entryIdToBrazeUuid.set(entryId, match[0]);
        usedUuids.add(match[0]);
        continue;
      }
    }

    const match = brazeEntries.find(
      ([uuid, text]) =>
        !usedUuids.has(uuid) &&
        sourceText !== undefined &&
        normalizeForComparison(text) === normalizeForComparison(sourceText)
    );

    if (match !== undefined) {
      entryIdToBrazeUuid.set(entryId, match[0]);
      usedUuids.add(match[0]);
    }
  }

  return entryIdToBrazeUuid;
}

function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

interface TranslationEntryForGrouping {
  readonly entryId: string;
  readonly targetLocale: string;
  readonly translatedText: string;
}

function groupTranslationsByLocale(
  translations: readonly TranslationEntryForGrouping[]
): Map<string, TranslationEntryForGrouping[]> {
  const grouped = new Map<string, TranslationEntryForGrouping[]>();

  for (const translation of translations) {
    const existing = grouped.get(translation.targetLocale);

    if (existing !== undefined) {
      existing.push(translation);
    } else {
      grouped.set(translation.targetLocale, [translation]);
    }
  }

  return grouped;
}

export interface TodoBrazeTemplateClientOptions {
  readonly now: () => string;
  readonly apiKey?: string;
  readonly restApiBaseUrl?: string;
}

export class TodoBrazeTemplateClient implements BrazeTemplateClient {
  constructor(private readonly options: TodoBrazeTemplateClientOptions) {}

  async fetchTemplateSourceData(
    request: TemplateTranslateRequest
  ): Promise<BrazeTemplateSourceData> {
    void this.options;

    throw new Error(
      `Braze template fetch is not configured. Set BRAZE_REST_API_KEY and BRAZE_REST_API_URL to enable API access for templateId "${request.templateId}".`
    );
  }

  async pushTranslations(
    request: BrazeTemplatePushRequest
  ): Promise<BrazeTemplatePushResult> {
    void this.options;

    throw new Error(
      `Braze template push is not configured. Set BRAZE_REST_API_KEY and BRAZE_REST_API_URL to enable API access for templateId "${request.templateId}".`
    );
  }
}
