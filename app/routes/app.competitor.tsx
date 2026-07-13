import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { AIService } from "../utils/ai.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  if (actionType === "analyzeCompetitor") {
    const competitorDetails = formData.get("competitorDetails") as string;
    const analysis = await AIService.generateCompetitorAnalysis(competitorDetails, config);
    return { success: true, analysis };
  }

  return { success: false };
};

export default function CompetitorSeoPage() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  interface CompetitorAnalysis {
    score: number;
    weaknesses: string[];
    gaps: string[];
  }
  const [competitorDetails, setCompetitorDetails] = useState("");
  const [analysisResult, setAnalysisResult] = useState<CompetitorAnalysis | null>(null);

  const isLoading = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "analyzeCompetitor";

  useEffect(() => {
    if (fetcher.data && fetcher.data.success && "analysis" in fetcher.data && fetcher.data.analysis) {
      setAnalysisResult(fetcher.data.analysis);
      shopify.toast.show("Competitor SEO audit finished!");
    }
  }, [fetcher.data, shopify]);

  const handleAudit = () => {
    if (!competitorDetails) {
      shopify.toast.show("Please enter competitor brand or product URL.");
      return;
    }
    setAnalysisResult(null);
    fetcher.submit(
      {
        actionType: "analyzeCompetitor",
        competitorDetails,
      },
      { method: "POST" }
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Competitor SEO Intelligence</h1>
        <p style={styles.subtitle}>Audit competitor listings, benchmark rankings, and identify search keyword gaps</p>
      </div>

      <div style={styles.inputCard}>
        <label htmlFor="competitor-input" style={styles.label}>Competitor Brand or Product Details</label>
        <div style={styles.inputRow}>
          <input
            id="competitor-input"
            type="text"
            style={styles.input}
            placeholder="e.g. https://competitor.com/products/leather-jacket or 'Alpha Jackets'"
            value={competitorDetails}
            onChange={(e) => setCompetitorDetails(e.target.value)}
          />
          <button
            style={styles.btnPrimary}
            disabled={isLoading}
            onClick={handleAudit}
          >
            {isLoading ? "Running Audit..." : "Run SEO Benchmark"}
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Analyzing competitor SEO headers, keyword density, and schema metadata...</p>
        </div>
      )}

      {analysisResult && (
        <div style={styles.grid}>
          {/* SEO Score Circle */}
          <div style={styles.cardScore}>
            <h3 style={styles.cardTitle}>Competitor SEO Score</h3>
            <div style={styles.scoreValue}>
              {analysisResult.score}
              <span style={styles.scoreMax}>/100</span>
            </div>
            <p style={styles.scoreDesc}>
              {analysisResult.score > 80
                ? "This competitor is highly optimized. Outranking them requires target metadata focus and FAQ schemas."
                : "This competitor has significant SEO flaws. You have a strong chance to outrank them easily."}
            </p>
          </div>

          {/* Weaknesses List */}
          <div style={styles.cardDetails}>
            <h3 style={styles.cardTitle}>Audited SEO Weaknesses</h3>
            <ul style={styles.list}>
              {analysisResult.weaknesses.map((w: string, idx: number) => (
                <li key={idx} style={styles.listItemWarning}>
                  <span style={styles.listIcon}>⚠️</span> {w}
                </li>
              ))}
            </ul>
          </div>

          {/* Keyword Gaps */}
          <div style={styles.cardDetails}>
            <h3 style={styles.cardTitle}>Identified Keyword Opportunities</h3>
            <ul style={styles.list}>
              {analysisResult.gaps.map((g: string, idx: number) => (
                <li key={idx} style={styles.listItemSuccess}>
                  <span style={styles.listIcon}>💡</span> {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
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
  inputCard: {
    backgroundColor: "#ffffff",
    padding: "24px",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    marginBottom: "24px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#4b5563",
    textTransform: "uppercase",
    marginBottom: "8px",
    display: "block",
  },
  inputRow: {
    display: "flex",
    gap: "12px",
  },
  input: {
    flex: 1,
    fontSize: "14px",
    padding: "12px 16px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    outline: "none",
  },
  btnPrimary: {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.2)",
    whiteSpace: "nowrap",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "24px",
  },
  cardScore: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    padding: "24px",
    textAlign: "center",
  },
  cardDetails: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    padding: "24px",
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 700,
    margin: "0 0 16px 0",
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
    paddingBottom: "12px",
  },
  scoreValue: {
    fontSize: "64px",
    fontWeight: 800,
    color: "#4f46e5",
    margin: "12px 0",
  },
  scoreMax: {
    fontSize: "20px",
    color: "#9ca3af",
    fontWeight: 500,
  },
  scoreDesc: {
    fontSize: "13px",
    color: "#4b5563",
    lineHeight: "1.5",
    margin: "8px 0 0 0",
  },
  list: {
    padding: 0,
    margin: 0,
    listStyle: "none",
  },
  listItemWarning: {
    fontSize: "13px",
    color: "#b45309",
    backgroundColor: "#fffbeb",
    padding: "12px 14px",
    borderRadius: "8px",
    marginBottom: "10px",
    lineHeight: "1.4",
  },
  listItemSuccess: {
    fontSize: "13px",
    color: "#047857",
    backgroundColor: "#ecfdf5",
    padding: "12px 14px",
    borderRadius: "8px",
    marginBottom: "10px",
    lineHeight: "1.4",
  },
  listIcon: {
    marginRight: "6px",
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 0",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "4px solid #cbd5e1",
    borderTop: "4px solid #4f46e5",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loadingText: {
    fontSize: "14px",
    color: "#4b5563",
    fontWeight: 500,
    marginTop: "16px",
  },
};
