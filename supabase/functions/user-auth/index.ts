// supabase/functions/user-auth/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";
import jwt from "npm:jsonwebtoken@9.0.2";

const JWT_SECRET = Deno.env.get("JWT_SECRET_KEY") || "default-secret-key";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface RequestBody {
  type: "guest" | "sign-up" | "sign-in" | "google-login" | "kakao-login" | "naver-login";
  identifier?: string;
  password?: string;
  token?: string; // OAuth token
  authorization?: string; // Bearer token for upgrade
}

serve(async (req) => {
  try {
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
    }

    const body: RequestBody = await req.json();
    const { type, identifier, password, token, authorization } = body;

    // 게스트 생성
    if (type === "guest") {
      const { data: user, error } = await supabase
        .from("user")
        .insert({ is_member: false })
        .select()
        .single();

      if (error) throw error;

      const jwtToken = jwt.sign(
        { id: user.id, is_member: false },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return new Response(JSON.stringify({ token: jwtToken }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 201,
      });
    }

    // 회원가입
    if (type === "sign-up") {
      // 기존 게스트 업그레이드인지 확인
      if (authorization) {
        const userId = getUserIdFromToken(authorization);
        const { data: existingUser } = await supabase
          .from("user")
          .select("*")
          .eq("identifier", identifier!)
          .single();

        if (existingUser) {
          return new Response(
            JSON.stringify({ error: "Identifier already exists" }),
            {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              status: 400,
            }
          );
        }

        const hashed = await bcrypt.hash(password!, 10);
        const { data: user, error } = await supabase
          .from("user")
          .update({
            identifier,
            password: hashed,
            is_member: true,
          })
          .eq("id", userId)
          .select()
          .single();

        if (error) throw error;

        const jwtToken = jwt.sign(
          { id: user.id, is_member: true },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

        return new Response(JSON.stringify({ token: jwtToken }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 201,
        });
      } else {
        // 신규 회원가입
        const { data: existingUser } = await supabase
          .from("user")
          .select("*")
          .eq("identifier", identifier!)
          .single();

        if (existingUser) {
          return new Response(
            JSON.stringify({ error: "Identifier already exists" }),
            {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              status: 400,
            }
          );
        }

        const hashed = await bcrypt.hash(password!, 10);
        const { data: user, error } = await supabase
          .from("user")
          .insert({
            identifier,
            password: hashed,
            is_member: true,
          })
          .select()
          .single();

        if (error) throw error;

        const jwtToken = jwt.sign(
          { id: user.id, is_member: true },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

        return new Response(JSON.stringify({ token: jwtToken }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 201,
        });
      }
    }

    // 로그인
    if (type === "sign-in") {
      const { data: user, error } = await supabase
        .from("user")
        .select("*")
        .eq("identifier", identifier!)
        .single();

      if (error || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid credentials" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 401,
          }
        );
      }

      const isPasswordMatch = await bcrypt.compare(password!, user.password);
      if (!isPasswordMatch) {
        return new Response(
          JSON.stringify({ error: "Invalid credentials" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 401,
          }
        );
      }

      const jwtToken = jwt.sign(
        { id: user.id, is_member: true },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return new Response(JSON.stringify({ token: jwtToken }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // OAuth 로그인 (Google, Kakao, Naver)
    if (type === "google-login" || type === "kakao-login" || type === "naver-login") {
      const platform = type.replace("-login", "");
      const platformId = await getPlatformIdFromOAuth(platform, token!);

      if (authorization) {
        // 기존 게스트 업그레이드
        const userId = getUserIdFromToken(authorization);
        const { data: existingUser } = await supabase
          .from("user")
          .select("*")
          .eq("platform", platform)
          .eq("platform_id", platformId)
          .single();

        if (existingUser) {
          const jwtToken = jwt.sign(
            { id: existingUser.id, is_member: true },
            JWT_SECRET,
            { expiresIn: "30d" }
          );
          return new Response(JSON.stringify({ token: jwtToken }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }

        const { data: user, error } = await supabase
          .from("user")
          .update({
            platform_id: platformId,
            platform,
            is_member: true,
          })
          .eq("id", userId)
          .select()
          .single();

        if (error) throw error;

        const jwtToken = jwt.sign(
          { id: user.id, is_member: true },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

        return new Response(JSON.stringify({ token: jwtToken }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 200,
        });
      } else {
        // 신규 OAuth 로그인
        const { data: existingUser } = await supabase
          .from("user")
          .select("*")
          .eq("platform", platform)
          .eq("platform_id", platformId)
          .single();

        if (existingUser) {
          const jwtToken = jwt.sign(
            { id: existingUser.id, is_member: true },
            JWT_SECRET,
            { expiresIn: "30d" }
          );
          return new Response(JSON.stringify({ token: jwtToken }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }

        const { data: user, error } = await supabase
          .from("user")
          .insert({
            platform_id: platformId,
            platform,
            is_member: true,
          })
          .select()
          .single();

        if (error) throw error;

        const jwtToken = jwt.sign(
          { id: user.id, is_member: true },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

        return new Response(JSON.stringify({ token: jwtToken }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 201,
        });
      }
    }

    return new Response(JSON.stringify({ error: "Invalid type" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 400,
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

async function getPlatformIdFromOAuth(
  platform: string,
  token: string
): Promise<string> {
  const KAKAO_CLIENT_ID = Deno.env.get("KAKAO_CLIENT_ID");
  const KAKAO_REDIRECT_URL = Deno.env.get("KAKAO_REDIRECT_URL");
  const NAVER_CLIENT_ID = Deno.env.get("NAVER_CLIENT_ID");
  const NAVER_CLIENT_SECRET = Deno.env.get("NAVER_CLIENT_SECRET");
  const NAVER_STATE = Deno.env.get("NAVER_STATE");

  if (platform === "google") {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${token}`
    );
    const data = await response.json();
    if (!data.id) throw new Error("Invalid Google OAuth token");
    return data.id;
  }

  if (platform === "kakao") {
    // Get access token from authorization code
    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_CLIENT_ID!,
        redirect_uri: KAKAO_REDIRECT_URL!,
        code: token,
      }),
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userResponse.json();
    if (!userData.id) throw new Error("Invalid Kakao OAuth token");
    return userData.id.toString();
  }

  if (platform === "naver") {
    // Get access token from authorization code
    const tokenResponse = await fetch(
      `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${NAVER_CLIENT_ID}&client_secret=${NAVER_CLIENT_SECRET}&code=${token}&state=${NAVER_STATE}`
    );
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userResponse.json();
    if (!userData.response?.id) throw new Error("Invalid Naver OAuth token");
    return userData.response.id;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

