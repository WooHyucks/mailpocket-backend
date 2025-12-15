// supabase/functions/user-auth/index.ts
// @ts-ignore: Deno types are available at runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Remote module types are available at runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore: npm: imports are available at runtime in Deno
import bcrypt from "npm:bcryptjs@2.4.3";
// @ts-ignore: npm: imports are available at runtime in Deno
import jwt from "npm:jsonwebtoken@9.0.2";

// @ts-ignore: Deno is available at runtime
const JWT_SECRET = Deno.env.get("JWT_SECRET_KEY") || "default-secret-key";
// @ts-ignore: Deno is available at runtime
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore: Deno is available at runtime
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  identifier?: string;
  password?: string;
  token?: string; // OAuth token
  type?: "google" | "kakao" | "naver"; // OAuth platform type
}

serve(async (req) => {
  try {
    // CORS headers
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
    }

    // URL 경로로 엔드포인트 구분
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // Authorization 헤더에서 가져오기
    const authorization = req.headers.get("authorization");
    
    // GET 요청 처리 (GET /user)
    if (req.method === "GET" && (pathname.endsWith("/user") || pathname.endsWith("/user/"))) {
      if (!authorization) {
        return new Response(
          JSON.stringify({ error: "Authorization header is required" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 401,
          }
        );
      }
      
      try {
        const userId = getUserIdFromToken(authorization);
        const { data: user, error } = await supabase
          .from("user")
          .select("id, identifier, platform, platform_id, is_member")
          .eq("id", userId)
          .single();
        
        if (error || !user) {
          return new Response(
            JSON.stringify({ error: "User not found" }),
            {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              status: 404,
            }
          );
        }
        
        // password 필드 제거
        const { password, ...userWithoutPassword } = user;
        
        return new Response(JSON.stringify(userWithoutPassword), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          status: 200,
        });
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "Invalid token" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 401,
          }
        );
      }
    }

    // Parse request body
    let body: RequestBody;
    try {
      const bodyText = await req.text();
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        }
      );
    }
    
    const { identifier, password, token, type } = body;
    
    // 게스트 생성 (POST /user 또는 POST /user/)
    if (req.method === "POST" && (pathname.endsWith("/user") || pathname.endsWith("/user/"))) {
      if (identifier || password || token || type) {
      return new Response(
          JSON.stringify({ error: "Guest creation should not include other fields" }),
        {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        }
      );
    }
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

      return new Response(jwtToken, {
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
        status: 201,
      });
    }

    // 회원가입 (POST /user/sign-up)
    if (req.method === "POST" && pathname.endsWith("/sign-up")) {
      // 기존 게스트 업그레이드인지 확인
      if (authorization) {
        let userId: number;
        try {
          userId = getUserIdFromToken(authorization);
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Invalid token" }),
            {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              status: 401,
            }
          );
        }
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

        return new Response(jwtToken, {
          headers: {
            "Content-Type": "text/plain",
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

        return new Response(jwtToken, {
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
          },
          status: 201,
        });
      }
    }

    // 로그인 (POST /user/sign-in)
    if (req.method === "POST" && pathname.endsWith("/sign-in")) {
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

      return new Response(jwtToken, {
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        },
        status: 200,
      });
    }

    // OAuth 로그인 (POST /user/oauth-login 또는 POST /user/google-login, /user/kakao-login, /user/naver-login)
    // type 필드로 플랫폼 구분: type: "google", type: "kakao", type: "naver"
    if (req.method === "POST" && (
      pathname.endsWith("/oauth-login") || 
      pathname.endsWith("/google-login") || 
      pathname.endsWith("/kakao-login") || 
      pathname.endsWith("/naver-login")
    )) {
      // type 필드가 있으면 사용, 없으면 URL 경로에서 감지 (하위 호환성)
      let platform: string;
      if (type && (type === "google" || type === "kakao" || type === "naver")) {
        platform = type;
      } else if (pathname.endsWith("/google-login")) {
        platform = "google";
      } else if (pathname.endsWith("/kakao-login")) {
        platform = "kakao";
      } else if (pathname.endsWith("/naver-login")) {
        platform = "naver";
      } else {
        return new Response(
          JSON.stringify({ error: "type field is required for OAuth login. Use type: 'google', 'kakao', or 'naver'" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 400,
          }
        );
      }
      
      if (!token) {
        return new Response(
          JSON.stringify({ error: "token field is required for OAuth login" }),
          {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 400,
          }
        );
      }
      
      const platformId = await getPlatformIdFromOAuth(platform, token);

      if (authorization) {
        // 기존 게스트 업그레이드
        let userId: number;
        try {
          userId = getUserIdFromToken(authorization);
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Invalid token" }),
            {
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              status: 401,
            }
          );
        }
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
          return new Response(jwtToken, {
            headers: {
              "Content-Type": "text/plain",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }

        const { data: user, error } = await supabase
          .from("user")
          .update({
            platform_id: platformId,
            platform: platform,
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

        return new Response(jwtToken, {
          headers: {
            "Content-Type": "text/plain",
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
          return new Response(jwtToken, {
            headers: {
              "Content-Type": "text/plain",
              "Access-Control-Allow-Origin": "*",
            },
            status: 200,
          });
        }

        const { data: user, error } = await supabase
          .from("user")
          .insert({
            platform_id: platformId,
            platform: platform,
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

        return new Response(jwtToken, {
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
          },
          status: 201,
        });
      }
    }

    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
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
  if (!authorization) {
    throw new Error("Authorization header is required");
  }
  
  // Handle both "Bearer token" and plain token formats
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;
  
  if (!token || token.trim() === "") {
    throw new Error("Token is missing");
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number };
    return decoded.id;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}

async function getPlatformIdFromOAuth(
  platform: string,
  token: string
): Promise<string> {
  // @ts-ignore: Deno is available at runtime
  const KAKAO_CLIENT_ID = Deno.env.get("KAKAO_CLIENT_ID");
  // @ts-ignore: Deno is available at runtime
  const KAKAO_REDIRECT_URL = Deno.env.get("KAKAO_REDIRECT_URL");
  // @ts-ignore: Deno is available at runtime
  const NAVER_CLIENT_ID = Deno.env.get("NAVER_CLIENT_ID");
  // @ts-ignore: Deno is available at runtime
  const NAVER_CLIENT_SECRET = Deno.env.get("NAVER_CLIENT_SECRET");
  // @ts-ignore: Deno is available at runtime
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

