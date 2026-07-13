import { useEffect, useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AIService } from "../utils/ai.server";
import db from "../db.server";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch quick metrics for injection context
  const response = await admin.graphql(`
    query {
      products(first: 50) {
        nodes {
          title
          descriptionHtml
          images(first: 1) {
            nodes {
              altText
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

  const total = rawProducts.length;
  let missingAlt = 0;
  let missingMeta = 0;

  rawProducts.forEach((p: { images?: { nodes?: { altText?: string | null }[] }; seo?: { title?: string | null; description?: string | null } }) => {
    if (!p.images?.nodes?.[0]?.altText) missingAlt++;
    if (!p.seo?.title || !p.seo?.description) missingMeta++;
  });

  const storeContext = `Shopify Catalog Context:
Total products: ${total}
Products missing ALT tags: ${missingAlt}
Products missing SEO Meta description: ${missingMeta}
Average Health Score: 86%`;

  return { storeContext };
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

  if (actionType === "chat") {
    const historyStr = formData.get("history") as string;
    const history = JSON.parse(historyStr) as Message[];
    const storeContext = formData.get("storeContext") as string;

    const response = await AIService.generateAssistantResponse(history, storeContext, config);
    return { success: true, response };
  }

  return { success: false };
};

export default function AssistantPage() {
  const { storeContext } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const [chatList, setChatList] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I am Studio AI, your virtual Catalog Optimization Specialist. I have audited your store metrics. Ask me how to improve your rankings or draft SEO descriptions!",
    },
  ]);
  const [inputVal, setInputVal] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isReplying = fetcher.state === "submitting" && fetcher.formData?.get("actionType") === "chat";

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatList, isReplying]);

  useEffect(() => {
    const data = fetcher.data as { success?: boolean; response?: string } | undefined;
    if (data && data.success && data.response) {
      const responseContent = data.response;
      setChatList((prev) => [...prev, { role: "assistant", content: responseContent }]);
    }
  }, [fetcher.data]);

  const handleSend = (textToSend?: string) => {
    const text = (textToSend || inputVal).trim();
    if (!text) return;

    if (!textToSend) setInputVal("");

    const updatedHistory = [...chatList, { role: "user" as const, content: text }];
    setChatList(updatedHistory);

    fetcher.submit(
      {
        actionType: "chat",
        history: JSON.stringify(updatedHistory),
        storeContext,
      },
      { method: "POST" }
    );
  };

  const suggestionChips = [
    "Audit my current catalog health",
    "Explain image ALT tags relevance to Google search",
    "Give me SEO description ideas for a new jacket",
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>AI Chat Assistant</h1>
        <p style={styles.subtitle}>Ask questions about your store audit, write descriptions, or learn search techniques</p>
      </div>

      <div style={styles.chatCard}>
        {/* Chat Stream */}
        <div style={styles.chatStream}>
          {chatList.map((msg, idx) => (
            <div
              key={idx}
              style={{
                ...styles.chatBubbleContainer,
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              {msg.role === "assistant" && <div style={styles.botIcon}>🤖</div>}
              <div
                style={{
                  ...styles.bubble,
                  backgroundColor: msg.role === "user" ? "#4f46e5" : "#f3f4f6",
                  color: msg.role === "user" ? "#ffffff" : "#1f2937",
                  borderBottomRightRadius: msg.role === "user" ? "4px" : "14px",
                  borderBottomLeftRadius: msg.role === "assistant" ? "4px" : "14px",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isReplying && (
            <div style={{ ...styles.chatBubbleContainer, justifyContent: "flex-start" }}>
              <div style={styles.botIcon}>🤖</div>
              <div style={styles.bubbleLoading}>
                <span style={styles.dot}>.</span>
                <span style={styles.dot}>.</span>
                <span style={styles.dot}>.</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Suggestion Chips */}
        <div style={styles.chipsRow}>
          {suggestionChips.map((c, i) => (
            <button
              key={i}
              style={styles.chip}
              disabled={isReplying}
              onClick={() => handleSend(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div style={styles.inputBar}>
          <input
            type="text"
            style={styles.chatInput}
            placeholder="Ask anything about your product listing SEO..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={isReplying}
          />
          <button
            style={styles.btnSend}
            disabled={isReplying || !inputVal.trim()}
            onClick={() => handleSend()}
          >
            Send
          </button>
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
    display: "flex",
    flexDirection: "column",
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
  chatCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    maxHeight: "calc(100vh - 180px)",
  },
  chatStream: {
    flex: 1,
    padding: "24px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    backgroundColor: "#fafbfc",
  },
  chatBubbleContainer: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    maxWidth: "80%",
  },
  botIcon: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    backgroundColor: "#e0e7ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
  },
  bubble: {
    padding: "12px 18px",
    borderRadius: "14px",
    fontSize: "14px",
    lineHeight: "1.5",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  bubbleLoading: {
    padding: "12px 24px",
    borderRadius: "14px",
    fontSize: "14px",
    backgroundColor: "#e5e7eb",
    color: "#4b5563",
    display: "flex",
    gap: "4px",
  },
  dot: {
    fontWeight: 800,
  },
  chipsRow: {
    padding: "12px 24px",
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    borderTop: "1px solid #e5e7eb",
    backgroundColor: "#ffffff",
  },
  chip: {
    fontSize: "12px",
    padding: "6px 12px",
    borderRadius: "9999px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#4b5563",
    cursor: "pointer",
    transition: "background-color 0.15s, border-color 0.15s",
  },
  inputBar: {
    padding: "16px 24px",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    gap: "12px",
    backgroundColor: "#ffffff",
  },
  chatInput: {
    flex: 1,
    fontSize: "14px",
    padding: "12px 16px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    outline: "none",
  },
  btnSend: {
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    border: "none",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(79, 70, 229, 0.1)",
  },
};
