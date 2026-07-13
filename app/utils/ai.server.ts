/**
 * AI Store Studio - AI content generation & health scoring utility
 */

export interface AIConfig {
  apiKey?: string;
  provider?: string;
}

export interface ProductInput {
  id: string;
  title: string;
  descriptionHtml: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  images?: { id: string; src: string; altText?: string | null }[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface HealthScoreResult {
  score: number; // 0-100
  details: {
    titleOk: boolean;
    descriptionOk: boolean;
    hasImages: boolean;
    imagesHaveAlt: boolean;
    hasTags: boolean;
    hasSeo: boolean;
    missingCount: number;
    issues: string[];
  };
}

export class AIService {
  /**
   * Computes the content health score of a Shopify product
   */
  static calculateHealthScore(product: ProductInput): HealthScoreResult {
    const issues: string[] = [];
    let score = 100;

    const titleLength = product.title?.length || 0;
    const titleOk = titleLength >= 10 && titleLength <= 70;
    if (!titleOk) {
      if (titleLength === 0) {
        issues.push("Product title is empty");
        score -= 20;
      } else if (titleLength < 10) {
        issues.push("Title is too short (should be at least 10 chars)");
        score -= 5;
      } else {
        issues.push("Title is too long (over 70 chars, might be cut off in search engines)");
        score -= 5;
      }
    }

    // Strip HTML tags to measure raw text length
    const plainDescription = product.descriptionHtml ? product.descriptionHtml.replace(/<[^>]*>/g, "").trim() : "";
    const descriptionOk = plainDescription.length >= 100;
    if (!descriptionOk) {
      if (plainDescription.length === 0) {
        issues.push("Missing product description");
        score -= 30;
      } else {
        issues.push("Description is too brief (should be at least 100 chars for good SEO)");
        score -= 15;
      }
    }

    const hasImages = (product.images?.length ?? 0) > 0;
    let imagesHaveAlt = true;
    if (!hasImages) {
      issues.push("No product images found");
      score -= 20;
      imagesHaveAlt = false;
    } else {
      const missingAltCount = product.images!.filter((img) => !img.altText || img.altText.trim() === "").length;
      if (missingAltCount > 0) {
        issues.push(`${missingAltCount} image(s) missing SEO Alt Text`);
        score -= Math.min(missingAltCount * 5, 15);
        imagesHaveAlt = false;
      }
    }

    const hasTags = (product.tags?.length ?? 0) > 0;
    if (!hasTags) {
      issues.push("No product tags defined (helps search and collection sorting)");
      score -= 5;
    }

    const hasSeo = !!(product.seoTitle && product.seoDescription);
    if (!hasSeo) {
      issues.push("Custom SEO Title or Meta Description is missing");
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      details: {
        titleOk,
        descriptionOk,
        hasImages,
        imagesHaveAlt,
        hasTags,
        hasSeo,
        missingCount: issues.length,
        issues,
      },
    };
  }

  /**
   * Mock / Real LLM Call helper
   */
  private static async generateText(prompt: string, config?: AIConfig): Promise<string> {
    const provider = config?.provider || "mock";
    if (provider === "mock") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return "";
    }

    const key = config?.apiKey;
    if (!key) {
      // Simulate slight delay for AI processing
      await new Promise((resolve) => setTimeout(resolve, 800));
      return ""; // Fallback to mock behavior in calling functions if key is empty
    }

    try {
      if (provider === "openai") {
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              ...(prompt.includes("JSON") ? { response_format: { type: "json_object" } } : {}),
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const result = await response.json();
        return result.choices?.[0]?.message?.content || "";
      }

      // Default: Google Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(prompt.includes("JSON")
              ? {
                  generationConfig: {
                    responseMimeType: "application/json",
                  },
                }
              : {}),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
      console.error("AI Generation failed:", error);
      return ""; // Fallback
    }
  }

  /**
   * Generates SEO Title & Meta Description
   */
  static async generateSEO(
    title: string,
    description: string,
    config?: AIConfig
  ): Promise<{ seoTitle: string; seoDescription: string }> {
    const prompt = `
      You are an expert Shopify SEO Specialist. Write an optimized SEO Title (max 60 chars) and Meta Description (max 155 chars) for the following product:
      Title: "${title}"
      Description: "${description.replace(/<[^>]*>/g, "")}"

      Provide the result in JSON format with keys "seoTitle" and "seoDescription" exactly. Do not include markdown code block syntax.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult) {
      try {
        const cleanedJson = aiResult.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);
        if (parsed.seoTitle && parsed.seoDescription) {
          return parsed;
        }
      } catch (e) {
        console.error("Failed to parse AI SEO response:", e);
      }
    }

    // Mock/Fallback logic
    return {
      seoTitle: `${title} | Premium Quality Store`,
      seoDescription: `Buy our ${title} today! Made with top grade materials. Fast shipping and 100% satisfaction guaranteed. Shop now!`,
    };
  }

  /**
   * Generates AI Product Description in selected tone
   */
  static async generateDescription(
    title: string,
    originalDesc: string,
    tone: string = "fashion",
    config?: AIConfig
  ): Promise<string> {
    const prompt = `
      You are a professional copywriter. Rewrite the following product description in a "${tone}" tone.
      Ensure the description is engaging, lists benefits, and is structured with paragraphs and an unordered list of key features.
      Product Title: "${title}"
      Current Brief: "${originalDesc.replace(/<[^>]*>/g, "")}"

      Return only the formatted HTML content (paragraphs and lists only). Do not wrap in markdown code blocks.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult && aiResult.trim().length > 0) {
      return aiResult.trim();
    }

    switch (tone.toLowerCase()) {
      case "luxury":
        return `<p>Experience the epitome of luxury with our premium <strong>${title}</strong>. Meticulously crafted from the finest materials, this exquisite piece brings sophistication and timeless elegance to your daily life.</p>
<ul>
  <li>Hand-selected elite craftsmanship</li>
  <li>Artisanal design tailored for excellence</li>
  <li>Premium materials offering unparalleled quality</li>
</ul>`;
      case "medical":
        return `<p>Our clinically-designed <strong>${title}</strong> offers reliable, high-grade support. Formulated and tested for safety, comfort, and efficacy, it is the perfect solution for health-conscious individuals.</p>
<ul>
  <li>Clinically tested and hypoallergenic</li>
  <li>Designed by industry professionals</li>
  <li>Focus on safety, durability, and health integration</li>
</ul>`;
      case "electronics":
        return `<p>Elevate your tech setup with the cutting-edge <strong>${title}</strong>. Engineered for peak performance, high efficiency, and seamless compatibility, it's designed to keep you ahead in a digital world.</p>
<ul>
  <li>Next-gen high speed performance</li>
  <li>Energy efficient and heat optimized</li>
  <li>Plug-and-play universal compatibility</li>
</ul>`;
      case "beauty":
        return `<p>Reveal your natural radiance with the rejuvenating <strong>${title}</strong>. Infused with nourishing elements, it enhances health and instills immediate freshness for a beautiful, glowing result.</p>
<ul>
  <li>Deep hydration and vitalizing formula</li>
  <li>100% cruelty-free, gentle on all skin types</li>
  <li>Fast-absorbing and long-lasting glow</li>
</ul>`;
      case "sports":
        return `<p>Boost your athletic limits with the high-performance <strong>${title}</strong>. Engineered for maximum flexibility, breathability, and durability, it keeps you dry, fast, and protected under intense conditions.</p>
<ul>
  <li>Advanced moisture-wicking technology</li>
  <li>Ultra-lightweight materials for speed</li>
  <li>Ergonomic fit reducing fatigue</li>
</ul>`;
      default: // fashion/casual
        return `<p>Introducing our premium <strong>${title}</strong>, designed for everyday comfort and modern style. Featuring a soft finish, breathable fabric, and a comfortable regular fit, it's a perfect addition to your casual wardrobe.</p>
<ul>
  <li>Breathable fabric designed for all-day wear</li>
  <li>Reinforced stitching for maximum durability</li>
  <li>Modern fit that pairs easily with any casual look</li>
</ul>`;
    }
  }

  /**
   * Generates Alt text for an image
   */
  static async generateAltText(productTitle: string, imageIndex: number, config?: AIConfig): Promise<string> {
    // Note: To do real vision analysis we would need image URLs, but for a fast text-fallback or mock,
    // we can use a highly optimized pattern that search engines love.
    const prompt = `
      Create a descriptive SEO Alt Text for image #${imageIndex + 1} of the product "${productTitle}".
      Keep it descriptive, natural-sounding, and under 125 characters. Include product type details.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult && aiResult.trim().length > 0) {
      return aiResult.trim().replace(/"/g, "");
    }

    const views = ["Front View", "Detail View", "Angle View", "Model Shot"];
    const view = views[imageIndex % views.length];
    return `${productTitle} - ${view} showing fabric detail and design characteristics`;
  }

  /**
   * Generates FAQs for a product
   */
  static async generateFAQs(title: string, description: string, config?: AIConfig): Promise<{ q: string; a: string }[]> {
    const prompt = `
      Generate 2 helpful FAQs (Frequently Asked Questions) for the following product:
      Product: "${title}"
      Description: "${description.replace(/<[^>]*>/g, "")}"

      Provide the result in JSON array format containing objects with keys "q" and "a". Do not use markdown blocks.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult) {
      try {
        const cleanedJson = aiResult.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 2);
        }
      } catch (e) {
        console.error("Failed to parse FAQ response:", e);
      }
    }

    return [
      {
        q: `Is the ${title} suitable for daily use?`,
        a: `Yes! The ${title} is specifically built from durable materials to ensure long-lasting quality and daily comfort.`,
      },
      {
        q: `What is the warranty or return policy for this product?`,
        a: `We offer a 30-day hassle-free return policy if you are not fully satisfied with your purchase.`,
      },
    ];
  }

  /**
   * Generates product tags based on title and description
   */
  static async generateTags(title: string, description: string, config?: AIConfig): Promise<string[]> {
    const prompt = `
      Analyze the following product details and generate 5 highly relevant Shopify search tags.
      Product: "${title}"
      Description: "${description.replace(/<[^>]*>/g, "")}"

      Provide the result as a JSON array of strings only. Do not use markdown blocks.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult) {
      try {
        const cleanedJson = aiResult.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);
        if (Array.isArray(parsed)) {
          return parsed.map((t) => String(t).trim());
        }
      } catch (e) {
        console.error("Failed to parse tags response:", e);
      }
    }

    // Fallback/Mock tags
    const words = (title + " " + description.replace(/<[^>]*>/g, ""))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const uniqueWords = Array.from(new Set(words)).slice(0, 5);
    return uniqueWords.length > 0 ? uniqueWords : ["premium", "imported", "featured"];
  }

  /**
   * Translates content to target language
   */
  static async translateContent(text: string, targetLanguage: string, config?: AIConfig): Promise<string> {
    const prompt = `
      Translate the following HTML or text content into ${targetLanguage}. Keep all HTML tags intact exactly.
      Content: "${text}"

      Return only the translated content. Do not add warnings, intro, or markdown blocks.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult && aiResult.trim().length > 0) {
      return aiResult.trim();
    }

    // Fallback/Mock translation
    return `[Translated to ${targetLanguage}]: ${text}`;
  }

  /**
   * Generates Blog post content
   */
  static async generateArticle(
    blogTitle: string,
    keywords: string,
    tone: string = "fashion",
    config?: AIConfig
  ): Promise<string> {
    const prompt = `
      Write a professional, engaging, SEO-optimized blog article based on the following:
      Title: "${blogTitle}"
      Focus Keywords: "${keywords}"
      Writing Tone: "${tone}"

      Provide the output as rich HTML content containing paragraphs, subheadings (h3/h4), and list elements. Do not include markdown code block wraps.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult && aiResult.trim().length > 0) {
      return aiResult.trim();
    }

    // Mock blog post template
    return `<h3>Unlocking the Secrets of ${blogTitle}</h3>
<p>In today's fast-paced environment, keeping up with trends is essential. That's where focus keywords like <strong>${keywords}</strong> come into play, helping you build better traction and visibility.</p>
<h4>Key Highlights to Focus On</h4>
<ul>
  <li>Understanding consumer demand and relevance</li>
  <li>Optimizing structure and copy tone for better performance</li>
  <li>Consistently producing high-quality resource hubs</li>
</ul>
<p>By implementing these tips, you will immediately elevate your brand presence and user engagement levels.</p>`;
  }

  /**
   * Conversational store assistant response
   */
  static async generateAssistantResponse(
    chatHistory: { role: "user" | "assistant"; content: string }[],
    storeContext: string,
    config?: AIConfig
  ): Promise<string> {
    const historyPrompt = chatHistory
      .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
      .join("\n");

    const prompt = `
      You are "Studio AI", a smart Shopify SEO and Catalog Catalog Optimization Assistant.
      You have access to the following current store statistics context:
      ${storeContext}

      Respond to the user's latest query dynamically and helpfully. Keep your response brief (max 3-4 sentences), professional, and actionable.

      Conversation History:
      ${historyPrompt}

      Assistant Response:
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult && aiResult.trim().length > 0) {
      return aiResult.trim();
    }

    // Mock fallback response
    const lastUserMessage = chatHistory[chatHistory.length - 1]?.content.toLowerCase() || "";
    if (lastUserMessage.includes("health") || lastUserMessage.includes("score")) {
      return "Based on your store analytics, your catalog currently averages an 86% SEO health rating. I recommend prioritizing optimization on items missing image ALT tags to boost your ranking quickly.";
    }
    return "Hello! I am Studio AI, your Shopify SEO specialist. I can analyze your catalog health scores, help you write descriptions, or draft blog posts. How can I help you grow your store today?";
  }

  /**
   * Competitor analysis benchmarking
   */
  static async generateCompetitorAnalysis(
    competitorDetails: string,
    config?: AIConfig
  ): Promise<{ score: number; weaknesses: string[]; gaps: string[] }> {
    const prompt = `
      Analyze the following competitor page details or product title:
      Competitor: "${competitorDetails}"

      Run an SEO Audit. Provide:
      1. An SEO score (0-100) representing their optimization level.
      2. 3 weaknesses or areas they missed.
      3. 2 search/keyword gaps where we can outrank them.

      Return the response in JSON format with keys "score" (number), "weaknesses" (array of strings), and "gaps" (array of strings). Do not use markdown blocks.
    `;

    const aiResult = await this.generateText(prompt, config);
    if (aiResult) {
      try {
        const cleanedJson = aiResult.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);
        if (typeof parsed.score === "number" && Array.isArray(parsed.weaknesses) && Array.isArray(parsed.gaps)) {
          return parsed;
        }
      } catch (e) {
        console.error("Failed to parse competitor analysis response:", e);
      }
    }

    // Mock benchmarking fallback
    return {
      score: 74,
      weaknesses: [
        "Product description lacks detail and is under 80 characters.",
        "Images do not have custom search-optimized ALT tags.",
        "Missing target schema definitions for product FAQs."
      ],
      gaps: [
        "Focus on keyword opportunities relating to sustainability and durability.",
        "Add standard Q&A accordions to outrank them on search snippet blocks."
      ]
    };
  }
}
