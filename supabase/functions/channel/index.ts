// supabase/functions/channel/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@9.0.2";

const JWT_SECRET = Deno.env.get("JWT_SECRET_KEY") || "default-secret-key";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID")!;
const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Get user ID from authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        status: 401,
      });
    }

    const userId = getUserIdFromToken(authHeader);

    // GET /channel - Get all channels for user
    if (method === "GET" && path.endsWith("/channel")) {
      const { data: channels, error } = await supabase
        .from("channel")
        .select("id, team_name, team_icon, name")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify(channels || []), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // GET /channel/:id - Get specific channel
    const channelIdMatch = path.match(/\/channel\/(\d+)$/);
    if (method === "GET" && channelIdMatch) {
      const channelId = parseInt(channelIdMatch[1]);

      const { data: channel, error } = await supabase
        .from("channel")
        .select("id, team_name, team_icon, name")
        .eq("id", channelId)
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return new Response(JSON.stringify({ error: "Channel not found" }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 404,
          });
        }
        throw error;
      }

      return new Response(JSON.stringify(channel), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // POST /channel - Add Slack channel
    if (method === "POST" && path.endsWith("/channel")) {
      const { code } = await req.json();

      if (!code) {
        return new Response(JSON.stringify({ error: "code is required" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        });
      }

      // Exchange code for access token
      const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: SLACK_CLIENT_ID,
          client_secret: SLACK_CLIENT_SECRET,
          code: code,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenData.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to connect Slack workspace" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 400,
          }
        );
      }

      const accessToken = tokenData.access_token;
      const webhookUrl = tokenData.incoming_webhook.url.replace(/\\/g, "");
      const slackChannelId = tokenData.incoming_webhook.channel_id;
      const name = tokenData.incoming_webhook.channel;
      const teamName = tokenData.team.name;

      // Get team icon
      const teamInfoResponse = await fetch("https://slack.com/api/team.info", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const teamInfo = await teamInfoResponse.json();
      const teamIcon = teamInfo.team?.icon?.image_230?.replace(/\\/g, "") || "";

      // Save channel to database
      const { data: channel, error: channelError } = await supabase
        .from("channel")
        .insert({
          webhook_url: webhookUrl,
          slack_channel_id: slackChannelId,
          name: name,
          team_name: teamName,
          team_icon: teamIcon,
          user_id: userId,
        })
        .select()
        .single();

      if (channelError) throw channelError;

      // Send welcome message
      await sendWelcomeMessage(webhookUrl);

      // Send recent newsletters
      const { data: subscriptions } = await supabase
        .from("subscribe")
        .select("newsletter_id")
        .eq("user_id", userId);

      if (subscriptions && subscriptions.length > 0) {
        const newsletterIds = subscriptions.map((s) => s.newsletter_id);
        const { data: newsletters } = await supabase
          .from("newsletter")
          .select("id, name")
          .in("id", newsletterIds)
          .limit(3);

        if (newsletters) {
          for (const newsletter of newsletters) {
            const { data: lastMail } = await supabase
              .from("mail")
              .select("*")
              .eq("newsletter_id", newsletter.id)
              .order("recv_at", { ascending: false })
              .limit(1)
              .single();

            if (lastMail) {
              await sendMailNotification(webhookUrl, lastMail, newsletter);
            }
          }
        }
      }

      return new Response(null, {
        headers: {
          "Location": `/channel/${channel.id}`,
          "Access-Control-Allow-Origin": "*",
        },
        status: 201,
      });
    }

    // DELETE /channel/:id - Remove channel
    const deleteChannelMatch = path.match(/\/channel\/(\d+)$/);
    if (method === "DELETE" && deleteChannelMatch) {
      const channelId = parseInt(deleteChannelMatch[1]);

      // Verify ownership
      const { data: channel, error: checkError } = await supabase
        .from("channel")
        .select("user_id")
        .eq("id", channelId)
        .single();

      if (checkError || !channel || channel.user_id !== userId) {
        return new Response(JSON.stringify({ error: "Channel not found or unauthorized" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 404,
        });
      }

      const { error } = await supabase
        .from("channel")
        .delete()
        .eq("id", channelId)
        .eq("user_id", userId);

      if (error) throw error;

      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
        status: 204,
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 404,
    });
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

function getUserIdFromToken(authorization: string): number {
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;
  const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
  return decoded.id;
}

async function sendWelcomeMessage(webhookUrl: string): Promise<void> {
  const welcomeMessage = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "이제부터 이 채널에 뉴스레터를 요약해서 보내드릴게요.\n메일 포켓을 사용하면 이런 게 좋아요.\n\n*1) 매일 쏟아지는 뉴스레터를 3줄 요약해서 슬랙에 보내드려요.*\n눈으로만 훑어보세요. 재미 있는 뉴스라면 조금 더 자세히 보고, 슬랙의 save item 을 사용하면 나중에 읽을 수도 있어요.\n*2) 메일함에 일회성 메일이 쌓이는걸 방지할 수 있어요.*\n뉴스레터 때문에 메일함이 항상 999+ 개 이상 쌓여 있고, 중요 메일 놓쳐본 적 많으시죠? 뉴스레터는 메일 포켓이 받고, 슬랙으로 요약해서 슝- 보내 드릴게요.",
      },
    },
  ];

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks: welcomeMessage }),
  }).catch(console.error);
}

async function sendMailNotification(
  webhookUrl: string,
  mail: any,
  newsletter: any
): Promise<void> {
  const readLink = `https://mailpocket.shop/read?mail=${mail.s3_object_key}`;
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

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  }).catch(console.error);
}

