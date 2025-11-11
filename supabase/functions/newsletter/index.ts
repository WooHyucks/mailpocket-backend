// supabase/functions/newsletter/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@9.0.2";

const JWT_SECRET = Deno.env.get("JWT_SECRET_KEY") || "default-secret-key";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

    // GET /newsletter - Get newsletters list
    if (method === "GET" && path.endsWith("/newsletter")) {
      const subscribeStatus = url.searchParams.get("subscribe_status");
      const sortType = url.searchParams.get("sort_type") || "recent";
      const inMail = url.searchParams.get("in_mail") === "true";
      const cursor = url.searchParams.get("cursor");
      const categoryId = url.searchParams.get("category_id");

      // Get subscribed newsletter IDs first
      let subscribedNewsletterIds: number[] = [];
      if (subscribeStatus === "subscribed" || subscribeStatus === "not_subscribed") {
        const { data: subscriptions } = await supabase
          .from("subscribe")
          .select("newsletter_id")
          .eq("user_id", userId);
        subscribedNewsletterIds = subscriptions?.map((s) => s.newsletter_id) || [];
      }

      let query = supabase
        .from("newsletter")
        .select(`
          *,
          category:category_id(*),
          subscribe_ranking:subscribe_ranking(newsletter_id, subscribe_count)
        `);

      // Filter by subscription status
      if (subscribeStatus === "subscribed") {
        if (subscribedNewsletterIds.length > 0) {
          query = query.in("id", subscribedNewsletterIds);
        } else {
          // No subscriptions, return empty array
          return new Response(JSON.stringify([]), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }
      } else if (subscribeStatus === "not_subscribed") {
        // Filter will be applied after fetching
      }

      // Filter by category
      if (categoryId) {
        query = query.eq("category_id", parseInt(categoryId));
      }

      // Filter by has mail
      if (inMail) {
        const { data: mails } = await supabase
          .from("mail")
          .select("newsletter_id")
          .not("newsletter_id", "is", null);
        const newsletterIdsWithMail = [
          ...new Set(mails?.map((m) => m.newsletter_id).filter((id) => id !== null)),
        ];
        if (newsletterIdsWithMail.length > 0) {
          query = query.in("id", newsletterIdsWithMail);
        } else {
          // No newsletters with mail, return empty array
          return new Response(JSON.stringify([]), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }
      }

      // Sort
      if (sortType === "ranking") {
        query = query.order("subscribe_ranking.subscribe_count", { ascending: false });
      } else {
        query = query.order("last_recv_at", { ascending: false });
      }

      // Pagination
      if (cursor) {
        query = query.range(parseInt(cursor), parseInt(cursor) + 19);
      } else {
        query = query.range(0, 19);
      }

      const { data: newsletters, error } = await query;

      if (error) throw error;

      // Filter out subscribed newsletters if not_subscribed
      let filteredNewsletters = newsletters || [];
      if (subscribeStatus === "not_subscribed" && subscribedNewsletterIds.length > 0) {
        filteredNewsletters = filteredNewsletters.filter(
          (n) => !subscribedNewsletterIds.includes(n.id)
        );
      }

      // Add mail info if in_mail is true
      if (inMail && filteredNewsletters) {
        for (const newsletter of filteredNewsletters) {
          const { data: lastMail } = await supabase
            .from("mail")
            .select("*")
            .eq("newsletter_id", newsletter.id)
            .order("recv_at", { ascending: false })
            .limit(1)
            .single();

          if (lastMail) {
            newsletter.mail = lastMail;
          }
        }
      }

      return new Response(JSON.stringify(filteredNewsletters || []), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // GET /newsletter/categories - Get categories
    if (method === "GET" && path.endsWith("/newsletter/categories")) {
      const { data: categories, error } = await supabase
        .from("category")
        .select("*")
        .order("id");

      if (error) throw error;

      return new Response(JSON.stringify(categories || []), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // GET /newsletter/:id/mail - Get newsletter with mails
    const newsletterIdMatch = path.match(/\/newsletter\/(\d+)\/mail$/);
    if (method === "GET" && newsletterIdMatch) {
      const newsletterId = parseInt(newsletterIdMatch[1]);

      const { data: newsletter, error: newsletterError } = await supabase
        .from("newsletter")
        .select(`
          *,
          category:category_id(*)
        `)
        .eq("id", newsletterId)
        .single();

      if (newsletterError) throw newsletterError;

      const { data: mails, error: mailsError } = await supabase
        .from("mail")
        .select("*")
        .eq("newsletter_id", newsletterId)
        .order("recv_at", { ascending: false });

      if (mailsError) throw mailsError;

      newsletter.mails = mails || [];

      return new Response(JSON.stringify(newsletter), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // GET /newsletter/:id/last-mail - Get last mail of newsletter
    const lastMailMatch = path.match(/\/newsletter\/(\d+)\/last-mail$/);
    if (method === "GET" && lastMailMatch) {
      const newsletterId = parseInt(lastMailMatch[1]);

      const { data: mail, error } = await supabase
        .from("mail")
        .select("*")
        .eq("newsletter_id", newsletterId)
        .order("recv_at", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows returned

      return new Response(JSON.stringify(mail || null), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // POST /newsletter/:id/subscribe - Subscribe to newsletter
    const subscribeMatch = path.match(/\/newsletter\/(\d+)\/subscribe$/);
    if (method === "POST" && subscribeMatch) {
      const newsletterId = parseInt(subscribeMatch[1]);

      const { error } = await supabase
        .from("subscribe")
        .insert({
          newsletter_id: newsletterId,
          user_id: userId,
        })
        .select()
        .single();

      if (error && error.code !== "23505") throw error; // 23505 = unique violation (already subscribed)

      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
        status: 201,
      });
    }

    // DELETE /newsletter/:id/subscribe - Unsubscribe from newsletter
    const unsubscribeMatch = path.match(/\/newsletter\/(\d+)\/subscribe$/);
    if (method === "DELETE" && unsubscribeMatch) {
      const newsletterId = parseInt(unsubscribeMatch[1]);

      const { error } = await supabase
        .from("subscribe")
        .delete()
        .eq("newsletter_id", newsletterId)
        .eq("user_id", userId);

      if (error) throw error;

      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
        status: 204,
      });
    }

    // PUT /newsletter/subscribe - Bulk subscribe
    if (method === "PUT" && path.endsWith("/newsletter/subscribe")) {
      const { ids } = await req.json();

      if (!Array.isArray(ids)) {
        return new Response(JSON.stringify({ error: "ids must be an array" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        });
      }

      // Delete existing subscriptions
      await supabase
        .from("subscribe")
        .delete()
        .eq("user_id", userId);

      // Insert new subscriptions
      if (ids.length > 0) {
        const subscriptions = ids.map((id: number) => ({
          newsletter_id: id,
          user_id: userId,
        }));

        const { error } = await supabase
          .from("subscribe")
          .insert(subscriptions);

        if (error) throw error;
      }

      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*" },
        status: 201,
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

