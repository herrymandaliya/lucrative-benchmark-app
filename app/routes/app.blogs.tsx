import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AIService } from "../utils/ai.server";
import db from "../db.server";

interface BlogNode {
  id: string;
  title: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      blogs(first: 10) {
        nodes {
          id
          title
        }
      }
    }
  `);

  const data = await response.json();
  return {
    blogs: (data.data?.blogs?.nodes || []) as BlogNode[],
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

  if (actionType === "generateArticle") {
    const title = formData.get("title") as string;
    const keywords = formData.get("keywords") as string;
    const tone = formData.get("tone") as string || "fashion";

    const content = await AIService.generateArticle(title, keywords, tone, config);
    return { success: true, generatedContent: content };
  }

  if (actionType === "publishArticle") {
    const blogId = formData.get("blogId") as string;
    const title = formData.get("title") as string;
    const bodyHtml = formData.get("bodyHtml") as string;

    const publishResponse = await admin.graphql(
      `#graphql
      mutation articleCreate($article: ArticleInput!) {
        articleCreate(article: $article) {
          article {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          article: {
            blogId,
            title,
            bodyHtml,
            author: "AI Store Studio Writer",
            published: true,
          },
        },
      }
    );

    const publishJson = await publishResponse.json();

    return {
      success: !publishJson.data?.articleCreate?.userErrors?.length,
      errors: publishJson.data?.articleCreate?.userErrors || [],
      published: true,
    };
  }

  return { success: false };
};

export default function BlogWriterPage() {
  const { blogs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [blogId, setBlogId] = useState(blogs[0]?.id || "");
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("fashion");
  const [generatedHtml, setGeneratedHtml] = useState("");

  const isGenerating = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "generateArticle";
  const isPublishing = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "publishArticle";

  useEffect(() => {
    if (fetcher.data && fetcher.data.success) {
      if ("generatedContent" in fetcher.data && fetcher.data.generatedContent) {
        setGeneratedHtml(fetcher.data.generatedContent);
        shopify.toast.show("AI article draft generated!");
      }
      if ("published" in fetcher.data) {
        shopify.toast.show("Blog article published successfully!");
        setTitle("");
        setKeywords("");
        setGeneratedHtml("");
      }
    } else if (fetcher.data && "errors" in fetcher.data) {
      const errs = fetcher.data.errors as { message: string }[];
      shopify.toast.show(errs.length > 0 ? errs[0].message : "Failed to publish article.");
    }
  }, [fetcher.data, shopify]);

  const handleGenerate = () => {
    if (!title || !keywords) {
      shopify.toast.show("Please fill out both the title and keywords.");
      return;
    }
    fetcher.submit(
      {
        actionType: "generateArticle",
        title,
        keywords,
        tone,
      },
      { method: "POST" }
    );
  };

  const handlePublish = () => {
    if (!blogId) {
      shopify.toast.show("Please select a target blog.");
      return;
    }
    if (!title || !generatedHtml) {
      shopify.toast.show("Generate article draft before publishing.");
      return;
    }
    fetcher.submit(
      {
        actionType: "publishArticle",
        blogId,
        title,
        bodyHtml: generatedHtml,
      },
      { method: "POST" }
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>AI Blog Writer</h1>
        <p style={styles.subtitle}>Draft and publish SEO-optimized articles directly to {"store's"} blog category</p>
      </div>

      <div style={styles.layout}>
        {/* Left Side: Setup config */}
        <div style={styles.leftCol}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Configuration Settings</h3>
            
            <div style={styles.field}>
              <label htmlFor="blog-selector" style={styles.label}>Target Store Blog</label>
              <select
                id="blog-selector"
                style={styles.select}
                value={blogId}
                onChange={(e) => setBlogId(e.target.value)}
              >
                {blogs.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label htmlFor="blog-title-input" style={styles.label}>Proposed Article Title</label>
              <input
                id="blog-title-input"
                type="text"
                style={styles.input}
                placeholder="e.g. 5 Fall Fashion Trends to Watch"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div style={styles.field}>
              <label htmlFor="blog-keywords-input" style={styles.label}>SEO Focus Keywords</label>
              <input
                id="blog-keywords-input"
                type="text"
                style={styles.input}
                placeholder="e.g. cozy sweaters, autumn style, fashion"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>

            <div style={styles.field}>
              <label htmlFor="blog-tone-selector" style={styles.label}>Copywriting Writing Tone</label>
              <select
                id="blog-tone-selector"
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

            <button
              style={styles.btnPrimary}
              disabled={isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? "Generating draft..." : "Generate AI Article Draft"}
            </button>
          </div>
        </div>

        {/* Right Side: Preview & Publish */}
        <div style={styles.rightCol}>
          <div style={styles.card}>
            <div style={styles.workspaceHeader}>
              <h3 style={styles.cardTitle}>Live Preview Editor (HTML Supported)</h3>
              {generatedHtml && (
                <button
                  style={styles.btnSuccess}
                  disabled={isPublishing}
                  onClick={handlePublish}
                >
                  {isPublishing ? "Publishing..." : "Publish Article to Shopify"}
                </button>
              )}
            </div>

            {!generatedHtml ? (
              <div style={styles.placeholderState}>
                <div style={styles.placeholderIcon}>📝</div>
                <p style={styles.placeholderText}>Your generated blog draft will appear here.</p>
                <small style={styles.placeholderSubText}>Fill out configurations on the left to start writing.</small>
              </div>
            ) : (
              <textarea
                style={styles.editorArea}
                rows={18}
                value={generatedHtml}
                onChange={(e) => setGeneratedHtml(e.target.value)}
              />
            )}
          </div>
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
  layout: {
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
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    padding: "24px",
  },
  cardTitle: {
    fontSize: "18px",
    fontWeight: 700,
    margin: "0 0 16px 0",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "16px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#4b5563",
    textTransform: "uppercase",
  },
  select: {
    fontSize: "14px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    outline: "none",
  },
  input: {
    fontSize: "14px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    outline: "none",
  },
  btnPrimary: {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.2)",
    width: "100%",
  },
  workspaceHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  btnSuccess: {
    backgroundColor: "#059669",
    color: "#ffffff",
    border: "none",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(5, 150, 105, 0.1)",
  },
  placeholderState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 20px",
    border: "2px dashed #cbd5e1",
    borderRadius: "12px",
  },
  placeholderIcon: {
    fontSize: "36px",
    marginBottom: "12px",
  },
  placeholderText: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#4b5563",
    margin: 0,
  },
  placeholderSubText: {
    fontSize: "12px",
    color: "#6b7280",
    marginTop: "4px",
  },
  editorArea: {
    width: "100%",
    fontSize: "14px",
    fontFamily: "Courier, monospace",
    lineHeight: "1.6",
    padding: "14px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    outline: "none",
    resize: "vertical",
  },
};
