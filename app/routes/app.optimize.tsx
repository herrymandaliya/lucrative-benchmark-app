import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AIService, type ProductInput } from "../utils/ai.server";
import db from "../db.server";

interface GraphQLMediaImage {
  id: string;
  alt: string | null;
  mediaContentType: string;
  image?: {
    url: string;
  };
}

interface GraphQLProduct {
  id: string;
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  media?: {
    nodes: GraphQLMediaImage[];
  };
  seo?: {
    title?: string;
    description?: string;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Fetch products
  const response = await admin.graphql(`
    query {
      products(first: 30) {
        nodes {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          media(first: 5) {
            nodes {
              id
              alt
              mediaContentType
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
          seo {
            title
            description
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const rawProducts = responseJson.data?.products?.nodes || [];

  const products: ProductInput[] = rawProducts.map((prod: GraphQLProduct) => ({
    id: prod.id,
    title: prod.title,
    descriptionHtml: prod.descriptionHtml || "",
    vendor: prod.vendor,
    productType: prod.productType,
    tags: prod.tags || [],
    images: prod.media?.nodes
      .filter((med) => med.mediaContentType === "IMAGE")
      .map((med) => ({
        id: med.id,
        src: med.image?.url || "",
        altText: med.alt,
      })) || [],
    seoTitle: prod.seo?.title || "",
    seoDescription: prod.seo?.description || "",
  }));

  const history = await db.productHistory.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return { products, history };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  const settings = await db.appSettings.findUnique({
    where: { shop },
  });
  const config = {
    apiKey: settings?.apiKey || "",
    provider: settings?.provider || "mock",
  };

  if (actionType === "generateAISuggestions") {
    const title = formData.get("title") as string;
    const descriptionHtml = formData.get("descriptionHtml") as string;
    const tone = formData.get("tone") as string || "fashion";

    const aiDescription = await AIService.generateDescription(title, descriptionHtml, tone, config);
    const { seoTitle, seoDescription } = await AIService.generateSEO(title, aiDescription, config);
    const aiAltText = await AIService.generateAltText(title, 0, config);
    const faqs = await AIService.generateFAQs(title, aiDescription, config);
    const tags = await AIService.generateTags(title, aiDescription, config);

    return {
      aiDescription,
      seoTitle,
      seoDescription,
      aiAltText,
      faqs,
      tags,
    };
  }

  if (actionType === "translateContent") {
    const targetLanguage = formData.get("targetLanguage") as string;
    const description = formData.get("description") as string | null;
    const seoTitle = formData.get("seoTitle") as string | null;
    const seoDescription = formData.get("seoDescription") as string | null;

    console.log("[TRANSLATE ACTION RECEIVED]", { targetLanguage, description, seoTitle, seoDescription });
    console.log("[AI CONFIG BEING USED]", config);

    if (description !== null && seoTitle !== null && seoDescription !== null) {
      const translatedDesc = await AIService.translateContent(description, targetLanguage, config);
      const translatedSeoTitle = await AIService.translateContent(seoTitle, targetLanguage, config);
      const translatedSeoDesc = await AIService.translateContent(seoDescription, targetLanguage, config);

      const translationsObj = {
        description: translatedDesc,
        seoTitle: translatedSeoTitle,
        seoDescription: translatedSeoDesc,
      };

      console.log("[TRANSLATE ACTION SUCCESS]", translationsObj);

      return {
        success: true,
        translations: translationsObj
      };
    } else {
      const text = formData.get("text") as string;
      const translated = await AIService.translateContent(text, targetLanguage, config);
      console.log("[TRANSLATE ACTION SINGLE SUCCESS]", { translated });
      return { success: true, translated };
    }
  }

  if (actionType === "rollbackVersion") {
    const versionId = formData.get("versionId") as string;
    const historyItem = await db.productHistory.findUnique({
      where: { id: versionId },
    });

    if (!historyItem) {
      return { success: false, errors: [{ message: "Version not found" }] };
    }

    const rollbackResponse = await admin.graphql(
      `#graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            id: historyItem.productId,
            title: historyItem.title,
            descriptionHtml: historyItem.descriptionHtml,
            seo: {
              title: historyItem.seoTitle,
              description: historyItem.seoDescription,
            },
          },
        },
      }
    );

    const rollbackJson = await rollbackResponse.json();

    await db.productHistory.delete({
      where: { id: versionId },
    });

    return {
      success: !rollbackJson.data?.productUpdate?.userErrors?.length,
      errors: rollbackJson.data?.productUpdate?.userErrors || [],
      rolledBack: true,
    };
  }

  if (actionType === "saveOptimized") {
    const id = formData.get("productId") as string;
    const description = formData.get("description") as string;
    const seoTitle = formData.get("seoTitle") as string;
    const seoDescription = formData.get("seoDescription") as string;
    const altText = formData.get("altText") as string;
    const firstImageId = formData.get("firstImageId") as string;
    const tagsStr = formData.get("tags") as string;
    const faqsStr = formData.get("faqs") as string;

    // Fetch current product state to store inside version history
    try {
      const currentResponse = await admin.graphql(
        `#graphql
        query getProduct($id: ID!) {
          product(id: $id) {
            title
            descriptionHtml
            seo {
              title
              description
            }
          }
        }`,
        { variables: { id } }
      );
      const currentJson = await currentResponse.json();
      const currentProd = currentJson.data?.product;

      if (currentProd) {
        await db.productHistory.create({
          data: {
            shop,
            productId: id,
            title: currentProd.title,
            descriptionHtml: currentProd.descriptionHtml || "",
            seoTitle: currentProd.seo?.title || "",
            seoDescription: currentProd.seo?.description || "",
          },
        });
      }
    } catch (e) {
      console.error("Failed to save previous version in history:", e);
    }

    // Save product update
    const updateResponse = await admin.graphql(
      `#graphql
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            descriptionHtml
            seo {
              title
              description
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            id,
            descriptionHtml: description,
            seo: {
              title: seoTitle,
              description: seoDescription,
            },
            tags: tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter((t) => t !== "") : [],
            ...(faqsStr ? {
              metafields: [
                {
                  namespace: "custom",
                  key: "faqs",
                  value: faqsStr,
                  type: "json",
                },
              ],
            } : {}),
          },
        },
      }
    );

    const updateJson = await updateResponse.json();

    // If an image alt text was updated, we run another mutation
    if (firstImageId && altText) {
      await admin.graphql(
        `#graphql
        mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
          productUpdateMedia(productId: $productId, media: $media) {
            media {
              id
              alt
            }
            mediaUserErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId: id,
            media: [
              {
                id: firstImageId,
                alt: altText,
              },
            ],
          },
        }
      );
    }

    return {
      success: !updateJson.data?.productUpdate?.userErrors?.length,
      errors: updateJson.data?.productUpdate?.userErrors || [],
    };
  }

  if (actionType === "bulkProcess") {
    const productIdsStr = formData.get("productIds") as string;
    const productIds = JSON.parse(productIdsStr) as string[];
    const optionsStr = formData.get("options") as string;
    const options = JSON.parse(optionsStr) as Record<string, boolean>;

    // In a real environment, we'd queue these. For Phase 1 prototype, we'll run inline and optimize.
    let successCount = 0;

    for (const id of productIds) {
      // Find title and current description
      // In a real bulk runner we'd query the DB/Shopify, here we update basic descriptions
      try {
        const fetchProductResponse = await admin.graphql(
          `#graphql
          query getProduct($id: ID!) {
            product(id: $id) {
              title
              descriptionHtml
            }
          }`
          , { variables: { id } }
        );
        const prodData = await fetchProductResponse.json();
        const p = prodData.data?.product;
        if (!p) continue;

        let newDesc = p.descriptionHtml;
        let sTitle = "";
        let sDesc = "";

        if (options.rewriteDescription) {
          newDesc = await AIService.generateDescription(p.title, p.descriptionHtml, "fashion", config);
        }
        if (options.generateSEO) {
          const seo = await AIService.generateSEO(p.title, newDesc, config);
          sTitle = seo.seoTitle;
          sDesc = seo.seoDescription;
        }

        const variables: {
          input: {
            id: string;
            descriptionHtml?: string;
            seo?: {
              title: string;
              description: string;
            };
          };
        } = {
          input: { id }
        };
        if (options.rewriteDescription) {
          variables.input.descriptionHtml = newDesc;
        }
        if (options.generateSEO) {
          variables.input.seo = {
            title: sTitle,
            description: sDesc
          };
        }

        const updateRes = await admin.graphql(
          `#graphql
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { message }
            }
          }`,
          { variables }
        );
        const resJson = await updateRes.json();
        if (!resJson.data?.productUpdate?.userErrors?.length) {
          successCount++;
        }
      } catch (err) {
        console.error("Bulk process error for product:", id, err);
      }
    }

    return {
      bulkSuccess: true,
      count: successCount,
    };
  }

  return { success: false };
};

export default function BulkOptimizer() {
  const { products, history } = useLoaderData<typeof loader>() as unknown as {
    products: ProductInput[];
    history: {
      id: string;
      productId: string;
      title: string;
      descriptionHtml: string;
      seoTitle: string;
      seoDescription: string;
      createdAt: string;
    }[];
  };
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const location = useLocation();

  interface ActionAISuggestions {
    aiDescription: string;
    seoTitle: string;
    seoDescription: string;
    aiAltText: string;
    faqs: { q: string; a: string }[];
    tags?: string[];
  }

  interface ActionSuccess {
    success: boolean;
    errors: { field: string[]; message: string }[];
  }

  interface ActionBulkSuccess {
    bulkSuccess: boolean;
    count: number;
  }

  const [selectedProduct, setSelectedProduct] = useState<ProductInput | null>(null);
  const [tone, setTone] = useState<string>("fashion");
  const [aiSuggestions, setAiSuggestions] = useState<ActionAISuggestions | null>(null);

  // Editable suggestion states
  const [editedDescription, setEditedDescription] = useState("");
  const [editedSeoTitle, setEditedSeoTitle] = useState("");
  const [editedSeoDescription, setEditedSeoDescription] = useState("");
  const [editedAltText, setEditedAltText] = useState("");
  const [editedTags, setEditedTags] = useState("");

  const [targetLanguage, setTargetLanguage] = useState("Spanish");
  const [translatingField, setTranslatingField] = useState<"desc" | "seoTitle" | "seoDesc" | null>(null);

  const isSaving = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "saveOptimized";
  const isRollingBack = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "rollbackVersion";
  const isTranslating = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "translateContent";

  // Bulk States
  const [bulkList, setBulkList] = useState<string[]>([]);

  // Set default state of checkboxes based on preselect navigation state
  const preselect = location.state?.preselect;
  const [bulkOptions, setBulkOptions] = useState({
    rewriteDescription: preselect === "all" || !preselect,
    generateSEO: preselect === "all" || !preselect,
    fixAltText: preselect === "altText" || preselect === "all" || !preselect,
    generateFAQs: preselect === "all",
    addBullets: preselect === "all",
  });
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // Automatically select products matching the preselect state
  useEffect(() => {
    if (preselect === "altText") {
      const missingAltProds = products
        .filter((p) => p.images && p.images.some((img) => !img.altText || img.altText.trim() === ""))
        .map((p) => p.id);
      setBulkList(missingAltProds);
    } else if (preselect === "all") {
      setBulkList(products.map((p) => p.id));
    }
  }, [preselect, products]);

  useEffect(() => {
    // Populate suggestions
    if (fetcher.data && "aiDescription" in fetcher.data) {
      const data = fetcher.data as ActionAISuggestions;
      setAiSuggestions(data);
      setEditedDescription(data.aiDescription);
      setEditedSeoTitle(data.seoTitle);
      setEditedSeoDescription(data.seoDescription);
      setEditedAltText(data.aiAltText);
      setEditedTags(data.tags ? data.tags.join(", ") : "");
    }

    console.log("Fetcher state/data update:", { state: fetcher.state, data: fetcher.data });

    if (fetcher.data && "translated" in fetcher.data && fetcher.data.translated) {
      shopify.toast.show("Content translated!");
      if (translatingField === "desc") {
        setEditedDescription(fetcher.data.translated);
      } else if (translatingField === "seoTitle") {
        setEditedSeoTitle(fetcher.data.translated);
      } else if (translatingField === "seoDesc") {
        setEditedSeoDescription(fetcher.data.translated);
      }
      setTranslatingField(null);
    }

    if (fetcher.data && "translations" in fetcher.data && fetcher.data.translations) {
      shopify.toast.show("Content translated!");
      setEditedDescription(fetcher.data.translations.description);
      setEditedSeoTitle(fetcher.data.translations.seoTitle);
      setEditedSeoDescription(fetcher.data.translations.seoDescription);
      setTranslatingField(null);
    }

    if (fetcher.data && "rolledBack" in fetcher.data) {
      shopify.toast.show("Version restored successfully!");
    } else if (fetcher.data && "success" in fetcher.data) {
      if ((fetcher.data as ActionSuccess).success) {
        shopify.toast.show("Saved changes to Shopify store!");
        setAiSuggestions(null);
        setSelectedProduct(null);
      }
    }

    if (fetcher.data && "bulkSuccess" in fetcher.data) {
      const data = fetcher.data as ActionBulkSuccess;
      shopify.toast.show(`Bulk processing finished! Optimized ${data.count} products.`);
      setIsBulkRunning(false);
      setBulkProgress(100);
      setBulkList([]);
    }
  }, [fetcher.data, shopify, translatingField]);

  const handleTranslate = (field: "desc" | "seoTitle" | "seoDesc") => {
    setTranslatingField(field);
    const text = field === "desc" ? editedDescription : field === "seoTitle" ? editedSeoTitle : editedSeoDescription;
    fetcher.submit(
      {
        actionType: "translateContent",
        text,
        targetLanguage,
      },
      { method: "POST" }
    );
  };

  const handleRollback = (versionId: string) => {
    fetcher.submit(
      {
        actionType: "rollbackVersion",
        versionId,
      },
      { method: "POST" }
    );
  };

  const triggerSuggestions = (prod: ProductInput) => {
    setSelectedProduct(prod);
    setAiSuggestions(null);
    fetcher.submit(
      {
        actionType: "generateAISuggestions",
        title: prod.title,
        descriptionHtml: prod.descriptionHtml,
        tone: tone,
      },
      { method: "POST" }
    );
  };

  const saveSuggestions = () => {
    if (!selectedProduct) return;
    fetcher.submit(
      {
        actionType: "saveOptimized",
        productId: selectedProduct.id,
        description: editedDescription,
        seoTitle: editedSeoTitle,
        seoDescription: editedSeoDescription,
        altText: editedAltText,
        firstImageId: selectedProduct.images?.[0]?.id || "",
        tags: editedTags,
        faqs: aiSuggestions ? JSON.stringify(aiSuggestions.faqs) : "[]",
      },
      { method: "POST" }
    );
  };

  const handleBulkCheckbox = (id: string) => {
    if (bulkList.includes(id)) {
      setBulkList(bulkList.filter((x) => x !== id));
    } else {
      setBulkList([...bulkList, id]);
    }
  };

  const handleSelectAll = () => {
    if (bulkList.length === products.length) {
      setBulkList([]);
    } else {
      setBulkList(products.map((p) => p.id));
    }
  };

  const runBulkOptimization = () => {
    if (bulkList.length === 0) return;
    setIsBulkRunning(true);
    setBulkProgress(10);

    // Simulate progress bar movement for visual beauty
    const interval = setInterval(() => {
      setBulkProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 15;
      });
    }, 400);

    fetcher.submit(
      {
        actionType: "bulkProcess",
        productIds: JSON.stringify(bulkList),
        options: JSON.stringify(bulkOptions),
      },
      { method: "POST" }
    );
  };

  const isGenerating = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "generateAISuggestions";

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Bulk AI Optimization Studio</h1>
        <p style={styles.subtitle}>Audit, preview, and rewrite product content across your catalog in one click</p>
      </div>

      {/* Main Studio View Split Layout */}
      <div style={styles.splitGrid}>

        {/* Left Side: Product Catalogue Selection & Bulk Control */}
        <div style={styles.leftCol}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>Product Catalogue ({products.length})</h3>
              <button style={styles.selectAllBtn} onClick={handleSelectAll}>
                {bulkList.length === products.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            {/* Bulk Selection Processing Card */}
            {bulkList.length > 0 && (
              <div style={styles.bulkBox}>
                <h4 style={styles.bulkBoxTitle}>Bulk Optimizing {bulkList.length} Selected Products</h4>

                <div style={styles.optionsList}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={bulkOptions.rewriteDescription}
                      onChange={(e) => setBulkOptions({ ...bulkOptions, rewriteDescription: e.target.checked })}
                    />
                    Rewrite Descriptions
                  </label>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={bulkOptions.generateSEO}
                      onChange={(e) => setBulkOptions({ ...bulkOptions, generateSEO: e.target.checked })}
                    />
                    Generate SEO Metadata
                  </label>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={bulkOptions.fixAltText}
                      onChange={(e) => setBulkOptions({ ...bulkOptions, fixAltText: e.target.checked })}
                    />
                    Fix Alt Text
                  </label>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={bulkOptions.generateFAQs}
                      onChange={(e) => setBulkOptions({ ...bulkOptions, generateFAQs: e.target.checked })}
                    />
                    Add FAQ Schema
                  </label>
                </div>

                {isBulkRunning ? (
                  <div style={styles.progressSection}>
                    <div style={styles.progressText}>Running AI Optimizations... {bulkProgress}%</div>
                    <div style={styles.progressTrack}>
                      <div style={{ ...styles.progressFill, width: `${bulkProgress}%` }} />
                    </div>
                  </div>
                ) : (
                  <button style={styles.runBulkBtn} onClick={runBulkOptimization}>
                    Run Bulk Optimization ({bulkList.length} products)
                  </button>
                )}
              </div>
            )}

            {/* List */}
            <div style={styles.productList}>
              {products.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px" }}>No products to display.</div>
              ) : (
                products.map((prod) => (
                  <div
                    key={prod.id}
                    style={{
                      ...styles.productItem,
                      borderLeft: selectedProduct?.id === prod.id ? "4px solid #4f46e5" : "4px solid transparent",
                      backgroundColor: selectedProduct?.id === prod.id ? "#f3f4f6" : "#ffffff",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={styles.listCheckbox}
                      checked={bulkList.includes(prod.id)}
                      onChange={() => handleBulkCheckbox(prod.id)}
                    />
                    <div
                      style={styles.listThumbnailContainer}
                      onClick={() => triggerSuggestions(prod)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          triggerSuggestions(prod);
                        }
                      }}
                    >
                      {prod.images && prod.images.length > 0 ? (
                        <img src={prod.images[0].src} alt="" style={styles.listThumbnail} />
                      ) : (
                        <div style={styles.listThumbnailPlaceholder}>Empty</div>
                      )}
                    </div>
                    <div
                      style={styles.listDetails}
                      onClick={() => triggerSuggestions(prod)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          triggerSuggestions(prod);
                        }
                      }}
                    >
                      <strong style={styles.listName}>{prod.title}</strong>
                      <div style={styles.listSubText}>
                        {prod.seoTitle ? "✓ SEO Title" : "✗ No SEO Title"} •{" "}
                        {prod.descriptionHtml ? `${prod.descriptionHtml.replace(/<[^>]*>/g, "").length} chars` : "No Description"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Version History & Rollback Panel */}
            <div style={styles.historySection}>
              <h4 style={styles.historyTitle}>Version Rollback History</h4>
              {history.length === 0 ? (
                <p style={styles.historyEmpty}>No optimization versions recorded yet.</p>
              ) : (
                <div style={styles.historyList}>
                  {history.map((hist) => (
                    <div key={hist.id} style={styles.historyItem}>
                      <div style={styles.historyMeta}>
                        <strong style={styles.historyProdTitle}>{hist.title}</strong>
                        <span style={styles.historyTime}>
                          {new Date(hist.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={styles.historyDesc}>
                        {hist.descriptionHtml.replace(/<[^>]*>/g, "").slice(0, 60)}...
                      </div>
                      <button
                        style={styles.rollbackBtn}
                        disabled={isRollingBack}
                        onClick={() => handleRollback(hist.id)}
                      >
                        Rollback
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Split Screen Workspace */}
        <div style={styles.rightCol}>
          {!selectedProduct ? (
            <div style={styles.emptyWorkspace}>
              <div style={styles.workspaceIcon}>⚡</div>
              <h3 style={styles.workspaceText}>AI Optimization Studio Playground</h3>
              <p style={styles.workspaceDesc}>
                Select a product from the list to trigger active AI suggestions. Review side-by-side edits, customize
                writing tones, and write updates directly back to your Shopify catalog.
              </p>
            </div>
          ) : (
            <div style={styles.workspaceCard}>
              <div style={styles.workspaceHeader}>
                <div>
                  <h3 style={styles.workspaceHeaderTitle}>Editing: {selectedProduct.title}</h3>
                  <div style={styles.toneSelectorContainer}>
                    <label style={styles.toneLabel} htmlFor="tone-select">Writing Tone: </label>
                    <select style={styles.selectTone} id="tone-select" value={tone} onChange={(e) => setTone(e.target.value)}>
                      <option value="fashion">Casual / Fashion</option>
                      <option value="luxury">Luxury / Premium</option>
                      <option value="electronics">Electronics / Tech</option>
                      <option value="sports">Sports / Performance</option>
                      <option value="beauty">Beauty / Cosmetic</option>
                      <option value="medical">Medical / Health</option>
                    </select>
                    <button style={styles.regenerateBtn} disabled={isGenerating} onClick={() => triggerSuggestions(selectedProduct)}>
                      {isGenerating ? "Generating..." : "Regenerate Suggestions"}
                    </button>
                  </div>
                </div>
              </div>

              {isGenerating && (
                <div style={styles.loadingOverlay}>
                  <div style={styles.spinner} />
                  <p style={{ marginTop: "16px", fontWeight: 600 }}>Analyzing product and generating AI copy...</p>
                </div>
              )}

              {aiSuggestions && (
                <div style={styles.workspaceSplit}>
                  {/* Left panel: Current Content */}
                  <div style={styles.workspacePanel}>
                    <h4 style={styles.panelTitle}>Current Content</h4>
                    <div style={styles.panelField}>
                      <span style={styles.fieldLabel}>Product Description</span>
                      <div
                        style={styles.fieldValueContainer}
                        dangerouslySetInnerHTML={{ __html: selectedProduct.descriptionHtml || "<i>No description</i>" }}
                      />
                    </div>
                    <div style={styles.panelField}>
                      <span style={styles.fieldLabel}>SEO Title</span>
                      <div style={styles.fieldValueText}>{selectedProduct.seoTitle || "Not set"}</div>
                    </div>
                    <div style={styles.panelField}>
                      <span style={styles.fieldLabel}>Meta Description</span>
                      <div style={styles.fieldValueText}>{selectedProduct.seoDescription || "Not set"}</div>
                    </div>
                    <div style={styles.panelField}>
                      <span style={styles.fieldLabel}>First Image ALT Text</span>
                      <div style={styles.fieldValueText}>
                        {selectedProduct.images?.[0]?.altText || "No ALT tag configured"}
                      </div>
                    </div>
                  </div>

                  {/* Right panel: AI Suggested & Editable Content */}
                  <div style={styles.workspacePanel}>
                    <h4 style={{ ...styles.panelTitle, color: "#4f46e5" }}>AI Optimizations (Editable)</h4>

                    {/* Translation Widget */}
                    <div style={styles.translateBox}>
                      <label htmlFor="translate-lang-select" style={styles.translateLabel}>Translate Content: </label>
                      <select
                        id="translate-lang-select"
                        style={styles.selectLang}
                        value={targetLanguage}
                        onChange={(e) => {
                          const newLang = e.target.value;
                          console.log("Language changed to:", newLang, "Triggering bulk translation...");
                          setTargetLanguage(newLang);
                          setTranslatingField("desc");
                          fetcher.submit(
                            {
                              actionType: "translateContent",
                              targetLanguage: newLang,
                              description: editedDescription,
                              seoTitle: editedSeoTitle,
                              seoDescription: editedSeoDescription,
                            },
                            { method: "POST" }
                          );
                        }}
                      >
                        <option value="Spanish">Spanish (Español)</option>
                        <option value="French">French (Français)</option>
                        <option value="German">German (Deutsch)</option>
                        <option value="Japanese">Japanese (日本語)</option>
                        <option value="Italian">Italian (Italiano)</option>
                      </select>
                      <div style={styles.translateButtons}>
                        <button style={styles.translateBtn} disabled={isTranslating} onClick={() => handleTranslate("desc")}>
                          Translate Description
                        </button>
                        <button style={styles.translateBtn} disabled={isTranslating} onClick={() => handleTranslate("seoTitle")}>
                          Translate SEO
                        </button>
                      </div>
                    </div>

                    <div style={styles.panelField}>
                      <label style={styles.fieldLabel} htmlFor="description-textarea">Description (HTML Supported)</label>
                      <textarea
                        id="description-textarea"
                        style={styles.panelTextarea}
                        rows={8}
                        value={editedDescription}
                        onChange={(e) => setEditedDescription(e.target.value)}
                      />
                    </div>

                    <div style={styles.panelField}>
                      <label style={styles.fieldLabel} htmlFor="seo-title-input">SEO Title ({editedSeoTitle.length}/60 chars)</label>
                      <input
                        id="seo-title-input"
                        type="text"
                        style={styles.panelInput}
                        value={editedSeoTitle}
                        onChange={(e) => setEditedSeoTitle(e.target.value)}
                      />
                    </div>

                    <div style={styles.panelField}>
                      <label style={styles.fieldLabel} htmlFor="seo-desc-textarea">Meta Description ({editedSeoDescription.length}/155 chars)</label>
                      <textarea
                        id="seo-desc-textarea"
                        style={{ ...styles.panelInput, minHeight: "60px", resize: "vertical" }}
                        rows={2}
                        value={editedSeoDescription}
                        onChange={(e) => setEditedSeoDescription(e.target.value)}
                      />
                    </div>

                    <div style={styles.panelField}>
                      <label style={styles.fieldLabel} htmlFor="alt-text-input">Generated Alt Text</label>
                      <input
                        id="alt-text-input"
                        type="text"
                        style={styles.panelInput}
                        value={editedAltText}
                        onChange={(e) => setEditedAltText(e.target.value)}
                      />
                    </div>

                    {/* Product Tags input */}
                    <div style={styles.panelField}>
                      <label style={styles.fieldLabel} htmlFor="tags-input">AI Recommended Product Tags (Comma separated)</label>
                      <input
                        id="tags-input"
                        type="text"
                        style={styles.panelInput}
                        value={editedTags}
                        onChange={(e) => setEditedTags(e.target.value)}
                      />
                    </div>

                    {/* Preview FAQs */}
                    {aiSuggestions.faqs && (
                      <div style={styles.panelField}>
                        <span style={styles.fieldLabel}>AI Generated FAQs (Schema Ready)</span>
                        <div style={styles.faqPreviewBox}>
                          {aiSuggestions.faqs.map((faq: { q: string; a: string }, idx: number) => (
                            <div key={idx} style={styles.faqItem}>
                              <div style={styles.faqQ}>Q: {faq.q}</div>
                              <div style={styles.faqA}>A: {faq.a}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={styles.workspaceActions}>
                      <button style={styles.cancelBtn} onClick={() => setSelectedProduct(null)}>
                        Cancel
                      </button>
                      <button style={styles.saveBtn} disabled={isSaving} onClick={saveSuggestions}>
                        {isSaving ? "Saving..." : "Approve & Save to Shopify"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "24px",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    backgroundColor: "#f9fafb",
    color: "#111827",
    minHeight: "100vh",
  },
  header: {
    marginBottom: "24px",
  },
  title: {
    fontSize: "28px",
    fontWeight: 800,
    margin: 0,
    letterSpacing: "-0.025em",
  },
  subtitle: {
    fontSize: "15px",
    color: "#6b7280",
    margin: "6px 0 0 0",
  },
  splitGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.5fr",
    gap: "24px",
    alignItems: "start",
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  rightCol: {
    position: "sticky",
    top: "24px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 24px",
    borderBottom: "1px solid #f3f4f6",
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 700,
    margin: 0,
  },
  selectAllBtn: {
    backgroundColor: "transparent",
    color: "#4f46e5",
    border: "none",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  bulkBox: {
    backgroundColor: "#f5f3ff",
    border: "1px solid #ddd6fe",
    borderRadius: "12px",
    padding: "20px",
    margin: "20px 24px 0 24px",
  },
  bulkBoxTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#5b21b6",
    margin: "0 0 12px 0",
  },
  optionsList: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
    marginBottom: "16px",
  },
  checkboxLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#4c1d95",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  },
  runBulkBtn: {
    backgroundColor: "#7c3aed",
    color: "#ffffff",
    border: "none",
    width: "100%",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(79, 70, 229, 0.1)",
    transition: "background-color 0.2s",
  },
  translateBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "14px",
    marginBottom: "18px",
  },
  translateLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    display: "block",
    marginBottom: "6px",
  },
  selectLang: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    backgroundColor: "#ffffff",
    outline: "none",
    marginBottom: "10px",
  },
  translateButtons: {
    display: "flex",
    gap: "10px",
  },
  translateBtn: {
    flex: 1,
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    padding: "8px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  historySection: {
    marginTop: "24px",
    borderTop: "1px solid #e2e8f0",
    paddingTop: "20px",
  },
  historyTitle: {
    fontSize: "14px",
    fontWeight: 700,
    margin: "0 0 12px 0",
    color: "#475569",
  },
  historyEmpty: {
    fontSize: "12px",
    color: "#94a3b8",
    margin: 0,
  },
  historyList: {
    maxHeight: "220px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  historyItem: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "10px 12px",
  },
  historyMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "4px",
  },
  historyProdTitle: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#1e293b",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "70%",
  },
  historyTime: {
    fontSize: "10px",
    color: "#64748b",
  },
  historyDesc: {
    fontSize: "11px",
    color: "#475569",
    marginBottom: "8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rollbackBtn: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
    border: "none",
    padding: "6px 12px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(239, 68, 68, 0.1)",
  },
  progressSection: {
    marginTop: "8px",
  },
  progressText: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#6d28d9",
    marginBottom: "6px",
  },
  progressTrack: {
    width: "100%",
    height: "8px",
    backgroundColor: "#ddd6fe",
    borderRadius: "9999px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#7c3aed",
    borderRadius: "9999px",
    transition: "width 0.3s ease",
  },
  productList: {
    maxHeight: "60vh",
    overflowY: "auto",
    padding: "12px 24px 24px 24px",
  },
  productItem: {
    display: "flex",
    alignItems: "center",
    padding: "12px",
    borderRadius: "10px",
    marginBottom: "10px",
    cursor: "pointer",
    transition: "border 0.2s, background-color 0.2s",
  },
  listCheckbox: {
    marginRight: "12px",
    cursor: "pointer",
  },
  listThumbnailContainer: {
    marginRight: "12px",
  },
  listThumbnail: {
    width: "40px",
    height: "40px",
    borderRadius: "6px",
    objectFit: "cover",
  },
  listThumbnailPlaceholder: {
    width: "40px",
    height: "40px",
    borderRadius: "6px",
    backgroundColor: "#e5e7eb",
    fontSize: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6b7280",
    textAlign: "center",
  },
  listDetails: {
    flexGrow: 1,
    overflow: "hidden",
  },
  listName: {
    fontSize: "13px",
    fontWeight: 600,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  listSubText: {
    fontSize: "11px",
    color: "#6b7280",
    marginTop: "2px",
  },
  emptyWorkspace: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px dashed #cbd5e1",
    padding: "64px 32px",
    textAlign: "center",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
  },
  workspaceIcon: {
    fontSize: "48px",
    marginBottom: "16px",
  },
  workspaceText: {
    fontSize: "18px",
    fontWeight: 700,
    margin: "0 0 8px 0",
  },
  workspaceDesc: {
    fontSize: "14px",
    color: "#6b7280",
    margin: 0,
    lineHeight: "1.6",
    maxWidth: "400px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  workspaceCard: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    padding: "24px",
    minHeight: "400px",
    position: "relative",
  },
  workspaceHeader: {
    borderBottom: "1px solid #f3f4f6",
    paddingBottom: "16px",
    marginBottom: "20px",
  },
  workspaceHeaderTitle: {
    fontSize: "16px",
    fontWeight: 700,
    margin: "0 0 12px 0",
  },
  toneSelectorContainer: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  toneLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#4b5563",
  },
  selectTone: {
    fontSize: "12px",
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    fontWeight: 600,
  },
  regenerateBtn: {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    padding: "7px 14px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    border: "4px solid #f3f4f6",
    borderTop: "4px solid #4f46e5",
    borderRadius: "50%",
    width: "40px",
    height: "40px",
    animation: "spin 1s linear infinite",
  },
  workspaceSplit: {
    display: "grid",
    gridTemplateColumns: "1fr 1.2fr",
    gap: "20px",
  },
  workspacePanel: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  panelTitle: {
    fontSize: "13px",
    fontWeight: 700,
    margin: "0 0 8px 0",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "2px solid currentColor",
    paddingBottom: "6px",
  },
  panelField: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  fieldLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  fieldValueContainer: {
    fontSize: "13px",
    color: "#374151",
    backgroundColor: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "12px",
    maxHeight: "150px",
    overflowY: "auto",
    lineHeight: "1.5",
  },
  fieldValueText: {
    fontSize: "13px",
    color: "#374151",
    backgroundColor: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "10px 12px",
  },
  panelTextarea: {
    fontSize: "13px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "12px",
    fontFamily: "inherit",
    lineHeight: "1.5",
    resize: "vertical",
    width: "100%",
  },
  panelInput: {
    fontSize: "13px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "10px 12px",
    width: "100%",
  },
  faqPreviewBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "12px",
  },
  faqItem: {
    fontSize: "12px",
    marginBottom: "10px",
    lineHeight: "1.4",
  },
  faqQ: {
    fontWeight: 700,
    color: "#334155",
  },
  faqA: {
    color: "#475569",
    marginTop: "2px",
  },
  workspaceActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "16px",
    borderTop: "1px solid #f3f4f6",
    paddingTop: "16px",
  },
  cancelBtn: {
    backgroundColor: "#ffffff",
    color: "#374151",
    border: "1px solid #d1d5db",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  saveBtn: {
    backgroundColor: "#10b981",
    color: "#ffffff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(16, 185, 129, 0.15)",
  },
};
