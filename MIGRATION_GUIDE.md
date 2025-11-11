# MailPocket Backend - Supabase Edge Functions 리팩터링 완료

Express 기반 백엔드를 Supabase Edge Functions로 완전히 리팩터링했습니다.

## ✅ 완료된 작업

1. ✅ Supabase 폴더 구조 생성
2. ✅ Edge Functions 생성:
   - `user-auth`: 게스트 생성, 회원가입, 로그인, OAuth (Google, Kakao, Naver)
   - `mail-recv`: 메일 수신, 파싱, OpenAI 요약, DB 저장, Slack 알림
   - `newsletter`: 뉴스레터 목록, 구독 관리, 카테고리 조회
   - `channel`: Slack 채널 연결 및 관리
   - `mail`: 메일 조회 및 재요약
3. ✅ 데이터베이스 마이그레이션 파일 생성
4. ✅ 설정 파일 생성 (`config.toml`)
5. ✅ README 문서 작성

## 📦 생성된 파일 구조

```
supabase/
├── functions/
│   ├── user-auth/
│   │   ├── index.ts
│   │   └── README.md
│   ├── mail-recv/
│   │   └── index.ts
│   ├── newsletter/
│   │   └── index.ts
│   ├── channel/
│   │   └── index.ts
│   └── mail/
│       └── index.ts
├── migrations/
│   └── 20240101000000_initial_schema.sql
├── config.toml
└── README.md
```

## 🚀 다음 단계

1. **Supabase 프로젝트 설정**
   - Supabase Dashboard에서 프로젝트 생성
   - `supabase link --project-ref <your-project-ref>` 실행

2. **환경 변수 설정**
   - Supabase Dashboard → Project Settings → Edge Functions → Secrets
   - 필요한 모든 환경 변수 설정

3. **데이터베이스 마이그레이션**
   - SQL Editor에서 마이그레이션 파일 실행

4. **Storage 버킷 생성**
   - `mails` 버킷 생성

5. **함수 배포**
   ```bash
   supabase functions deploy user-auth
   supabase functions deploy mail-recv
   supabase functions deploy newsletter
   supabase functions deploy channel
   supabase functions deploy mail
   ```

## 🔧 주요 변경사항

- **Express 제거**: 모든 Express 라우터를 Edge Functions로 전환
- **Docker 제거**: 더 이상 Docker가 필요하지 않음
- **Supabase Storage**: AWS S3 대신 Supabase Storage 사용
- **서버리스**: 모든 함수가 서버리스로 실행됨
- **자동 스케일링**: Supabase가 자동으로 스케일링 처리

## 📝 참고사항

- 모든 함수는 CORS를 지원합니다
- JWT 토큰은 30일 유효기간을 가집니다
- `newsletter` 함수의 `not_subscribed` 필터는 메모리에서 처리됩니다 (성능 최적화 가능)
- `mail-recv` 함수는 비동기로 처리되며 즉시 응답을 반환합니다

## 🐛 알려진 제한사항

- Supabase의 서브쿼리 제한으로 인해 일부 쿼리는 두 단계로 나누어 처리됩니다
- `newsletter` 함수의 `not_subscribed` 필터는 메모리 필터링을 사용합니다

## 📚 추가 문서

자세한 API 문서는 `supabase/README.md`를 참조하세요.

