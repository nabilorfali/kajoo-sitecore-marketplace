/**
 * Sitecore XM Cloud deployment helpers.
 *
 * Uses @sitecore-marketplace-sdk/xmc (proxied via the host — no direct HTTP
 * calls, no CORS, auth token injected automatically).
 *
 * Deploy flow:
 *   1. Create data template (+ section + fields) via Authoring GraphQL
 *   2. Create content item (datasource) via xmc.agent.contentCreateContentItem
 *   3. Add rendering to page layout via xmc.agent.pagesAddComponentOnPage
 *   4. Wire datasource via xmc.agent.pagesSetComponentDatasource
 *   5. Reload canvas
 */

import type { DeployManifest } from "./parse-manifest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkClient = any;

// ── Sitecore well-known template IDs ────────────────────────────────────────
const ID = {
  Template: "{AB86861A-6030-46C5-B394-E8F99E8B87DB}",
  TemplateSection: "{E269FBB5-3750-427A-9149-7AA950B49301}",
  TemplateField: "{455A3E98-A627-4B40-8035-E683A0331AC7}",
};

// ── Result ───────────────────────────────────────────────────────────────────

export interface DeployResult {
  templateId: string;
  templatePath: string;
  contentItemId: string;
  contentItemPath: string;
  addedToPage: boolean;
}

export interface DeployStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

// ── GraphQL proxy helper ─────────────────────────────────────────────────────

async function gql(
  sdk: SdkClient,
  query: string,
  variables: Record<string, unknown>,
) {
  return sdk.mutate("xmc.authoring.graphql", {
    params: { body: { query, variables } },
  });
}

async function createItem(
  sdk: SdkClient,
  opts: {
    name: string;
    templateId: string;
    parent: string;
    fields?: Array<{ name: string; value: string }>;
  },
): Promise<{ itemId: string; path: string }> {
  const fieldsClause = opts.fields?.length
    ? `fields: [${opts.fields.map((f) => `{ name: "${f.name}", value: "${f.value.replace(/"/g, '\\"')}" }`).join(", ")}]`
    : "";

  const result = await gql(
    sdk,
    `
    mutation CreateItem($name: String!, $templateId: String!, $parent: String!) {
      createItem(input: {
        name: $name
        templateId: $templateId
        parent: $parent
        language: "en"
        ${fieldsClause}
      }) {
        item { itemId path }
      }
    }
  `,
    { name: opts.name, templateId: opts.templateId, parent: opts.parent },
  );

  const item = result?.data?.createItem?.item;
  if (!item?.itemId) throw new Error(`Failed to create item: ${opts.name}`);
  return item;
}

// ── Main deploy function ─────────────────────────────────────────────────────

export async function deployToSitecore(
  sdk: SdkClient,
  manifest: DeployManifest,
  pageId: string,
  siteName: string,
  language = "en",
  onStep?: (steps: DeployStep[]) => void,
): Promise<DeployResult> {
  const steps: DeployStep[] = [
    { label: "Create data template", status: "pending" },
    { label: "Add template fields", status: "pending" },
    { label: "Create content item", status: "pending" },
    { label: "Add component to page", status: "pending" },
    { label: "Reload canvas", status: "pending" },
  ];

  const emit = (i: number, status: DeployStep["status"], detail?: string) => {
    steps[i] = { ...steps[i], status, detail };
    onStep?.([...steps]);
  };

  // ── Step 1: Create template ────────────────────────────────────────────────
  emit(0, "running");
  const templateParent = `/sitecore/templates/${manifest.helixLayer}/${manifest.module}`;
  const template = await createItem(sdk, {
    name: manifest.componentName,
    templateId: ID.Template,
    parent: templateParent,
  });
  emit(0, "done", template.path);

  // ── Step 2: Create section + fields ───────────────────────────────────────
  emit(1, "running");
  const section = await createItem(sdk, {
    name: "Data",
    templateId: ID.TemplateSection,
    parent: template.path,
  });

  for (const field of manifest.fields) {
    await createItem(sdk, {
      name: field.name,
      templateId: ID.TemplateField,
      parent: section.path,
      fields: [{ name: "Type", value: field.type }],
    });
  }
  emit(1, "done", `${manifest.fields.length} field(s) created`);

  // ── Step 3: Create content item (datasource) ───────────────────────────────
  emit(2, "running");
  const contentParent = `/sitecore/content/${siteName}/Data`;

  const contentResult = await sdk.mutate("xmc.agent.contentCreateContentItem", {
    body: {
      name: manifest.componentName,
      templateId: template.itemId,
      parentPath: contentParent,
      language,
      fields: manifest.fields
        .filter((f) => f.defaultValue)
        .map((f) => ({ name: f.name, value: f.defaultValue! })),
    },
  });

  const contentItemId =
    contentResult?.data?.id ??
    contentResult?.data?.itemId ??
    contentResult?.itemId;

  const contentItemPath =
    contentResult?.data?.path ?? `${contentParent}/${manifest.componentName}`;

  if (!contentItemId) throw new Error("Failed to create content item");
  emit(2, "done", contentItemPath);

  // ── Step 4: Add to page ───────────────────────────────────────────────────
  emit(3, "running");
  let addedToPage = false;

  if (manifest.renderingId && pageId) {
    const addResult = await sdk.mutate("xmc.agent.pagesAddComponentOnPage", {
      body: {
        pageId,
        renderingId: manifest.renderingId,
        placeholder: manifest.placeholder || "main",
        datasourceId: contentItemId,
        language,
      },
    });

    // Wire datasource separately if needed
    const componentUid = addResult?.data?.uid ?? addResult?.uid;
    if (componentUid) {
      await sdk.mutate("xmc.agent.pagesSetComponentDatasource", {
        body: { pageId, componentUid, datasourceId: contentItemId, language },
      });
    }
    addedToPage = true;
    emit(3, "done", `Added to placeholder: ${manifest.placeholder}`);
  } else {
    emit(3, "done", "Skipped — no renderingId (deploy code first)");
  }

  // ── Step 5: Reload canvas ─────────────────────────────────────────────────
  emit(4, "running");
  await sdk.mutate("pages.reloadCanvas");
  emit(4, "done");

  return {
    templateId: template.itemId,
    templatePath: template.path,
    contentItemId,
    contentItemPath,
    addedToPage,
  };
}
