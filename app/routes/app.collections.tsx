import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AIService } from "../utils/ai.server";
import db from "../db.server";

interface CollectionNode {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      collections(first: 20) {
        nodes {
          id
          title
          handle
          descriptionHtml
        }
      }
    }
  `);

  const data = await response.json();
  return {
    collections: (data.data?.collections?.nodes || []) as CollectionNode[],
  };
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

  if (actionType === "optimizeCollection") {
    const id = formData.get("id") as string;
    const title = formData.get("title") as string;
    const descriptionHtml = formData.get("descriptionHtml") as string;
    const tone = formData.get("tone") as string || "fashion";

    const newDescription = await AIService.generateDescription(title, descriptionHtml, tone, config);

    const updateResponse = await admin.graphql(
      `#graphql
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
            descriptionHtml
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
            descriptionHtml: newDescription,
          },
        },
      }
    );

    const updateJson = await updateResponse.json();

    return {
      success: !updateJson.data?.collectionUpdate?.userErrors?.length,
      errors: updateJson.data?.collectionUpdate?.userErrors || [],
    };
  }

  return { success: false };
};

export default function CollectionsPage() {
  const { collections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [tone, setTone] = useState("fashion");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data) {
      setLoadingId(null);
      if (fetcher.data.success) {
        shopify.toast.show("Collection description optimized!");
      } else {
        const errs = fetcher.data.errors as { message: string }[];
        shopify.toast.show(errs.length > 0 ? errs[0].message : "Failed to update collection.");
      }
    }
  }, [fetcher.data, shopify]);

  const handleOptimize = (col: CollectionNode) => {
    setLoadingId(col.id);
    fetcher.submit(
      {
        actionType: "optimizeCollection",
        id: col.id,
        title: col.title,
        descriptionHtml: col.descriptionHtml,
        tone: tone,
      },
      { method: "POST" }
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Collection Descriptions Optimizer</h1>
        <p style={styles.subtitle}>Audit and generate optimized SEO copywriting descriptions for your store collections</p>
      </div>

      <div style={styles.filterBar}>
        <label htmlFor="tone-selector" style={styles.toneLabel}>Copywriting Writing Tone: </label>
        <select
          id="tone-selector"
          style={styles.select}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        >
          <option value="fashion">Casual / Fashion (Informative, warm)</option>
          <option value="luxury">Luxury / Premium (Elegant, elite)</option>
          <option value="electronics">Electronics / Tech (Detailed specifications)</option>
          <option value="sports">Sports / Performance (Energetic, active)</option>
          <option value="beauty">Beauty / Cosmetic (Rejuvenating)</option>
          <option value="medical">Medical / Health (Formal, safety focus)</option>
        </select>
      </div>

      <div style={styles.card}>
        {collections.length === 0 ? (
          <div style={styles.emptyState}>No collections found in your Shopify store.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeaderRow}>
                <th style={styles.th}>Collection Details</th>
                <th style={styles.th}>Current Description</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((col) => {
                const plainDesc = col.descriptionHtml ? col.descriptionHtml.replace(/<[^>]*>/g, "").trim() : "";
                const isShort = plainDesc.length < 80;

                return (
                  <tr key={col.id} style={styles.tr}>
                    <td style={styles.td}>
                      <strong style={styles.colName}>{col.title}</strong>
                      <div style={styles.colHandle}>Handle: /{col.handle}</div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.descText}>
                        {col.descriptionHtml ? (
                          <div dangerouslySetInnerHTML={{ __html: col.descriptionHtml }} />
                        ) : (
                          <span style={styles.emptyText}>No description configured</span>
                        )}
                      </div>
                    </td>
                    <td style={styles.td}>
                      {isShort ? (
                        <span style={styles.badgeWarning}>Needs SEO optimization</span>
                      ) : (
                        <span style={styles.badgeSuccess}>Healthy</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <button
                        style={styles.btn}
                        disabled={loadingId === col.id}
                        onClick={() => handleOptimize(col)}
                      >
                        {loadingId === col.id ? "Optimizing..." : "AI Optimize"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    backgroundColor: "#ffffff",
    padding: "16px 20px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
    marginBottom: "24px",
  },
  toneLabel: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
  },
  select: {
    fontSize: "14px",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    outline: "none",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
  },
  tableHeaderRow: {
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  },
  th: {
    padding: "16px 24px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#4b5563",
    textTransform: "uppercase",
  },
  tr: {
    borderBottom: "1px solid #e5e7eb",
    transition: "background-color 0.15s",
  },
  td: {
    padding: "20px 24px",
    verticalAlign: "middle",
  },
  colName: {
    fontSize: "16px",
    fontWeight: 700,
    display: "block",
  },
  colHandle: {
    fontSize: "12px",
    color: "#6b7280",
    marginTop: "2px",
  },
  descText: {
    fontSize: "13px",
    color: "#4b5563",
    maxWidth: "400px",
    lineHeight: "1.5",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emptyText: {
    fontStyle: "italic",
    color: "#9ca3af",
  },
  badgeWarning: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
    fontSize: "12px",
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: "9999px",
    display: "inline-block",
  },
  badgeSuccess: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
    fontSize: "12px",
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: "9999px",
    display: "inline-block",
  },
  btn: {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(79, 70, 229, 0.1)",
    transition: "background-color 0.15s",
  },
  emptyState: {
    padding: "40px",
    textAlign: "center",
    color: "#6b7280",
    fontSize: "14px",
  },
};
