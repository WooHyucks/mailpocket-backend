# Mail Receive Edge Function

이메일을 수신하고 처리하는 Edge Function입니다. AWS S3에 저장된 이메일 파일을 다운로드하여 파싱하고, OpenAI를 사용해 요약을 생성한 후 데이터베이스에 저장하고 구독자에게 Slack 알림을 전송합니다.

## Endpoints

### POST /functions/v1/mail-recv

이메일을 수신하고 처리합니다.

#### Request Body

```json
{
  "s3_object_key": "string (required)"
}
```

**Parameters:**
- `s3_object_key` (required): AWS S3의 `mailpocket-email` 버킷에 저장된 이메일 파일의 키

#### Response

**Success (200):**
```json
{
  "ok": true,
  "message": "Email received and processed successfully",
  "mail_id": 123
}
```

**Error Responses:**

- `400 Bad Request`: 필수 파라미터 누락 또는 알 수 없는 발신자 이메일
  ```json
  {
    "error": "s3_object_key is required"
  }
  ```
  또는
  ```json
  {
    "error": "Unknown from email: example@newsletter.com"
  }
  ```

- `404 Not Found`: 이메일 파일을 다운로드할 수 없음
  ```json
  {
    "error": "Failed to download email file"
  }
  ```

- `500 Internal Server Error`: 서버 내부 오류
  ```json
  {
    "error": "Internal server error"
  }
  ```

## 처리 흐름

1. **이메일 다운로드**: AWS S3에서 이메일 파일 다운로드
2. **이메일 파싱**: `mailparser`를 사용하여 이메일 내용 파싱
   - 발신자 이메일 주소 및 이름 추출
   - 제목 추출
   - HTML 본문 추출
3. **Slack 로깅**: 수신된 이메일을 Slack 로깅 채널에 알림
4. **뉴스레터 확인**: 발신자 이메일 주소로 뉴스레터 조회
   - 알 수 없는 이메일인 경우 Slack에 알림 후 에러 반환
5. **요약 생성**: OpenAI GPT를 사용하여 이메일 본문 요약 생성
   - 최대 3회 재시도
   - 실패 시 기본 메시지 반환
6. **데이터베이스 저장**: 
   - `mail` 테이블에 이메일 정보 저장
   - `newsletter` 테이블의 `last_recv_at` 업데이트
7. **Slack 알림 전송**: 구독자들의 Slack 채널에 알림 전송
   - 중복 채널 알림 방지 (같은 `slack_channel_id`는 한 번만 알림)

## 환경 변수

다음 환경 변수가 필요합니다:

- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SERVICE_ROLE_KEY`: Supabase 서비스 역할 키
- `OPENAI_API_KEY`: OpenAI API 키
- `AWS_ACCESS_KEY_ID`: AWS 액세스 키 ID
- `AWS_SECRET_ACCESS_KEY`: AWS 시크릿 액세스 키
- `AWS_REGION` (optional): AWS 리전 (기본값: `us-east-1`)
- `SLACK_LOGGING_CHANNEL_WEBHOOK_URL` (optional): 이메일 로깅용 Slack 웹훅 URL
- `SLACK_UNKNOWN_EMAIL_ADDRESS_WEBHOOK_URL` (optional): 알 수 없는 이메일 알림용 Slack 웹훅 URL

## 주요 기능

### 1. 이메일 파싱
- `mailparser` 라이브러리를 사용하여 이메일 파싱
- 발신자 정보, 제목, HTML 본문 추출
- 발신자 이름과 이메일 주소 분리

### 2. OpenAI 요약 생성
- GPT-3.5-turbo 모델 사용
- 뉴스 기사 형식의 요약 생성
- JSON 형식으로 반환 (주제: 내용)
- 최대 3회 재시도 메커니즘

### 3. Slack 통합
- 이메일 수신 로깅
- 알 수 없는 이메일 알림
- 구독자에게 뉴스레터 알림 전송
- UTM 파라미터를 포함한 링크 생성

### 4. 데이터베이스 작업
- `mail` 테이블에 이메일 저장
- `newsletter` 테이블의 마지막 수신 시간 업데이트
- `subscribe` 테이블을 통한 구독자 조회
- `channel` 테이블을 통한 Slack 채널 정보 조회

## 요약 형식

OpenAI가 생성하는 요약은 다음과 같은 형식을 따릅니다:

```json
{
  "주제 1": "내용 1 (3-4문장)",
  "주제 2": "내용 2 (3-4문장)",
  ...
}
```

각 주제는 한 줄 요약이며, 내용은 서론-본론-결론 구조의 3-4문장으로 구성됩니다.

## 에러 처리

- **이메일 다운로드 실패**: AWS S3에서 파일을 다운로드할 수 없는 경우 404 에러 반환
- **알 수 없는 발신자**: Slack에 알림 후 400 에러 반환
- **요약 생성 실패**: 최대 3회 재시도 후 기본 메시지 사용
- **데이터베이스 오류**: 500 에러 반환
- **Slack 알림 실패**: 로그만 기록하고 계속 진행

## CORS

모든 요청에 대해 CORS가 활성화되어 있습니다:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: content-type`

## 사용 예시

```bash
curl -X POST https://your-project.supabase.co/functions/v1/mail-recv \
  -H "Content-Type: application/json" \
  -d '{
    "s3_object_key": "emails/2024/01/01/email-12345.eml"
  }'
```

**참고**: `s3_object_key`는 AWS S3 버킷(`mailpocket-email`) 내의 객체 키입니다.

## 관련 테이블

- `mail`: 이메일 정보 저장
- `newsletter`: 뉴스레터 정보
- `newsletter_email_addresses`: 뉴스레터 이메일 주소 매핑
- `subscribe`: 사용자-뉴스레터 구독 관계
- `channel`: 사용자 Slack 채널 정보

## 주의사항

- 이 함수는 비동기적으로 처리되며, 요약 생성과 Slack 알림 전송에 시간이 걸릴 수 있습니다.
- OpenAI API 호출 비용이 발생할 수 있습니다.
- Slack 웹훅 URL이 설정되지 않은 경우 해당 기능은 동작하지 않습니다.

