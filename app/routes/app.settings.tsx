import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface SettingsActionData {
  success?: boolean;
  settingsSaved?: boolean;
  planChanged?: boolean;
  plan?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.appSettings.findUnique({
    where: { shop },
  });
  
  return {
    apiKey: settings?.apiKey || "",
    provider: settings?.provider || "mock",
    defaultTone: settings?.defaultTone || "fashion",
    activePlan: settings?.activePlan || "free",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "saveSettings") {
    const apiKey = formData.get("apiKey") as string;
    const provider = formData.get("provider") as string;
    const defaultTone = formData.get("defaultTone") as string;

    await db.appSettings.upsert({
      where: { shop },
      update: { apiKey, provider, defaultTone },
      create: { shop, apiKey, provider, defaultTone },
    });

    return { success: true, settingsSaved: true };
  }

  if (actionType === "changePlan") {
    const plan = formData.get("plan") as string;
    await db.appSettings.upsert({
      where: { shop },
      update: { activePlan: plan },
      create: { shop, activePlan: plan },
    });
    return { success: true, planChanged: true, plan };
  }

  return { success: false };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [apiKey, setApiKey] = useState(data.apiKey);
  const [provider, setProvider] = useState(data.provider);
  const [defaultTone, setDefaultTone] = useState(data.defaultTone);
  const [activePlan, setActivePlan] = useState(data.activePlan);

  useEffect(() => {
    if (fetcher.data && "settingsSaved" in fetcher.data) {
      shopify.toast.show("Configuration saved successfully!");
    }
    if (fetcher.data && "planChanged" in fetcher.data) {
      const p = (fetcher.data as SettingsActionData).plan;
      if (p) {
        shopify.toast.show(`Mock Upgrade: Switched to ${p.toUpperCase()} Plan!`);
        setActivePlan(p);
      }
    }
  }, [fetcher.data, shopify]);

  const handleSaveSettings = () => {
    fetcher.submit(
      {
        actionType: "saveSettings",
        apiKey,
        provider,
        defaultTone,
      },
      { method: "POST" }
    );
  };

  const handleUpgradePlan = (plan: string) => {
    fetcher.submit(
      {
        actionType: "changePlan",
        plan,
      },
      { method: "POST" }
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>System Control & Billing</h1>
        <p style={styles.subtitle}>Configure API tokens, writing preferences, and manage subscription pricing models</p>
      </div>

      <div style={styles.mainGrid}>
        {/* Left Col: Setup & Config */}
        <div style={styles.leftCol}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>AI Provider Integration</h3>
            <p style={styles.cardDesc}>Connect your own AI credentials or keep Mock Mode enabled for sandbox testing.</p>
            
            <div style={styles.field}>
              <label style={styles.label} htmlFor="provider-select">AI Processor Provider</label>
              <select style={styles.select} id="provider-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="mock">Mock / Sandbox Mode (No Key Needed)</option>
                <option value="gemini">Google Gemini AI</option>
                <option value="openai">OpenAI (GPT-4o)</option>
              </select>
            </div>

            {provider !== "mock" && (
              <div style={styles.field}>
                <label style={styles.label} htmlFor="api-key-input">API Authentication Token</label>
                <input
                  id="api-key-input"
                  type="password"
                  style={styles.input}
                  placeholder="Enter your API secret key..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <small style={styles.hint}>
                  Your key is stored securely in your app session. It is only used to send prompts to the provider.
                </small>
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label} htmlFor="tone-preference-select">Default Writing Preference (Tone)</label>
              <select style={styles.select} id="tone-preference-select" value={defaultTone} onChange={(e) => setDefaultTone(e.target.value)}>
                <option value="fashion">Casual / Fashion (Informative, warm)</option>
                <option value="luxury">Luxury / Premium (Elegant, elite, descriptive)</option>
                <option value="electronics">Electronics / Tech (Detailed specifications, active voice)</option>
                <option value="sports">Sports / Performance (Energetic, durability-focused)</option>
                <option value="beauty">Beauty / Cosmetic (Rejuvenating, skin-benefit oriented)</option>
                <option value="medical">Medical / Health (Formal, safety-certified focus)</option>
              </select>
            </div>

            <button style={styles.saveBtn} onClick={handleSaveSettings}>
              Save Integration Settings
            </button>
          </div>
        </div>

        {/* Right Col: Plans */}
        <div style={styles.rightCol}>
          <div style={styles.plansHeader}>
            <h3 style={styles.cardTitle}>SaaS Pricing Plans</h3>
            <p style={styles.cardDesc}>Choose a plan that fits your catalogue size. Credits refresh monthly.</p>
          </div>

          <div style={styles.plansGrid}>
            {/* Plan 1 */}
            <div style={{
              ...styles.planCard,
              border: activePlan === "free" ? "2.5px solid #4f46e5" : "1px solid #e5e7eb",
              transform: activePlan === "free" ? "scale(1.02)" : "none"
            }}>
              {activePlan === "free" && <div style={styles.activeLabel}>Current Plan</div>}
              <div style={styles.planName}>Free</div>
              <div style={styles.planPrice}>$0<span style={styles.planPeriod}>/mo</span></div>
              <ul style={styles.features}>
                <li>20 AI Credits / month</li>
                <li>Single Product Optimize</li>
                <li>Standard Support</li>
              </ul>
              <button
                style={{
                  ...styles.planBtn,
                  backgroundColor: activePlan === "free" ? "#e0e7ff" : "#4f46e5",
                  color: activePlan === "free" ? "#312e81" : "#ffffff",
                }}
                disabled={activePlan === "free"}
                onClick={() => handleUpgradePlan("free")}
              >
                {activePlan === "free" ? "Active" : "Downgrade"}
              </button>
            </div>

            {/* Plan 2 */}
            <div style={{
              ...styles.planCard,
              border: activePlan === "starter" ? "2.5px solid #4f46e5" : "1px solid #e5e7eb",
              transform: activePlan === "starter" ? "scale(1.02)" : "none"
            }}>
              {activePlan === "starter" && <div style={styles.activeLabel}>Current Plan</div>}
              <div style={styles.planName}>Starter</div>
              <div style={styles.planPrice}>$9<span style={styles.planPeriod}>/mo</span></div>
              <ul style={styles.features}>
                <li>200 AI Credits / month</li>
                <li>Bulk Optimize (50/run)</li>
                <li>Alt Tags + FAQ Generat.</li>
              </ul>
              <button
                style={{
                  ...styles.planBtn,
                  backgroundColor: activePlan === "starter" ? "#e0e7ff" : "#4f46e5",
                  color: activePlan === "starter" ? "#312e81" : "#ffffff",
                }}
                disabled={activePlan === "starter"}
                onClick={() => handleUpgradePlan("starter")}
              >
                {activePlan === "starter" ? "Active" : "Select Starter"}
              </button>
            </div>

            {/* Plan 3 */}
            <div style={{
              ...styles.planCard,
              border: activePlan === "growth" ? "2.5px solid #4f46e5" : "1px solid #e5e7eb",
              transform: activePlan === "growth" ? "scale(1.02)" : "none"
            }}>
              {activePlan === "growth" && <div style={styles.activeLabel}>Current Plan</div>}
              <div style={styles.planName}>Growth</div>
              <div style={styles.planPrice}>$29<span style={styles.planPeriod}>/mo</span></div>
              <ul style={styles.features}>
                <li>1,000 AI Credits / month</li>
                <li>Bulk Optimize (200/run)</li>
                <li>Priority Queue Support</li>
              </ul>
              <button
                style={{
                  ...styles.planBtn,
                  backgroundColor: activePlan === "growth" ? "#e0e7ff" : "#4f46e5",
                  color: activePlan === "growth" ? "#312e81" : "#ffffff",
                }}
                disabled={activePlan === "growth"}
                onClick={() => handleUpgradePlan("growth")}
              >
                {activePlan === "growth" ? "Active" : "Select Growth"}
              </button>
            </div>

            {/* Plan 4 */}
            <div style={{
              ...styles.planCard,
              border: activePlan === "pro" ? "2.5px solid #4f46e5" : "1px solid #e5e7eb",
              transform: activePlan === "pro" ? "scale(1.02)" : "none"
            }}>
              {activePlan === "pro" && <div style={styles.activeLabel}>Current Plan</div>}
              <div style={styles.planName}>Pro</div>
              <div style={styles.planPrice}>$79<span style={styles.planPeriod}>/mo</span></div>
              <ul style={styles.features}>
                <li>5,000 AI Credits / month</li>
                <li>Bulk Optimize (Unlimited)</li>
                <li>Automated SEO Schedule</li>
              </ul>
              <button
                style={{
                  ...styles.planBtn,
                  backgroundColor: activePlan === "pro" ? "#e0e7ff" : "#4f46e5",
                  color: activePlan === "pro" ? "#312e81" : "#ffffff",
                }}
                disabled={activePlan === "pro"}
                onClick={() => handleUpgradePlan("pro")}
              >
                {activePlan === "pro" ? "Active" : "Select Pro"}
              </button>
            </div>
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
    marginBottom: "32px",
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
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.5fr",
    gap: "32px",
    alignItems: "start",
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  rightCol: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    padding: "24px",
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
    margin: "0 0 8px 0",
  },
  cardDesc: {
    fontSize: "13px",
    color: "#6b7280",
    margin: "0 0 20px 0",
    lineHeight: "1.4",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "20px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#374151",
    textTransform: "uppercase",
  },
  select: {
    fontSize: "14px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    width: "100%",
  },
  input: {
    fontSize: "14px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    width: "100%",
  },
  hint: {
    fontSize: "11px",
    colorScheme: "dark",
    color: "#6b7280",
    lineHeight: "1.3",
    marginTop: "2px",
  },
  saveBtn: {
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
    marginTop: "10px",
  },
  plansHeader: {
    marginBottom: "24px",
  },
  plansGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "20px",
  },
  planCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    transition: "border 0.2s, transform 0.2s",
  },
  activeLabel: {
    position: "absolute",
    top: "-12px",
    right: "16px",
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: "9999px",
    boxShadow: "0 2px 4px rgba(79, 70, 229, 0.2)",
  },
  planName: {
    fontSize: "16px",
    fontWeight: 700,
    marginBottom: "8px",
  },
  planPrice: {
    fontSize: "32px",
    fontWeight: 800,
    marginBottom: "16px",
  },
  planPeriod: {
    fontSize: "14px",
    color: "#6b7280",
    fontWeight: 500,
  },
  features: {
    paddingLeft: "20px",
    margin: "0 0 24px 0",
    fontSize: "12px",
    color: "#4b5563",
    lineHeight: "2",
  },
  planBtn: {
    border: "none",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    marginTop: "auto",
    transition: "background-color 0.2s",
  },
};
