import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { simpleParser } from "npm:mailparser@3.6.5";
import OpenAI from "npm:openai@4.20.1";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID")!;
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") || "us-east-1";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET = "mailpocket-email";

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Max-Age": "86400",
};

const MODEL = "gpt-4o-mini";
const PROMPT = `
# 요약
- 당신은 긴 뉴스 기사를 요약하여 사람들에게 전달하는 기자이자 아나운서의 역할을 맡고 있습니다. 제시되는 뉴스 기사들의 핵심 내용을 요약하여 주세요. 요약된 내용은 기사의 주요 사건, 그 사건의 영향 및 결과, 그리고 그 사건의 장기적 중요성을 포함해야 합니다.
- 주제목은 해당 기사의 소식을 한줄 요약 합니다.
- 내용은 각 기사별로 3문장으로 구성되어야 하며, 서론, 본론, 결론의 구조로 명확히 구분되어야 합니다. 각 내용은 기사의 주제에 맞는 내용만 다루어야합니다.
- 현재형을 사용하고, 직접적인 말투보다는 설명적이고 객관적인 표현을 사용합니다.
- '논란이 있다'과 같은 표현을 '논란이 있습니다'로 변경하여, 문장을 더 공식적이고 완결된 형태로 마무리합니다.
- 개별 문장 내에서, 사실을 전달하는 동시에 적절한 예의를 갖추어 표현하며, 독자에게 정보를 제공하는 것이 목적임을 분명히 합니다.

# 출력
- 답변을 JSON 형식으로 정리하여 제출해야 합니다. 이때, 각 주제목을 Key로, 내용을 Value로 해야합니다.
- JSON 답변시 "중첩된(nested) JSON" 혹은 "계층적(hierarchical) JSON" 구조를 절대로 사용하지 마세요.
- "주제", "내용" 등 단순한 주제목을 절대로 사용하지마세요.
`;

serve(async (req) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // GET /mail?key=xxx - Get mail by s3_object_key
    if (method === "GET" && path.endsWith("/mail")) {
      const key = url.searchParams.get("key");

      if (!key) {
        return new Response(JSON.stringify({ error: "key parameter is required" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        });
      }

      // Get mail from database with newsletter name
      const { data: mail, error: mailError } = await supabase
        .from("mail")
        .select(`
          *,
          newsletter:newsletter_id(name)
        `)
        .eq("s3_object_key", key)
        .single();

      if (mailError || !mail) {
        return new Response(JSON.stringify({ error: "Mail not found" }), {
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 404,
        });
      }

      // Use html_body from database if available, otherwise download from S3 (backward compatibility)
      let htmlBody: string;
      if (mail.html_body) {
        htmlBody = mail.html_body;
      } else {
        // Fallback: Download from S3 for older records without html_body
        try {
          const result = await s3.send(
            new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: key,
            })
          );

          if (!result.Body) {
            return new Response(JSON.stringify({ error: "Failed to download email file: Empty response" }), {
              headers: { 
                "Content-Type": "application/json",
                ...corsHeaders,
              },
              status: 404,
            });
          }

          const emailContent = await result.Body.transformToString();
          const parsed = await simpleParser(emailContent);
          htmlBody = parsed.html || parsed.textAsHtml || "";
        } catch (error) {
          console.error("Failed to download email from S3:", error);
          return new Response(
            JSON.stringify({ error: `Failed to download email file: ${error instanceof Error ? error.message : "Unknown error"}` }),
            {
              headers: { 
                "Content-Type": "application/json",
                ...corsHeaders,
              },
              status: 404,
            }
          );
        }
      }

      // Extract newsletter name and add to response
      const newsletterName = mail.newsletter?.name || null;
      const { newsletter, ...mailData } = mail;

      return new Response(JSON.stringify({ ...mailData, name: newsletterName, html_body: htmlBody }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 200,
      });
    }

    // PATCH /mail/summary-again?key=xxx - Re-summarize mail
    if (method === "PATCH" && path.endsWith("/mail/summary-again")) {
      const key = url.searchParams.get("key");

      if (!key) {
        return new Response(JSON.stringify({ error: "key parameter is required" }), {
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        });
      }

      // Get mail from database
      const { data: mail, error: mailError } = await supabase
        .from("mail")
        .select("*")
        .eq("s3_object_key", key)
        .single();

      if (mailError || !mail) {
        return new Response(JSON.stringify({ error: "Mail not found" }), {
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 404,
        });
      }

      // Download email content from AWS S3
      let emailContent: string;
      try {
        const result = await s3.send(
          new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
          })
        );

        if (!result.Body) {
          return new Response(JSON.stringify({ error: "Failed to download email file: Empty response" }), {
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders,
            },
            status: 404,
          });
        }

        emailContent = await result.Body.transformToString();
      } catch (error) {
        console.error("Failed to download email from S3:", error);
        return new Response(
          JSON.stringify({ error: `Failed to download email file: ${error instanceof Error ? error.message : "Unknown error"}` }),
          {
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders,
            },
            status: 404,
          }
        );
      }
      const parsed = await simpleParser(emailContent);
      const htmlBody = parsed.html || parsed.textAsHtml || "";

      // Generate new summary
      const summaryList = await generateSummary(htmlBody);

      // Update mail summary
      const { error: updateError } = await supabase
        .from("mail")
        .update({ summary_list: summaryList })
        .eq("s3_object_key", key);

      if (updateError) throw updateError;

      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      headers: { 
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      status: 404,
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
});

function parsingHtmlText(html: string): string {
  const $ = cheerio.load(html);
  const text = $("body").text();
  const stripText = text.trim();
  const replaceText = stripText.replace(/\n/g, "");
  return replaceText;
}

async function generateSummary(html: string): Promise<Record<string, string>> {
  for (let i = 0; i < 3; i++) {
    try {
      const htmlText = parsingHtmlText(html);
      const response = await openai.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: `뉴스:${htmlText}` },
        ],
        temperature: 0,
      });

      let content = response.choices[0].message.content || "";

      if (content.includes("```json")) {
        content = content.split("```json")[1].split("```")[0];
        content = content.replace(/{/g, "").replace(/}/g, "");
        content = "{" + content + "}";
      }

      const summaryList = JSON.parse(content);

      // Validate format
      for (const value of Object.values(summaryList)) {
        if (typeof value !== "string") {
          throw new Error("Invalid summary format");
        }
      }

      if (Object.keys(summaryList).length === 0) {
        throw new Error("Empty summary");
      }

      return summaryList;
    } catch (error) {
      console.error(`Summary attempt ${i + 1} failed:`, error);
      if (i === 2) {
        return { "요약을 실패했습니다.": "본문을 확인해주세요." };
      }
    }
  }

  return { "요약을 실패했습니다.": "본문을 확인해주세요." };
}

