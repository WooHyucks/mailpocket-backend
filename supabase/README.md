# MailPocket Backend - Supabase Edge Functions

MailPocket 백엔드를 Supabase Edge Functions로 리팩터링한 버전입니다.

## 📁 프로젝트 구조

```
supabase/
├── functions/
│   ├── user-auth/          # 사용자 인증 (게스트, 회원가입, 로그인, OAuth)
│   ├── mail-recv/          # 메일 수신 및 요약 처리
│   ├── newsletter/         # 뉴스레터 목록 및 구독 관리
│   ├── channel/            # Slack 채널 관리
│   └── mail/               # 메일 조회 및 재요약
├── migrations/
│   └── 20240101000000_initial_schema.sql
└── config.toml
```

## 🚀 배포 방법

### 1. Supabase CLI 설치

```bash
npm install -g supabase
```

### 2. Supabase 로그인 및 프로젝트 연결

```bash
supabase login
supabase link --project-ref your-project-ref
```

### 3. 환경 변수 설정

Supabase Dashboard → Project Settings → Edge Functions → Secrets에서 다음 변수들을 설정하세요:

- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service Role Key
- `JWT_SECRET_KEY`: JWT 시크릿 키
- `OPENAI_API_KEY`: OpenAI API 키
- `SLACK_CLIENT_ID`: Slack Client ID
- `SLACK_CLIENT_SECRET`: Slack Client Secret
- `SLACK_LOGGING_CHANNEL_WEBHOOK_URL`: Slack 로깅 웹훅 URL
- `SLACK_UNKNOWN_EMAIL_ADDRESS_WEBHOOK_URL`: 알 수 없는 이메일 알림 웹훅 URL
- `KAKAO_CLIENT_ID`: 카카오 OAuth Client ID (선택)
- `KAKAO_REDIRECT_URL`: 카카오 OAuth Redirect URL (선택)
- `NAVER_CLIENT_ID`: 네이버 OAuth Client ID (선택)
- `NAVER_CLIENT_SECRET`: 네이버 OAuth Secret (선택)
- `NAVER_STATE`: 네이버 OAuth State (선택)

### 4. 데이터베이스 마이그레이션

Supabase Dashboard → SQL Editor에서 `supabase/migrations/20240101000000_initial_schema.sql` 파일의 내용을 실행하세요.

### 5. Storage 버킷 생성

Supabase Dashboard → Storage에서 `mails` 버킷을 생성하세요.

### 6. Edge Functions 배포

```bash
# 각 함수별로 배포
supabase functions deploy user-auth
supabase functions deploy mail-recv
supabase functions deploy newsletter
supabase functions deploy channel
supabase functions deploy mail
```

## 🌐 API 엔드포인트

모든 엔드포인트는 `https://your-project-ref.supabase.co/functions/v1/` 접두사를 사용합니다.

### User Auth (`/functions/v1/user-auth`)

- **POST** `/functions/v1/user-auth`
  - 게스트 생성, 회원가입, 로그인, OAuth 로그인
  - Request Body: `{ type, identifier?, password?, token?, authorization? }`

### Mail Receive (`/functions/v1/mail-recv`)

- **POST** `/functions/v1/mail-recv`
  - 메일 수신 및 요약 처리
  - Request Body: `{ s3_object_key }`

### Newsletter (`/functions/v1/newsletter`)

- **GET** `/functions/v1/newsletter?subscribe_status=&sort_type=&in_mail=&cursor=&category_id=`
  - 뉴스레터 목록 조회
  - Headers: `Authorization: Bearer <token>`

- **GET** `/functions/v1/newsletter/categories`
  - 카테고리 목록 조회

- **GET** `/functions/v1/newsletter/:id/mail`
  - 뉴스레터 상세 및 메일 목록

- **GET** `/functions/v1/newsletter/:id/last-mail`
  - 뉴스레터의 최신 메일

- **POST** `/functions/v1/newsletter/:id/subscribe`
  - 뉴스레터 구독

- **DELETE** `/functions/v1/newsletter/:id/subscribe`
  - 뉴스레터 구독 취소

- **PUT** `/functions/v1/newsletter/subscribe`
  - 뉴스레터 일괄 구독
  - Request Body: `{ ids: number[] }`

### Channel (`/functions/v1/channel`)

- **GET** `/functions/v1/channel`
  - 사용자의 Slack 채널 목록

- **GET** `/functions/v1/channel/:id`
  - 특정 채널 정보

- **POST** `/functions/v1/channel`
  - Slack 워크스페이스 연결
  - Request Body: `{ code }`

- **DELETE** `/functions/v1/channel/:id`
  - 채널 삭제

### Mail (`/functions/v1/mail`)

- **GET** `/functions/v1/mail?key=<s3_object_key>`
  - 메일 상세 조회

- **PATCH** `/functions/v1/mail/summary-again?key=<s3_object_key>`
  - 메일 재요약

## 🔧 로컬 개발

```bash
# 로컬 Supabase 시작
supabase start

# 함수 로컬 실행
supabase functions serve user-auth
supabase functions serve mail-recv
# ...
```

## 📝 주요 변경사항

1. **Express → Supabase Edge Functions**: 모든 API가 서버리스 함수로 전환
2. **Docker 제거**: 더 이상 Docker가 필요하지 않음
3. **Supabase Storage 사용**: AWS S3 대신 Supabase Storage 사용
4. **자동 배포**: `supabase functions deploy` 명령어로 간단히 배포

## ⚠️ 주의사항

- `mail-recv` 함수에서 채널 조회 시 서브쿼리 대신 두 단계로 나누어 조회합니다.
- `newsletter` 함수에서 구독 필터링도 두 단계로 처리합니다.
- 모든 함수는 CORS를 지원합니다.
- JWT 토큰은 30일 유효기간을 가집니다.

