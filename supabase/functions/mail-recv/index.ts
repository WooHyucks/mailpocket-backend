// supabase/functions/mail-recv/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai@4.20.1";
import { simpleParser } from "npm:mailparser@3.6.5";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SLACK_LOGGING_WEBHOOK = Deno.env.get("SLACK_LOGGING_CHANNEL_WEBHOOK_URL");
const SLACK_UNKNOWN_EMAIL_WEBHOOK = Deno.env.get("SLACK_UNKNOWN_EMAIL_ADDRESS_WEBHOOK_URL");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const MODEL = "gpt-3.5-turbo-0125";
const PROMPT = `
# 요약
- 당신은 긴 뉴스 기사를 요약하여 사람들에게 전달하는 기자이자 아나운서의 역할을 맡고 있습니다. 제시되는 뉴스 기사들의 핵심 내용을 요약하여 주세요. 요약된 내용은 기사의 주요 사건, 그 사건의 영향 및 결과, 그리고 그 사건의 장기적 중요성을 포함해야 합니다.
- 주제목은 해당 기사의 소식을 한줄 요약 합니다.
- 내용은 각 기사별로 3 ~ 4문장으로 구성되어야 하며, 서론, 본론, 결론의 구조로 명확히 구분되어야 합니다. 각 내용은 기사의 주제에 맞는 내용만 다루어야합니다.
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
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
        },
      });
    }

    const { s3_object_key } = await req.json();

    if (!s3_object_key) {
      return new Response(
        JSON.stringify({ error: "s3_object_key is required" }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        }
      );
    }

    // Download email from Supabase Storage
    const { data: file, error: downloadError } = await supabase.storage
      .from("mails")
      .download(s3_object_key);

    if (downloadError || !file) {
      return new Response(
        JSON.stringify({ error: "Failed to download email file" }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 404,
        }
      );
    }

    const emailContent = await file.text();

    // Parse email
    const parsed = await simpleParser(emailContent);
    const fromEmail = parsed.from?.text || "";
    const fromMatch = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
    const fromEmailAddress = fromMatch ? fromMatch[2] : fromEmail;
    const subject = parsed.subject || "";
    const htmlBody = parsed.html || parsed.textAsHtml || "";

    // Log to Slack
    if (SLACK_LOGGING_WEBHOOK) {
      await fetch(SLACK_LOGGING_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: [
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `email : ${fromEmailAddress}\nid : ${fromMatch ? fromMatch[1].replace(/"/g, "") : fromEmail}\n*<https://mailpocket.me/read?mail=${s3_object_key}|${subject}>*`,
                },
              ],
            },
          ],
        }),
      }).catch(console.error);
    }

    // Find newsletter by from_email
    const { data: newsletter, error: newsletterError } = await supabase
      .from("newsletter_email_addresses")
      .select("newsletter_id, newsletter:newsletter_id(*)")
      .eq("email_address", fromEmailAddress)
      .single();

    if (newsletterError || !newsletter) {
      // Unknown email - log to Slack
      if (SLACK_UNKNOWN_EMAIL_WEBHOOK) {
        await fetch(SLACK_UNKNOWN_EMAIL_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: [
              {
                type: "section",
                fields: [
                  {
                    type: "mrkdwn",
                    text: `${fromEmailAddress}\nis unknown email address\n뉴스레터: ${fromMatch ? fromMatch[1].replace(/"/g, "") : fromEmail}\n제목: ${subject}\n링크: https://mailpocket.me/read?mail=${s3_object_key}\nS3 OBJ KEY: ${s3_object_key}`,
                  },
                ],
              },
            ],
          }),
        }).catch(console.error);
      }

      return new Response(
        JSON.stringify({ error: `Unknown from email: ${fromEmailAddress}` }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        }
      );
    }

    const newsletterId = newsletter.newsletter_id;

    // Generate summary using OpenAI
    const summaryList = await generateSummary(htmlBody);

    // Save mail to database
    const { data: mail, error: mailError } = await supabase
      .from("mail")
      .insert({
        s3_object_key,
        subject,
        summary_list: summaryList,
        newsletter_id: newsletterId,
        recv_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (mailError) {
      console.error("Error saving mail:", mailError);
      return new Response(
        JSON.stringify({ error: "Failed to save mail" }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 500,
        }
      );
    }

    // Update newsletter last_recv_at
    await supabase
      .from("newsletter")
      .update({ last_recv_at: new Date().toISOString() })
      .eq("id", newsletterId);

    // Send Slack notifications to subscribed channels
    // First get all users subscribed to this newsletter
    const { data: subscriptions } = await supabase
      .from("subscribe")
      .select("user_id")
      .eq("newsletter_id", newsletterId);

    if (subscriptions && subscriptions.length > 0) {
      const userIds = subscriptions.map((s) => s.user_id);
      
      // Get channels for these users
      const { data: channels } = await supabase
        .from("channel")
        .select("*")
        .in("user_id", userIds);

      if (channels && channels.length > 0) {
        const notifiedChannelIds = new Set<string>();
        for (const channel of channels) {
          if (notifiedChannelIds.has(channel.slack_channel_id)) continue;
          notifiedChannelIds.add(channel.slack_channel_id);

          await sendSlackNotification(channel, mail, newsletter.newsletter);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Email received and processed successfully",
        mail_id: mail.id,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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

async function sendSlackNotification(
  channel: any,
  mail: any,
  newsletter: any
): Promise<void> {
  const utmSource = `&utm_source=slack&utm_medium=bot&utm_campaign=${channel.team_name}`;
  const readLink = `https://mailpocket.me/read?mail=${mail.s3_object_key}${utmSource}`;

  const blocks: any[] = [
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `${newsletter.name}의 새로운 소식이 도착했어요.\n*<${readLink}|${mail.subject}>*`,
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

  await fetch(channel.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  }).catch(console.error);
}

