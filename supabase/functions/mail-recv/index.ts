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
const MAX_TRANSLATE_SOURCE_LENGTH = 5500;

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

const OPENAI_PROMPT_FOR_ENGLISH = `
# Summary and Translation
- You are a journalist and announcer who summarizes long news articles and delivers them to people. Summarize the key content of the news articles provided. The summary should include the main events, their impact and results, and their long-term importance.
- The subject title should be a one-line summary of the news.
- The content should consist of 3 sentences per article, clearly divided into introduction, body, and conclusion. Each content should only cover topics relevant to the article.
- Use present tense and use descriptive and objective expressions rather than direct speech.
- Translate the summary into natural Korean. The translation should maintain the original meaning without exaggeration or distortion.
- Use formal and complete sentence endings in Korean (e.g., "논란이 있습니다" instead of "논란이 있다").
- Within individual sentences, convey facts while maintaining appropriate courtesy and clearly indicate that the purpose is to provide information to readers.

# Output
- You must organize your answer in JSON format. Each subject title should be the Key and the content should be the Value.
- Never use "nested JSON" or "hierarchical JSON" structures in JSON responses.
- Never use simple subject titles like "주제" or "내용".
- All output must be in Korean.
`;

const TRANSLATE_SYSTEM_PROMPT = `
당신은 해외 뉴스레터를 한국어로 번역하는 전문가입니다.

규칙:
- 반드시 한국어로 번역합니다.
- 원문의 의미를 훼손하거나 과장하지 않습니다.
- 직역이 아닌 자연스러운 한국어 번역을 합니다.
- 뉴스레터 문체를 유지합니다.
- 불필요한 서론, 요약, 결론을 추가하지 않습니다.
- HTML 태그를 생성하지 말고 순수 텍스트로만 출력합니다.
- 문단 구분은 줄바꿈으로 자연스럽게 유지합니다.
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
    language?: string | null;
  };
}

interface MailData {
  id: number;
  s3_object_key: string;
  subject: string;
  summary_list: Record<string, string>;
  translated_body?: string | null;
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

function extractTranslatableText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, head").remove();
  const text = $("body").text();
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  return normalized.slice(0, MAX_TRANSLATE_SOURCE_LENGTH);
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

async function generateSummary(html: string, language: string = "ko"): Promise<Record<string, string>> {
  const htmlText = extractHtmlText(html);
  const prompt = language === "en" ? OPENAI_PROMPT_FOR_ENGLISH : OPENAI_PROMPT;
  const userContent = language === "en"
    ? `News article to summarize and translate to Korean:\n\n${htmlText}`
    : `뉴스:${htmlText}`;

  for (let attempt = 0; attempt < MAX_SUMMARY_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userContent },
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

async function translateToKorean(text: string): Promise<string | null> {
  if (!text) return null;

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0,
    });

    const translated = response.choices[0].message.content?.trim() || null;
    return translated || null;
  } catch (error) {
    console.error("Translation failed:", error);
    return null;
  }
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

// ============================================================
// Newsletter Matching Strategy - 4-Step Resolution
// ============================================================
// 0. From header name matching (highest priority)
// 1. HTML body text-based name matching
// 2. Email address exact matching
// 3. Domain matching (excluding blacklist, single match only)
// ============================================================

// Domain blacklist for step 3 - these domains should never match
const DOMAIN_BLACKLIST = [
  "gmail.com",
  "naver.com",
  "daum.net",
  "kakao.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "stibee.com",
  "send.stibee.com",
  "mailchimp.com",
  "sendgrid.net",
  "substack.com",
];

const MAX_HTML_TEXT_LENGTH = 10000;

interface NewsletterMatchResult {
  newsletter: { id: number; name: string } | null;
  matchedBy: "from_name" | "html_body" | "email" | "domain" | null;
}

interface NewsletterInfo {
  id: number;
  name: string;
  language: string | null;
}

interface NewsletterEmailInfo {
  newsletter_id: number;
  email_address: string;
}

/**
 * Normalize text for matching: lowercase, remove spaces and special characters
 * This ensures consistent matching regardless of formatting differences
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "") // Remove all whitespace
    .replace(/[^\w가-힣]/g, ""); // Remove special characters, keep alphanumeric and Korean
}

/**
 * Extract clean text from HTML body for name matching
 * Removes script, style, and head tags to get only content text
 * Limits text length to MAX_HTML_TEXT_LENGTH for performance
 */
function extractTextForNameMatching(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, head").remove();
  const text = $("body").text();
  const normalized = normalize(text);
  return normalized.slice(0, MAX_HTML_TEXT_LENGTH);
}

/**
 * Step 0: Match newsletter by From header name
 * This is the highest priority method because From name is the most reliable
 * identifier when email addresses change
 */
function matchNewsletterByFromName(
  parsedFromName: string,
  newsletters: NewsletterInfo[]
): { newsletter: { id: number; name: string } | null; matchedBy: "from_name" | null } {
  const normalizedFromName = normalize(parsedFromName);

  for (const newsletter of newsletters) {
    const normalizedName = normalize(newsletter.name);
    
    // Check if newsletter name is included in From name
    if (normalizedFromName.includes(normalizedName)) {
      console.log(`[MATCH] from_name success: ${newsletter.name}`);
      return {
        newsletter: { id: newsletter.id, name: newsletter.name },
        matchedBy: "from_name",
      };
    }
  }

  console.log("[MATCH] from_name failed");
  return { newsletter: null, matchedBy: null };
}

/**
 * Step 1: Match newsletter by name in HTML body
 * This handles cases where From name doesn't match but newsletter name appears in content
 */
function matchNewsletterByHtmlBody(
  htmlBody: string,
  newsletters: NewsletterInfo[]
): { newsletter: { id: number; name: string } | null; matchedBy: "html_body" | null } {
  const htmlText = extractTextForNameMatching(htmlBody);

  for (const newsletter of newsletters) {
    const normalizedName = normalize(newsletter.name);
    
    // Check if newsletter name appears in HTML body
    if (htmlText.includes(normalizedName)) {
      console.log(`[MATCH] html_body success: ${newsletter.name}`);
      return {
        newsletter: { id: newsletter.id, name: newsletter.name },
        matchedBy: "html_body",
      };
    }
  }

  console.log("[MATCH] html_body failed");
  return { newsletter: null, matchedBy: null };
}

/**
 * Step 2: Match newsletter by exact email address
 * Uses newsletter_email_addresses table
 * Only matches when email addresses are exactly the same
 */
function matchNewsletterByEmail(
  parsedFromEmail: string,
  newsletterEmailAddresses: NewsletterEmailInfo[],
  newsletters: NewsletterInfo[]
): { newsletter: { id: number; name: string } | null; matchedBy: "email" | null } {
  for (const emailInfo of newsletterEmailAddresses) {
    if (emailInfo.email_address === parsedFromEmail) {
      const newsletter = newsletters.find((n) => n.id === emailInfo.newsletter_id);
      if (newsletter) {
        console.log(`[MATCH] email success: ${newsletter.name}`);
        return {
          newsletter: { id: newsletter.id, name: newsletter.name },
          matchedBy: "email",
        };
      }
    }
  }

  console.log("[MATCH] email failed");
  return { newsletter: null, matchedBy: null };
}

/**
 * Extract domain from email address
 */
function extractDomain(email: string): string | null {
  const match = email.match(/@([^@]+)$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Step 3: Match newsletter by domain (excluding blacklist)
 * This handles cases where email addresses change but domain stays the same
 * Only matches when exactly one newsletter has the same domain
 * Blacklist prevents matching generic email providers
 */
function matchNewsletterByDomain(
  parsedFromEmail: string,
  newsletterEmailAddresses: NewsletterEmailInfo[],
  newsletters: NewsletterInfo[]
): { newsletter: { id: number; name: string } | null; matchedBy: "domain" | null } {
  const domain = extractDomain(parsedFromEmail);
  
  if (!domain) {
    console.log("[MATCH] domain failed: no domain");
    return { newsletter: null, matchedBy: null };
  }

  // Check blacklist - if domain is in blacklist, skip this step
  if (DOMAIN_BLACKLIST.includes(domain)) {
    console.log(`[MATCH] domain failed: ${domain} is in blacklist`);
    return { newsletter: null, matchedBy: null };
  }

  // Find all newsletters with matching domain from newsletter_email_addresses
  const matchingNewsletterIds = new Set<number>();
  
  for (const emailInfo of newsletterEmailAddresses) {
    const emailDomain = extractDomain(emailInfo.email_address);
    if (emailDomain && emailDomain === domain) {
      matchingNewsletterIds.add(emailInfo.newsletter_id);
    }
  }

  // Only match if exactly one newsletter has this domain
  if (matchingNewsletterIds.size === 1) {
    const newsletterId = Array.from(matchingNewsletterIds)[0];
    const newsletter = newsletters.find((n) => n.id === newsletterId);
    if (newsletter) {
      console.log(`[MATCH] domain success: ${newsletter.name}`);
      return {
        newsletter: { id: newsletter.id, name: newsletter.name },
        matchedBy: "domain",
      };
    }
  }

  if (matchingNewsletterIds.size > 1) {
    console.log(`[MATCH] domain failed: multiple newsletters found (${matchingNewsletterIds.size})`);
  } else {
    console.log("[MATCH] domain failed: no matching domain");
  }
  
  return { newsletter: null, matchedBy: null };
}

/**
 * Main newsletter resolution function
 * Tries 4-step matching strategy in order:
 * 0. From header name matching (highest priority)
 * 1. HTML body name matching
 * 2. Email address exact matching
 * 3. Domain matching (last resort, blacklist excluded, single match only)
 * 
 * Returns match result with newsletter info and matchedBy method
 */
async function resolveNewsletter(
  parsedFromName: string,
  parsedFromEmail: string,
  htmlBody: string
): Promise<NewsletterMatchResult> {
  // Load all newsletters and email addresses once
  const { data: newsletters, error: newslettersError } = await supabase
    .from("newsletter")
    .select("id, name, language");

  if (newslettersError || !newsletters || newsletters.length === 0) {
    console.log("[MATCH] Failed to load newsletters");
    return { newsletter: null, matchedBy: null };
  }

  const { data: newsletterEmailAddresses, error: emailsError } = await supabase
    .from("newsletter_email_addresses")
    .select("newsletter_id, email_address");

  if (emailsError) {
    console.log("[MATCH] Failed to load newsletter email addresses");
    return { newsletter: null, matchedBy: null };
  }

  const newsletterList: NewsletterInfo[] = newsletters;
  const emailList: NewsletterEmailInfo[] = newsletterEmailAddresses || [];

  // Step 0: Try From header name matching (highest priority)
  const fromNameMatch = matchNewsletterByFromName(parsedFromName, newsletterList);
  if (fromNameMatch.newsletter) {
    return fromNameMatch;
  }

  // Step 1: Try HTML body name matching
  const htmlBodyMatch = matchNewsletterByHtmlBody(htmlBody, newsletterList);
  if (htmlBodyMatch.newsletter) {
    return htmlBodyMatch;
  }

  // Step 2: Try email address exact matching
  const emailMatch = matchNewsletterByEmail(parsedFromEmail, emailList, newsletterList);
  if (emailMatch.newsletter) {
    return emailMatch;
  }

  // Step 3: Try domain matching (excluding blacklist, single match only)
  const domainMatch = matchNewsletterByDomain(parsedFromEmail, emailList, newsletterList);
  if (domainMatch.newsletter) {
    return domainMatch;
  }

  // All matching strategies failed
  console.log("[MATCH] All matching strategies failed");
  return { newsletter: null, matchedBy: null };
}

async function saveMail(
  s3ObjectKey: string,
  subject: string,
  summaryList: Record<string, string>,
  newsletterId: number,
  htmlBody: string,
  translatedBody: string | null
): Promise<MailData> {
  const { data, error } = await supabase
      .from("mail")
      .insert({
      s3_object_key: s3ObjectKey,
        subject,
        summary_list: summaryList,
        newsletter_id: newsletterId,
        html_body: htmlBody,
        translated_body: translatedBody,
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

    // Resolve newsletter using 4-step matching strategy
    // 0. From header name matching (highest priority)
    // 1. HTML body name matching
    // 2. Email address exact matching
    // 3. Domain matching (last resort, blacklist excluded, single match only)
    const matchResult = await resolveNewsletter(
      parsedEmail.fromName,
      parsedEmail.fromEmailAddress,
      parsedEmail.htmlBody
    );
    
    if (!matchResult.newsletter) {
      // All matching strategies failed - log to Slack but don't save to DB
      await logUnknownEmailToSlack(
        parsedEmail.fromEmailAddress,
        parsedEmail.fromName,
        parsedEmail.subject,
        s3_object_key
      );
      return createErrorResponse(
        "Unable to resolve newsletter (name/email/domain match failed)",
        400
      );
    }

    // Get full newsletter data including language
    const { data: newsletterData, error: newsletterError } = await supabase
      .from("newsletter")
      .select("id, name, language")
      .eq("id", matchResult.newsletter.id)
      .single();

    if (newsletterError || !newsletterData) {
      return createErrorResponse("Failed to load newsletter data", 500);
    }

    const newsletterLanguage = newsletterData.language || "ko";

    // Generate summary using OpenAI
    // For English newsletters, the summary will be automatically translated to Korean
    const summaryList = await generateSummary(parsedEmail.htmlBody, newsletterLanguage);

    // Translate only for English newsletters
    let translatedBody: string | null = null;
    if (newsletterLanguage === "en") {
      const translationSource = extractTranslatableText(parsedEmail.htmlBody);
      translatedBody = await translateToKorean(translationSource);
    }

    // Save mail to database (including html_body for faster retrieval)
    const mail = await saveMail(
      s3_object_key,
      parsedEmail.subject,
      summaryList,
      matchResult.newsletter.id,
      parsedEmail.htmlBody,
      translatedBody
    );

    // Update newsletter last_recv_at
    await updateNewsletterLastRecvAt(matchResult.newsletter.id);

    // Send Slack notifications to subscribed channels
    const newsletterForNotification: NewsletterData = {
      newsletter_id: matchResult.newsletter.id,
      newsletter: {
        name: matchResult.newsletter.name,
        language: newsletterLanguage,
      },
    };
    await sendSlackNotifications(mail, newsletterForNotification);

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
