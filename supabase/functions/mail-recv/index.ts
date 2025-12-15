// supabase/functions/mail-recv/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai@4.20.1";
import { simpleParser } from "npm:mailparser@3.6.5";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";

// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SLACK_LOGGING_WEBHOOK = Deno.env.get("SLACK_LOGGING_CHANNEL_WEBHOOK_URL");
const SLACK_UNKNOWN_EMAIL_WEBHOOK = Deno.env.get("SLACK_UNKNOWN_EMAIL_ADDRESS_WEBHOOK_URL");
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID")!;
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") || "us-east-1";

// Constants
const OPENAI_MODEL = "gpt-4o-mini";
const MAX_SUMMARY_RETRIES = 3;
const S3_BUCKET = "mailpocket-email";
const BASE_URL = "https://mailpocket.shop";

const OPENAI_PROMPT = `
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

// Initialize clients
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

// Types
interface RequestBody {
  s3_object_key: string;
}

interface ParsedEmail {
  fromEmail: string;
  fromEmailAddress: string;
  fromName: string;
  subject: string;
  htmlBody: string;
}

interface NewsletterData {
  newsletter_id: number;
  newsletter: {
    name: string;
  };
}

interface MailData {
  id: number;
  s3_object_key: string;
  subject: string;
  summary_list: Record<string, string>;
}

interface ChannelData {
  slack_channel_id: string;
  webhook_url: string;
  team_name: string;
  user_id: number;
}

// Helper functions
function createCorsHeaders() {
  return {
          "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
}

function createErrorResponse(message: string, status: number) {
      return new Response(
    JSON.stringify({ error: message }),
    {
      headers: createCorsHeaders(),
      status,
    }
  );
}

function parseEmailFrom(fromText: string): { email: string; name: string } {
  const match = fromText.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return {
      email: match[2],
      name: match[1].replace(/"/g, ""),
    };
  }
  return {
    email: fromText,
    name: fromText,
  };
}

async function parseEmailContent(emailContent: string): Promise<ParsedEmail> {
  const parsed = await simpleParser(emailContent);
  const fromText = parsed.from?.text || "";
  const { email: fromEmailAddress, name: fromName } = parseEmailFrom(fromText);


  const html = parsed.html || parsed.textAsHtml || "";


  return {
    fromEmail: fromText,
    fromEmailAddress,
    fromName,
    subject: parsed.subject || "",
    htmlBody: parsed.html || parsed.textAsHtml || "",
  };
}

function extractHtmlText(html: string): string {
  const $ = cheerio.load(html);
  const text = $("body").text();
  return text.trim().replace(/\n/g, "");
}

function cleanJsonContent(content: string): string {
  if (content.includes("```json")) {
    const jsonPart = content.split("```json")[1].split("```")[0];
    return "{" + jsonPart.replace(/{/g, "").replace(/}/g, "") + "}";
  }
  return content;
}

function validateSummary(summaryList: Record<string, string>): void {
  if (Object.keys(summaryList).length === 0) {
    throw new Error("Empty summary");
  }

  for (const value of Object.values(summaryList)) {
    if (typeof value !== "string") {
      throw new Error("Invalid summary format");
    }
  }
}

async function generateSummary(html: string): Promise<Record<string, string>> {
  const htmlText = extractHtmlText(html);

  for (let attempt = 0; attempt < MAX_SUMMARY_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OPENAI_PROMPT },
          { role: "user", content: `뉴스:${htmlText}` },
        ],
        temperature: 0,
      });

      let content = response.choices[0].message.content || "";
      content = cleanJsonContent(content);
      const summaryList = JSON.parse(content) as Record<string, string>;

      validateSummary(summaryList);
      return summaryList;
    } catch (error) {
      console.error(`Summary attempt ${attempt + 1} failed:`, error);
      if (attempt === MAX_SUMMARY_RETRIES - 1) {
        return { "요약을 실패했습니다.": "본문을 확인해주세요." };
      }
    }
  }

  return { "요약을 실패했습니다.": "본문을 확인해주세요." };
}

async function sendSlackMessage(webhookUrl: string, blocks: any[]): Promise<void> {
  await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  }).catch((error) => {
    console.error("Failed to send Slack message:", error);
  });
}

async function logEmailToSlack(
  fromEmailAddress: string,
  fromName: string,
  subject: string,
  s3ObjectKey: string
): Promise<void> {
  if (!SLACK_LOGGING_WEBHOOK) return;

  const readLink = `${BASE_URL}/read?mail=${s3ObjectKey}`;
  await sendSlackMessage(SLACK_LOGGING_WEBHOOK, [
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
          text: `email : ${fromEmailAddress}\nid : ${fromName}\n*<${readLink}|${subject}>*`,
                },
              ],
            },
  ]);
}

async function logUnknownEmailToSlack(
  fromEmailAddress: string,
  fromName: string,
  subject: string,
  s3ObjectKey: string
): Promise<void> {
  if (!SLACK_UNKNOWN_EMAIL_WEBHOOK) return;

  await sendSlackMessage(SLACK_UNKNOWN_EMAIL_WEBHOOK, [
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
          text: `${fromEmailAddress}\nis unknown email address\n뉴스레터: ${fromName}\n제목: ${subject}\n링크: ${BASE_URL}/read?mail=${s3ObjectKey}\nS3 OBJ KEY: ${s3ObjectKey}`,
                  },
                ],
              },
  ]);
}

async function findNewsletterByEmail(
  emailAddress: string
): Promise<NewsletterData | null> {
  const { data, error } = await supabase
    .from("newsletter_email_addresses")
    .select("newsletter_id, newsletter:newsletter_id(*)")
    .eq("email_address", emailAddress)
    .single();

  if (error || !data) {
    return null;
  }

  return data as NewsletterData;
}

async function saveMail(
  s3ObjectKey: string,
  subject: string,
  summaryList: Record<string, string>,
  newsletterId: number,
  htmlBody: string
): Promise<MailData> {
  const { data, error } = await supabase
      .from("mail")
      .insert({
      s3_object_key: s3ObjectKey,
        subject,
        summary_list: summaryList,
        newsletter_id: newsletterId,
        html_body: htmlBody,
        recv_at: new Date().toISOString(),
      })
      .select()
      .single();

  if (error || !data) {
    throw new Error(`Failed to save mail: ${error?.message || "Unknown error"}`);
  }

  return data as MailData;
}

async function updateNewsletterLastRecvAt(newsletterId: number): Promise<void> {
    await supabase
      .from("newsletter")
      .update({ last_recv_at: new Date().toISOString() })
      .eq("id", newsletterId);
}

async function sendSlackNotifications(
  mail: MailData,
  newsletter: NewsletterData
): Promise<void> {
  // Get all users subscribed to this newsletter
    const { data: subscriptions } = await supabase
      .from("subscribe")
      .select("user_id")
    .eq("newsletter_id", newsletter.newsletter_id);

  if (!subscriptions || subscriptions.length === 0) {
    return;
  }

      const userIds = subscriptions.map((s) => s.user_id);
      
      // Get channels for these users
      const { data: channels } = await supabase
        .from("channel")
        .select("*")
        .in("user_id", userIds);

  if (!channels || channels.length === 0) {
    return;
  }

  // Send notifications to unique channels
        const notifiedChannelIds = new Set<string>();
  for (const channel of channels as ChannelData[]) {
    // Skip if no webhook URL (Slack not configured)
    if (!channel.webhook_url) {
      continue;
    }

    if (notifiedChannelIds.has(channel.slack_channel_id)) {
      continue;
    }
    notifiedChannelIds.add(channel.slack_channel_id);

    await sendSlackNotification(channel, mail, newsletter);
  }
}

async function sendSlackNotification(
  channel: ChannelData,
  mail: MailData,
  newsletter: NewsletterData
): Promise<void> {
  const utmSource = `&utm_source=slack&utm_medium=bot&utm_campaign=${channel.team_name}`;
  const readLink = `${BASE_URL}/read?mail=${mail.s3_object_key}${utmSource}`;

  const blocks: any[] = [
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `${newsletter.newsletter.name}의 새로운 소식이 도착했어요.\n*<${readLink}|${mail.subject}>*`,
        },
      ],
    },
  ];

  if (mail.summary_list) {
    for (const [subject, content] of Object.entries(mail.summary_list)) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${subject}*\n${content}`,
        },
      });
    }
  }

  await sendSlackMessage(channel.webhook_url, blocks);
}

// Main handler
serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
        },
      });
    }

    // Parse request body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch (error) {
      return createErrorResponse("Invalid JSON body", 400);
    }

    const { s3_object_key } = body;
    if (!s3_object_key) {
      return createErrorResponse("s3_object_key is required", 400);
    }

    // Download email from AWS S3
    let emailContent: string;
    try {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3_object_key,
        })
      );

      if (!result.Body) {
        return createErrorResponse("Failed to download email file: Empty response", 404);
      }

      emailContent = await result.Body.transformToString();
    } catch (error) {
      console.error("Failed to download email from S3:", error);
      return createErrorResponse(
        `Failed to download email file: ${error instanceof Error ? error.message : "Unknown error"}`,
        404
      );
    }

    // Parse email
    const parsedEmail = await parseEmailContent(emailContent);

    // Log email to Slack
    await logEmailToSlack(
      parsedEmail.fromEmailAddress,
      parsedEmail.fromName,
      parsedEmail.subject,
      s3_object_key
    );

    // Find newsletter by email address
    const newsletter = await findNewsletterByEmail(parsedEmail.fromEmailAddress);
    if (!newsletter) {
      await logUnknownEmailToSlack(
        parsedEmail.fromEmailAddress,
        parsedEmail.fromName,
        parsedEmail.subject,
        s3_object_key
      );
      return createErrorResponse(
        `Unknown from email: ${parsedEmail.fromEmailAddress}`,
        400
      );
    }

    // Generate summary using OpenAI
    const summaryList = await generateSummary(parsedEmail.htmlBody);

    // Save mail to database (including html_body for faster retrieval)
    const mail = await saveMail(
      s3_object_key,
      parsedEmail.subject,
      summaryList,
      newsletter.newsletter_id,
      parsedEmail.htmlBody
    );

    // Update newsletter last_recv_at
    await updateNewsletterLastRecvAt(newsletter.newsletter_id);

    // Send Slack notifications to subscribed channels
    await sendSlackNotifications(mail, newsletter);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Email received and processed successfully",
        mail_id: mail.id,
      }),
      {
        headers: createCorsHeaders(),
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error processing email:", error);
    return createErrorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
});
