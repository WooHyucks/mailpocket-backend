// supabase/functions/user-auth/README.md
# User Auth Edge Function

사용자 인증 관련 기능을 제공하는 Edge Function입니다.

## Endpoints

### POST /functions/v1/user-auth

#### Request Body

```json
{
  "type": "guest" | "sign-up" | "sign-in" | "google-login" | "kakao-login" | "naver-login",
  "identifier": "string (optional)",
  "password": "string (optional)",
  "token": "string (optional, for OAuth)",
  "authorization": "Bearer token (optional, for upgrade)"
}
```

#### Response

```json
{
  "token": "JWT token"
}
```

## Features

- 게스트 사용자 생성
- 회원가입 (일반 / 게스트 업그레이드)
- 로그인
- OAuth 로그인 (Google, Kakao, Naver)
- 게스트 → 회원 업그레이드

