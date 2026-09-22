# JARVIS Core 빌드 가이드

음성으로 말하면 대답하고, 실제 도구(날씨·대기질·환율·위키·공휴일·헤드라인·타이머)를 쓰는 영화 스타일 음성 비서를 Vercel에 배포하는 가이드예요. 2026-09-16 기준 배포본(`https://jarvis-vercel-beta.vercel.app`)과 똑같은 결과물을 만들 수 있어요.

이 문서 하나에 명세, 구현 순서, 그동안 겪은 함정, 테스트 방법, 그리고 **파일 원본 전체**(맨 아래 부록)가 들어 있어요.

---

## Claude Code에게 이렇게 말하세요

> 이 가이드(`JARVIS_BUILD_GUIDE.md`)대로 JARVIS Core를 구현하고 Vercel에 배포해줘. 부록의 파일은 추출 스크립트로 그대로 꺼내고, 검증 단계를 모두 통과한 뒤에 배포해. API 키와 비밀번호는 내가 직접 넣을게.

### Claude Code가 지켜야 할 규칙

- 부록 파일은 **다시 쓰지 말고 추출 스크립트로 그대로 꺼낸다.** 추출한 뒤 SHA-256이 부록 표와 같은지 확인한다.
- `GROQ_API_KEY`와 `JARVIS_PASSWORD` 값은 **사용자가 직접 입력한다.** Claude는 키나 비밀번호를 받거나 입력하지 않고, `vercel env pull`로 비밀값을 로컬에 내려받지도 않는다.
- 프로젝트 폴더 안에 `.claude/` 같은 작업용 파일을 남기지 않는다. Vercel이 폴더 전체를 공개 사이트로 올린다.
- 검증 단계(§5)를 건너뛰지 않는다. 실패하면 배포하지 말고 결과를 그대로 보고한다.

---

## 1. 결과물

| 영역 | 내용 |
|---|---|
| 화면 | 영화 속 JARVIS 스타일 홀로그램 HUD 코어, 15개 에이전트 노드가 도는 3D 구, 대화 말풍선, 결과 카드 창, 원형 음성 이퀄라이저 |
| 음성 | Groq Whisper 음성 인식(한국어·영어 자동 감지, 녹음되는 모든 브라우저) + 브라우저 음성 합성(한국어·영어 목소리 자동 선택). 로그인 전이나 녹음이 안 되면 Chrome 음성 인식으로 대체. 박수 두 번으로 깨우기 |
| 두뇌 | Vercel 서버 함수 `api/chat.js` → Groq(무료). 모델이 도구를 스스로 골라 호출 |
| 도구 | 날씨·4일 예보, 대기질(PM2.5·PM10), 환율, 위키 요약, 공휴일, 테크 헤드라인, 타이머. **모두 키 불필요** |
| 보안 | 공용 비밀번호 1개(`JARVIS_PASSWORD`). Groq 키는 서버에만 있고 브라우저로 가지 않음 |
| 테마 | Stark(청록 홀로그램 + 주황, 기본값) / Mignon(마젠타 + 노랑). 화면에서 바꾸면 기억됨 |
| 비용 | Vercel Hobby + Groq 무료 플랜 = 0원 |

### 파일 구조

```
jarvis-vercel/
├── index.html      # 화면 전체: HUD 캔버스, 음성, 대화, 결과 카드, 타이머, 테마 (빌드 과정 없음)
├── api/chat.js     # Vercel Node 서버 함수: 비밀번호 확인, Groq 도구 호출 루프, 도구 7개
├── api/transcribe.js # Vercel Node 서버 함수: 녹음 → Groq Whisper 받아쓰기(한국어·영어 감지)
├── package.json    # 의존성 없음
├── README.md
└── .env.example    # 환경변수 이름 안내 (실제 값은 넣지 않음)
```

프레임워크와 빌드 과정, npm 의존성이 모두 없어요. Vercel이 `index.html`은 정적 파일로, `api/chat.js`는 Node 함수로 자동 인식해요.

---

## 2. 동작 구조

```
[브라우저 index.html]
  말하기 → 녹음(말이 끝나면 자동 종료) → POST /api/transcribe → Groq Whisper → 글자 + 언어(ko/en)
  또는 입력창에 입력
     │
     ├─ "system check"  → 브라우저에서 바로 점검 (서버 안 거침)
     ├─ "what can you do" → 기능 카드 먼저 표시, 이어서 두뇌에게도 질문
     │
     └─ POST /api/chat  {password, messages, tz}
            │
            ▼
[Vercel 함수 api/chat.js]
  비밀번호 확인 → Groq 호출(tools 포함)
     ├─ 모델이 tool_calls 반환 → 서버가 도구 실행 → 결과를 다시 Groq에 → (최대 3회 반복)
     ├─ 도구 호출 실패 → 도구 없이 일반 대화로 대답 (이미 받은 도구 결과는 글로 넘김)
     └─ 응답 {text, cards, actions, tools, model}
            │
            ▼
[브라우저]
  cards → 오른쪽 결과 창 / actions(timer) → 카운트다운 / text → 말풍선 + 음성
  두뇌 연결 실패 → 날씨만 브라우저에서 직접 조회, 나머지는 "지금은 못 한다"고 솔직하게 대답
```

---

## 3. 서버 명세 — `api/chat.js`

### 요청과 응답

**요청:** `POST /api/chat`

```json
{ "password": "…", "messages": [{"role":"user","content":"100 dollars in won"}], "tz": "Asia/Seoul" }
```

- `ping: true`만 보내면 비밀번호만 확인하고 `{ok:true}`를 돌려줘요. 비밀번호 화면에서 써요.
- `messages`는 `user`와 `assistant` 역할만 받아요(최근 20개 = 약 10턴, 각 2,000자까지 — 기억 범위와 응답 속도 사이의 절충값. 기록이 많을수록 매번 보내는 프롬프트가 커져서 응답이 느려짐). `system`이나 `tool` 역할은 서버가 버려요.
- `tz`는 현재 시각을 알려주는 데 써요. 기본값은 `Asia/Seoul`이에요.
- `lang`(auto·ko·en): ko나 en이면 그 언어로만 대답하고, auto면 사용자가 쓴 언어로 대답해요.

**응답 (200)**

```json
{
  "text": "ROUTE: Finance\n\nOne hundred dollars is about one hundred thirty-six thousand won.",
  "cards": [{ "title": "currency · USD → KRW", "items": [{ "title": "100 USD = 135,915 KRW", "label": "ECB rate 2026-09-15", "desc": "1 USD = 1359.15 KRW", "url": "" }] }],
  "actions": [{ "type": "timer", "seconds": 1500, "label": "focus" }],
  "tools": ["convert_currency"],
  "model": "openai/gpt-oss-120b"
}
```

- `text` 첫 줄의 `ROUTE: <에이전트>`는 화면의 노드를 켜는 데만 써요. 실제로 일을 넘기지는 않아요.

**오류 코드**

| 코드 | error | 뜻 |
|---|---|---|
| 401 | `bad_password` | 비밀번호 틀림 |
| 400 | `no_messages` | 메시지 없음 |
| 405 | `method_not_allowed` | POST가 아님 |
| 429 | `rate_limited` | Groq 무료 한도 초과 |
| 500 | `server_missing_key` | `GROQ_API_KEY` 미설정 |
| 502 | `upstream` | Groq 실패. `message`에 `Groq 404: …`처럼 원인이 붙음 |

### 음성 인식 — `api/transcribe.js`

**요청:** `POST /api/transcribe?lang=auto|ko|en`

- 헤더: `x-jarvis-password`(encodeURIComponent로 인코딩한 비밀번호), `x-audio-type`(녹음 형식), `content-type: application/octet-stream`
- 본문: 녹음 원본(최대 4MB)

**응답:** `{ "text": "오늘 부산 날씨 어때?", "language": "ko", "model": "whisper-large-v3-turbo" }`

- 모델: `whisper-large-v3-turbo`, 404면 `whisper-large-v3`
- `lang`이 ko나 en이면 Whisper에 언어를 알려줘요(정확도가 올라가요). auto면 자동 감지예요.
- 무음 판정: 모든 구간의 `no_speech_prob`가 0.6보다 크면 빈 글자로 돌려줘요. "시청해주셔서 감사합니다" 같은 Whisper 환각 문구도 빈 글자로 바꿔요.
- 언어: 응답의 `language`(korean/english)를 쓰고, 없으면 한글이 들어 있는지로 판단해요.
- Vercel은 `application/octet-stream` 본문을 Buffer(`req.body`)로 넘겨줘요. 요청 본문 한도가 4.5MB라 녹음은 20초로 제한해요.
- 오류: 401 `bad_password` · 400 `empty_audio` · 413 `too_large` · 429 `rate_limited` · 500 `server_missing_key` · 502 `upstream`
- 무료 한도: 하루 2,000건, 오디오 28,800초. 한 번에 최소 10초로 계산돼요.

### 도구 7개 (키 전부 불필요)

| 도구 | 외부 API | 입력 | 돌려주는 것 |
|---|---|---|---|
| `get_weather` | `geocoding-api.open-meteo.com` + `api.open-meteo.com/v1/forecast` | city | 현재 기온·체감·날씨·습도·풍속, 4일 최고·최저·강수확률 |
| `get_air_quality` | `air-quality-api.open-meteo.com/v1/air-quality` | city | PM2.5·PM10(한국 환경부 기준 등급), US AQI, 자외선, 마스크 권고 |
| `convert_currency` | `api.frankfurter.dev/v1/latest` | amount, from, to | 유럽중앙은행 기준 환율과 환산액 |
| `wikipedia_summary` | `ko.wikipedia.org` 또는 `en.wikipedia.org`의 검색 + `/api/rest_v1/page/summary` | query, language(ko·en) | 한국어 또는 영문 위키 요약과 링크. 한국어판에 없으면 영문판 |
| `upcoming_holidays` | `date.nager.at/api/v3/NextPublicHolidays/{CC}` | country_code (기본 KR) | 다가오는 공휴일 5개. 연휴는 하나로 묶음 |
| `tech_headlines` | `hacker-news.firebaseio.com/v0` | count 1–5 | 상위 헤드라인과 점수, 링크 |
| `set_timer` | (없음) | minutes, seconds, label | 브라우저 타이머 액션. 최대 6시간 |

- 한국 기준 등급 — PM2.5: 좋음 ≤15, 보통 ≤35, 나쁨 ≤75, 그 이상은 매우 나쁨 / PM10: ≤30, ≤80, ≤150 (µg/m³)
- 한글 도시 이름(서울·부산·제주 등 30곳, `KO_CITY`)은 서버에서 영어로 바꿔요. 한국 도시는 `countryCode=KR`로 한국 안에서만 찾아요. 그냥 "Jeju"로 찾으면 에티오피아가 나와요.
- 외부 호출은 모두 7초 제한 시간이 있고, `User-Agent` 헤더를 붙여요(위키가 요구해요).
- 도구가 실패하면 예외를 던지지 않고 `{error:"…"}`를 모델에 넘겨요. 모델은 무엇이 실패했는지 말로 설명해요.

### 모델 선택 (중요)

```
GROQ_MODEL 환경변수 → 없으면 PREFERRED[0]
  ↓ 404 또는 "model_not_found / does not exist / decommissioned"
GET /openai/v1/models 로 이 키가 쓸 수 있는 목록 조회
  ↓ PREFERRED 순서대로 첫 번째 사용 가능 모델 선택 (없으면 whisper·guard·tts·compound를 뺀 첫 모델)
  ↓ 성공하면 activeModel로 기억 (함수 인스턴스가 살아 있는 동안)

PREFERRED = openai/gpt-oss-120b → llama-3.3-70b-versatile → openai/gpt-oss-20b → qwen/qwen3.8-27b → qwen/qwen3.6-27b
```

모델별 요청 옵션 (`modelOptions`)

| 모델 | 옵션 |
|---|---|
| `openai/gpt-oss-*` | `reasoning_effort:"low"`, `include_reasoning:false`, `max_completion_tokens:1200` |
| `qwen/*` | `reasoning_effort:"none"`, `reasoning_format:"hidden"`, `max_completion_tokens:600` |
| 그 외 | `max_completion_tokens:300` |

- 생각 과정이 있는 모델은 생각에 쓰는 토큰도 한도에 포함돼요. 그래서 한도를 넉넉히 줘요.
- `reasoning_format:"raw"`를 도구 호출과 같이 쓰면 400 에러가 나요.
- 도구 호출은 `temperature 0.4`로 보내요. `tool_use_failed` 에러가 나면 한 번만 `0.1`로 다시 시도해요.

### 실패 대비 순서

1. 429 → 바로 `rate_limited`
2. 400 `tool_use_failed` → 온도를 낮춰 1회 재시도
3. 그 밖의 실패, 3회 반복 초과, 빈 대답 → `plainReply()`: 도구 정의 없이 일반 대화로 대답해요. 이미 받은 도구 결과는 지시문에 글로 넣어요.
4. 그것도 실패 → 502와 함께 `Groq <상태코드>: <내용>`을 돌려줘요. 화면 노란 문구에 그대로 떠요.

실패는 모두 `console.error`로 Vercel 로그에 남아요. 키 값은 기록하지 않아요.

### 지시문(SYSTEM)의 핵심

- 대답은 소리 내어 읽으므로 1~3문장, 목록·마크다운·이모지 금지
- 사용자가 쓴 언어로 대답: 한국어는 해요체에 숫자는 아라비아 숫자+단위(25도, 13만 5천 원), 영어는 숫자를 단어로
- 도구 인수는 영어로(도시는 로마자, 통화는 ISO 코드). 위키만 한국어 사용자에게 ko판을 써요
- **할 수 있는 일**과 **아직 못 하는 일**(웹 검색·메일·캘린더·노션·SNS·파일·장기 기억)을 명시
- 도구 결과로 확인되지 않은 일을 "했다", "예약했다", "저장했다"고 말하지 않기
- "what can you do"에는 실제 기능 3~4개만 말하기
- 도시를 말하지 않으면 서울
- 첫 줄에 `ROUTE: <에이전트>` 형식

---

## 4. 화면 명세 — `index.html`

단일 파일이에요. 폰트는 Google Fonts의 Chakra Petch(제목), IBM Plex Mono(데이터)를 써요.

### 음성 입력과 언어

- 비밀번호로 들어온 뒤 녹음이 되는 브라우저면 **Whisper**를 써요. 마이크를 누르면 녹음이 시작되고, 말이 끝나고 1.2초 조용하면 자동으로 멈춰요. 다시 누르면 바로 멈추고, 최대 20초이며, 7초 동안 말이 없으면 취소돼요.
- 말소리 판정: 녹음 첫 0.3초로 방 소음 수준을 재고(최대 0.1), 그보다 0.08 이상 크면 말소리로 봐요.
- 녹음 형식: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`(Safari) → `audio/ogg` 중 브라우저가 되는 것
- 그 밖의 경우(로그인 전, 녹음 불가, Whisper 시작 실패)는 브라우저 음성 인식을 써요. 인식 언어는 Lang 메뉴를 따르고, Auto면 브라우저 언어를 따라요.
- **Lang 메뉴**(Auto·한국어·English, `localStorage.jarvis_lang`): Auto는 Whisper가 감지한 언어로, 한국어·English는 그 언어로 고정해요. 서버에도 `lang`으로 전달해요.
- **목소리:** 대답에 한글이 있으면 한국어 목소리(Google 한국의 > Yuna > 그 밖의 ko 목소리)를, 없으면 Voice 메뉴의 영어 목소리를 써요.
- 기능 카드, 오프라인 대답, 오프라인 날씨, 타이머 알림, 시스템 점검 문구도 마지막 대화 언어(`lastLang`)를 따라 한국어로 나와요.

### 입력 처리 순서 (`handleInput`)

1. `SYS_RE`(system check 등) → 브라우저에서 바로 점검. 두뇌와 도구는 **비밀번호 인증이 됐을 때만** ✓로 표시해요.
2. `CAP_RE`("what can you do", "뭐 할 수 있어" 등) → 기능 카드 8개를 결과 창에 먼저 띄워요.
3. `/api/chat` 호출 → `handleTools(out)`로 카드·타이머·로그 처리 → 대답을 말풍선과 음성으로. `handleTools`에서 화면 오류가 나도 두뇌 실패로 착각하지 않게 따로 감싸요.
4. 실패하면 401은 비밀번호 화면으로, 429는 "busy" 안내, 그 밖은 노란 문구에 원인을 표시해요.
5. 오프라인 대비: 날씨 문장이면 브라우저에서 open-meteo를 직접 조회해요.
6. 그 밖에는 `localBrain` → "지금은 두뇌에 연결할 수 없다"고 솔직하게 대답해요. **가짜로 '하는 척'하는 대답은 금지.**

### 타이머

- `set_timer` 액션을 받으면 버튼 줄에 주황 칩(`#timer`)이 떠요. 0.5초마다 갱신하고, 끝나면 삐 소리 3번과 "Your … timer is done."을 말해요. ✕로 취소할 수 있어요.
- 탭을 닫으면 타이머도 멈춰요. 이 사실은 도구 결과에도 적혀 있어요.

### 테마

- `<head>`의 짧은 스크립트가 첫 화면이 그려지기 전에 `<html data-core="stark|mignon">`을 붙여요. 저장값은 `localStorage.jarvis_theme`이고, 기본은 `stark`예요.
- CSS 색은 전부 토큰으로 써요. 마젠타 색 값은 `rgba(var(--m-rgb),a)` 형태로 바꿔 두었어요.

| 토큰 | Mignon (기본 :root) | Stark (`:root[data-core="stark"]`) |
|---|---|---|
| `--magenta` / `--m-rgb` | `#EC1C9E` / `236,28,158` | `#38CCFF` / `56,204,255` |
| `--magenta-deep` | `#C70080` | `#0A7FC4` |
| `--yellow` (포인트) | `#FFE000` | `#FFB547` |
| `--ink` / `--ink-dim` / `--ink-faint` | `#f4e9f2` / `#b79ac2` / `#7d6b8c` | `#E4F5FF` / `#94B9CD` / `#5E7E91` |
| `--bg-core` / `--bg-mid` / `--bg-gate` | `#0b0410` / `#050208` / `#17091f` | `#04121d` / `#020810` / `#061a28` |
| `--on-accent` (강조색 위 글자) | `#f4e9f2` | `#021019` |

- 캔버스 색은 JS의 `PALS.stark` / `PALS.mignon`(main, deep, hot, acc, star, starAlt, label, labelHot, neb)에서 가져와요.
- 테마를 바꾸면 `applyTheme()` → `buildHud()`로 미리 그려 둔 레이어를 다시 그려요.

### HUD 코어 레이어 (영화 JARVIS 스타일)

기준 반지름은 `Rb = min(화면 너비, 높이) × 0.078`이에요. 에너지(0~1.2)에 따라 `R = Rb × (0.94 + 0.12 × energy)`로 커지고, 부팅할 때 0.6배에서 시작해요. 링 합성은 `lighter`(빛 더하기)예요.

| 레이어 | 위치 (R 배수) | 설명 |
|---|---|---|
| 배경 번짐 | 0.2 ~ 4.2 | 에너지에 따라 밝아지는 원형 그라데이션 |
| 육각형 홀로그램 | 3.2 기준의 36~98% 띠 | 미리 그린 캔버스를 천천히 역회전 |
| 각도 다이얼 | 눈금 2.38 ~ 2.62, 숫자 2.78 | 눈금 180개(15개마다 긴 눈금), 30°마다 000~330 숫자. 미리 그림 |
| 레이더 스윕 | 1.12 ~ 2.34 | 원뿔형 그라데이션. 처리 중일 때 빠르고 밝아짐 |
| 조각 링 | 1.92 | 28조각, 7번째마다 주황. 반대 방향 회전 |
| 점선 가이드 | 1.55 / 3.3 | 얇은 점선 링과 외곽 링 |
| 바깥 괄호 호 | 3.05 | 3개. 하나는 주황, 길이가 숨 쉬듯 변함 |
| 빛줄기 | 3.3 | 외곽을 따라 도는 꼬리 14개. 반짝임의 핵심 |
| 원형 이퀄라이저 | 1.2부터 바깥으로 | 72개. 듣는 중엔 마이크 주파수(좌우 대칭), 대답 중엔 음성 레벨, 처리 중엔 물결 |
| 아크 리액터 코어 | 0 ~ 1 | 렌즈 그라데이션, 0.66에서 도는 코일 10개, 1과 0.4에 밝은 테두리 |
| 반짝이 입자 | 1.25 ~ 3.5 | 46개가 궤도를 돌고, 가장 밝을 때 십자 빛 |
| 파동 | 1.2 → 3.4 | 박수 순간 주황 파동, 활성 상태일 때 퍼지는 링 |
| 글자 | ±3.62 | 아래는 상태(STANDBY/LISTENING/PROCESSING/RESPONDING), 위는 `J.A.R.V.I.S · CORE 000`(에너지 수치) |

- **깜빡임:** 매 프레임 밝기를 0.93~1 사이에서 흔들고, 237프레임마다 3프레임 동안 다이얼과 조각 링이 흐려져요(신호 끊김 효과).
- **회전 속도:** `(1 + energy × 1.4) × (처리 중이면 2.6)`. 각도는 `S.hudA/hudB/hudC/sweep`에 누적해서 속도가 바뀌어도 튀지 않아요.
- **움직임 줄이기 설정** 사용자에게는 회전과 깜빡임을 끄고 정지 화면으로 보여줘요.
- 에이전트 구 반지름은 `min × 0.38`이에요(전에는 0.34). HUD와 겹치지 않게 넓혔어요.
- **성능:** 육각형과 다이얼만 크기 변경·테마 변경·폰트 로드 때 다시 그리고, 나머지는 매 프레임 그려요.

### 상태별 에너지

| 상태 | energy |
|---|---|
| 대기 | 0.12 + 0.06·sin(t) |
| 듣는 중 | 0.25 + 마이크 레벨 × 0.9 |
| 대답 중 | 0.3 + 음성 레벨 × 0.7 |
| 처리 중 | 0.4 + 0.12·sin(t) |
| 박수 | 최소 0.3 + flash × 0.85 |

---

## 5. 구현 순서

### 5-1. 파일 꺼내기

이 가이드가 있는 폴더에서 실행해요. `jarvis-vercel/` 폴더가 만들어져요.

```bash
python3 - <<'EOF'
import re, pathlib, hashlib
md = pathlib.Path("JARVIS_BUILD_GUIDE.md").read_text(encoding="utf-8")
# marker must start a line and the path has no spaces, so this script's own text never matches
files = re.findall(r"(?ms)^<!-- FILE: (\S+) sha256=([0-9a-f]{64}) -->\n````[a-z]*\n(.*?)\n````\n", md)
assert len(files) == 6, f"expected 6 files, found {len(files)}"
for path, digest, body in files:
    data = (body + "\n").encode("utf-8")
    ok = hashlib.sha256(data).hexdigest() == digest
    p = pathlib.Path("jarvis-vercel") / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    print(("OK  " if ok else "BAD ") + str(p))
    assert ok, "checksum mismatch — the guide was altered"
EOF
```

### 5-2. 로컬 검증 (배포 전 필수)

```bash
cd jarvis-vercel
node --check api/chat.js
node --check api/transcribe.js
python3 -c 'import re,subprocess,tempfile;h=open("index.html").read();f=tempfile.NamedTemporaryFile("w",suffix=".js",delete=False);f.write("\n".join(re.findall(r"<script>(.*?)</script>",h,re.S)));f.close();r=subprocess.run(["node","--check",f.name]);print("page script OK" if r.returncode==0 else "page script FAIL")'
```

도구 7개를 실제 API로 시험해요. Groq를 부르지 않아서 키가 필요 없어요.

```bash
node -e '
const {IMPL}=require("./api/chat.js");
(async()=>{
  for (const [n,a] of [["get_weather",{city:"Busan"}],["get_air_quality",{city:"Seoul"}],
    ["convert_currency",{amount:100,from:"USD",to:"KRW"}],["wikipedia_summary",{query:"Sam Altman"}],
    ["upcoming_holidays",{}],["tech_headlines",{count:3}],["set_timer",{minutes:25,label:"focus"}]]) {
    const o = await IMPL[n](a);
    console.log(o.result && o.result.error ? "FAIL" : "OK  ", n, JSON.stringify(o.result).slice(0,120));
  }
})();'
```

7개가 모두 `OK`여야 해요.

### 5-3. 배포

```bash
vercel whoami                                  # 로그인 확인
vercel deploy --prod --yes --name jarvis-vercel
```

### 5-4. 환경변수 — 사용자가 직접

Groq 무료 키는 https://console.groq.com → API Keys에서 만들어요(`gsk_…`).

터미널에서 사용자가 직접 실행하고, 값은 물어볼 때 붙여넣어요.

```bash
vercel env add GROQ_API_KEY production
```

```bash
vercel env add JARVIS_PASSWORD production
```

또는 Vercel → 프로젝트 → Settings → Environment Variables에서 넣어도 돼요. `GROQ_MODEL`은 넣지 않는 걸 권장해요(자동 선택).

⚠️ `JARVIS_PASSWORD`를 빼면 비밀번호 없이 누구나 무료 한도를 쓸 수 있어요.

### 5-5. 다시 배포하고 확인

환경변수는 다시 배포해야 적용돼요.

```bash
vercel deploy --prod --yes
curl -s -o /dev/null -w "page %{http_code}\n" https://<프로젝트>.vercel.app/
curl -s -w " api %{http_code}\n" -X POST -H "content-type: application/json" -d '{"messages":[{"role":"user","content":"hi"}]}' https://<프로젝트>.vercel.app/api/chat
```

- 페이지는 `200`, 비밀번호 없는 API 요청은 `401 {"error":"bad_password"}`가 나와야 해요.

### 5-6. 사용자 확인 (비밀번호가 필요해서 Claude는 할 수 없음)

Chrome에서 사이트를 열고 비밀번호를 넣은 뒤 한국어나 영어로 말해요.

| 말하기 | 기대 결과 |
|---|---|
| "what can you do?" | 기능 카드 8개 + 실제 기능만 말함. 왼쪽 로그에 `brain model openai/…` |
| "system check" | 5개 항목 모두 ✓ |
| "is the air bad today?" | PM2.5·PM10 카드 |
| "100 dollars in won" | 환율 카드 |
| "next holiday" | 공휴일 카드 |
| "timer 1 minute" | 주황 타이머 칩 → 1분 뒤 삐 소리와 음성 |
| "send an email to my team" | 아직 못 한다고 솔직하게 대답 |
| (한국어로) "오늘 미세먼지 어때?" | 한국어로 대답하고 한국어 목소리로 읽어줌. 로그에 `whisper ko` |
| (한국어로) "제주 날씨 어때?" | 제주시(대한민국) 날씨 카드 |

- 노란 문구가 뜨면 `Brain unreachable (Groq …)` 안의 내용을 확인해요.
- 서버 로그는 `vercel logs <배포 URL>`로 볼 수 있어요.

---

## 6. 알아둘 함정

| 증상 | 원인 | 해결 |
|---|---|---|
| `Groq 404 … llama-3.3-70b-versatile does not exist` | Groq에서 서비스가 종료된 것으로 보임. 다른 프로젝트에서도 같은 404가 보고됐고, Groq 문서 일부에는 아직 남아 있음 | 모델 자동 선택 로직. 모델 이름을 고정하지 말 것 |
| 예전 기본 모델 `llama-3.1-8b-instant` | 2026-08-16 종료 | 대체 모델은 `openai/gpt-oss-20b` |
| gpt-oss 대답이 비어 있음 | 생각 과정 토큰이 한도를 다 씀 | `include_reasoning:false`, `reasoning_effort:"low"`, `max_completion_tokens:1200` |
| 환율 API 301 | `api.frankfurter.app` 주소 변경 | `api.frankfurter.dev/v1` 사용 |
| 위키 403 | User-Agent 헤더 없음 | 헤더 추가 |
| 뉴스 API가 배포 사이트에서 막힘 | NewsAPI.org 무료 플랜은 localhost 전용, 기사도 24시간 지연 | 쓰지 말 것. 뉴스는 2단계 Groq 웹 검색으로 |
| 두뇌가 끊겨도 "초안 쓸게요" | 옛 코드가 미리 적힌 가짜 답을 냄 | `localBrain`은 솔직한 오프라인 안내만 |
| 로컬 미리보기 서버가 404 | macOS 보호 폴더(Downloads 등)를 서버가 못 읽음 | 보호되지 않는 임시 폴더로 복사해서 미리보기 |
| `/.claude/launch.json`이 공개됨 | 프로젝트 폴더 전체가 배포됨 | 작업 파일은 프로젝트 밖에 두거나 `.vercelignore`에 추가 |
| "제주 날씨"가 에티오피아로 나옴 | 날씨 검색이 "Jeju"를 에티오피아로 찾고, 한글 "서울"·"제주"는 결과가 없음 | 한글 도시 이름 표 + 한국 도시는 `countryCode=KR` |
| 조용했는데 "시청해주셔서 감사합니다"가 입력됨 | Whisper가 조용한 녹음에서 문장을 지어냄 | `no_speech_prob` 검사 + 환각 문구 걸러내기 |
| 한국어 대답이 어색한 목소리로 읽힘 | 컴퓨터에 좋은 한국어 음성이 없음 | Chrome의 "Google 한국의" 목소리 권장 |
| 짧은 한국어를 영어로 잘못 알아들음 | 짧은 말은 언어 감지가 헷갈릴 수 있음 | Lang 메뉴를 한국어로 고정 |
| 박수 두 번 웨이크가 잘 안 잡힘 | 공유 analyser의 `fftSize=128`(≈2.7ms 창)을 26ms마다 폴링해 대부분의 오디오를 놓침. 게다가 `getUserMedia({audio:true})`가 기본으로 켜는 자동게인·노이즈억제가 박수 같은 임펄스 소리를 눌러버림 | 박수 감지 전용 스트림을 `autoGainControl:false, noiseSuppression:false, echoCancellation:false`로 따로 열고, 그 analyser의 `fftSize`를 2048(≈43ms)로 키워 폴링 공백을 없앰. Whisper 녹음용 스트림은 그대로 둬서 받아쓰기 품질엔 영향 없음 |
| 웨이크워드로 시작한 대화가 조용해져도 안 끝남 | "Jarvis" 인식 직후 그 음성인식 세션이 마이크를 완전히 놓기도 전에 Whisper용 마이크를 새로 잡으려다, 녹음이 "녹음 중"으로는 뜨지만 실제로는 오디오도 못 받고 종료 이벤트도 안 나는 상태로 멈춤 | 웨이크워드 인식기가 진짜로 끝났다는 신호(`onend`, 400ms 타임아웃 보조)를 받은 뒤에 Whisper 녹음을 시작하도록 순서 변경 |
| 조용한 방이 아니면 대화가 안 끝남(생활 소음이 계속 "말하는 중"으로 잡힘) | 무음 판정 기준(floor)을 녹음 시작 300ms에 딱 한 번만 재고 끝까지 고정해서 씀. 그 이후 주변 소음이 그보다 커지면 영원히 "말하는 중"으로 오분류됨 | 3초마다 그 구간의 최저값으로 floor를 다시 앵커링. 실제 목소리는 단어·숨 사이 틈이 있어 안 걸리고, 꾸준한 생활 소음만 흡수됨 |
| 답변이 길면 음성이 중간에 소리 없이 끊김 | Chrome이 긴 `SpeechSynthesisUtterance`(대략 15초 이상)를 `onend`/`onerror` 없이 그냥 멈춰버리는 오래된 버그 | 답변을 짧은 조각(최대 80자, 마침표 없는 긴 문장은 단어 단위로 강제 분할)으로 쪼개 순차적으로 `speak()` 호출하는 큐 방식으로 변경. 처음엔 180자로 했다가 한국어는 글자당 발음 시간이 길어서 여전히 끊겨 80자로 더 줄임 |
| 소리는 다 나왔는데 화면이 계속 RESPONDING에 멈춤 | 문장 큐 방식으로 바꾼 뒤에도, 마지막 조각의 `onend`가 간헐적으로 아예 안 뜨는 경우가 있음(Chrome 음성 이벤트 신뢰성 문제) | 조각마다 글자 수 기반 예상 재생 시간의 안전장치 타이머를 같이 걸어서, `onend`가 안 와도 강제로 다음 단계로 넘어가게 함 |

---

## 7. 다음 단계 (아직 구현 안 됨)

| 단계 | 기능 | 필요한 것 |
|---|---|---|
| 2 | 웹 검색 결과 카드(`groq/compound-mini`). 한국어 음성 인식과 한국어 대답은 이미 완료 | 기존 `GROQ_API_KEY` |
| 3 | 오래 기억하기(Upstash Redis), 노션 저장·조회, 텔레그램 전송, 유튜브 성과 | 서비스별 무료 키 |
| 4 | 구글 캘린더, Gmail 요약, 인스타그램 인사이트 | OAuth 설정 |

⚠️ **3단계 전에 로그인 방식을 바꿔야 해요.** 지금은 공용 비밀번호 하나라서, 비밀번호를 아는 사람은 누구나 연결된 노션·메일에 접근할 수 있어요. Vercel 로그인 보호를 켜거나 Google 로그인을 붙이세요.

---

## 8. 현재 상태 (2026-09-16)

- 배포: `https://jarvis-vercel-beta.vercel.app`, Vercel 프로젝트 `jiwoo/jarvis-vercel`
- 서버 도구 7개: 실제 API로 시험 통과
- Groq 실패 대비와 모델 자동 선택: 가짜 Groq 응답으로 11가지 상황 시험 통과
- HUD와 테마: 로컬 미리보기에서 대기·처리 중·대답 중 화면 확인, 콘솔 에러 없음
- 한국어 지원: 음성 인식 서버 12가지 상황(가짜 Groq 응답), 한국어 대답 지시, 한글 도시 이름, 한국어 위키 시험 통과
- **확인이 남은 것:** 실제 Groq 대화와 실제 한국어 음성 인식. 비밀번호가 필요해서 사용자 확인 필요(§5-6)

### 업데이트 (2026-09-22)

- 배포: `https://jarvis-vercel-blush.vercel.app`, Vercel 프로젝트 `khchan04/jarvis-vercel`
- 실제 Groq 대화·한국어 음성 인식 사용자 확인 완료(§5-6 통과)
- 박수 두 번 웨이크 감지 개선 — 원인과 해결은 위 §6 표 참고. 배포본에서 재확인 완료
- 소스 저장소: `https://github.com/kheechan04/jarvis` (Private)

---

## 부록 — 파일 원본

아래 블록은 배포본과 **바이트 단위로 같아요.** 손으로 옮기지 말고 §5-1 스크립트로 꺼내세요. 각 블록 위의 `sha256`은 파일 끝 줄바꿈 1개를 포함한 값이에요.

| 파일 | 크기 | sha256 (앞 16자) |
|---|---|---|
| `index.html` | 88,744 bytes | `ee7588f2d3f1853d…` |
| `api/chat.js` | 25,304 bytes | `62a399e72470ba70…` |
| `api/transcribe.js` | 5,163 bytes | `c107dc29430268a8…` |
| `package.json` | 162 bytes | `6b7fad3c4dce8a46…` |
| `README.md` | 3,286 bytes | `66dd36009b772c04…` |
| `.env.example` | 291 bytes | `4dca9d87e66b0f3d…` |

### `index.html`

<!-- FILE: index.html sha256=ee7588f2d3f1853dbeb15a321e73aeb2e43c9521516493c9e747effeb8bf3e04 -->
````html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Jarvis Core · Voice</title>
<script>try{var t=localStorage.getItem("jarvis_theme");document.documentElement.setAttribute("data-core",t==="mignon"?"mignon":"stark")}catch(e){document.documentElement.setAttribute("data-core","stark")}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  :root{
    --bg:#080510;
    --bg2:#100a1a;
    --panel:rgba(20,12,30,0.55);
    --panel-line:rgba(var(--m-rgb),0.22);
    --ink:#f4e9f2;
    --ink-dim:#b79ac2;
    --ink-faint:#7d6b8c;
    --magenta:#EC1C9E;
    --magenta-deep:#C70080;
    --yellow:#FFE000;
    --cyan:#4fe0ff;
    --good:#39e6a8;
    --warn:#ffcf3a;
    --crit:#ff5470;
    --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
    --disp:"Chakra Petch",ui-sans-serif,system-ui,sans-serif;
    --m-rgb:236,28,158;
    --bg-core:#0b0410; --bg-mid:#050208; --bg-gate:#17091f;
    --card-title:#ff9ad8; --on-accent:#f4e9f2; --sbox:rgba(14,8,20,.98);
  }
  /* Stark theme — the film's cyan hologram with amber highlights */
  :root[data-core="stark"]{
    --magenta:#38CCFF; --magenta-deep:#0A7FC4; --m-rgb:56,204,255;
    --yellow:#FFB547;
    --panel:rgba(5,16,26,0.55); --panel-line:rgba(56,204,255,0.24);
    --ink:#E4F5FF; --ink-dim:#94B9CD; --ink-faint:#5E7E91;
    --bg-core:#04121d; --bg-mid:#020810; --bg-gate:#061a28;
    --card-title:#8FE3FF; --on-accent:#021019; --sbox:rgba(5,13,21,.98);
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  html{background:#000005}
  body{
    margin:0;
    background:
      radial-gradient(1100px 900px at 50% 44%, var(--bg-core) 0%, var(--bg-mid) 46%, #000005 100%);
    color:var(--ink);
    font-family:var(--disp);
    overflow:hidden;
    -webkit-font-smoothing:antialiased;
  }
  #stage{
    position:fixed; inset:0;
    display:grid;
    grid-template-rows:auto 1fr auto;
    height:100%;
  }

  /* ---- top bar ---- */
  header{
    display:flex; align-items:center; justify-content:space-between;
    gap:12px; padding:14px 18px;
    padding-top:calc(14px + env(safe-area-inset-top,0px));
    z-index:5;
  }
  .brand{display:flex; align-items:center; gap:11px; min-width:0}
  .brand .dot{
    width:10px;height:10px;border-radius:50%;
    background:var(--magenta);
    box-shadow:0 0 12px 2px var(--magenta);
    animation:blink 2.6s ease-in-out infinite;
  }
  .brand h1{
    margin:0; font-size:15px; font-weight:700; letter-spacing:.28em;
    text-transform:uppercase; white-space:nowrap;
  }
  .brand h1 span{color:var(--magenta)}
  .status-pill{
    font-family:var(--mono); font-size:10.5px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--ink-dim);
    border:1px solid var(--panel-line); border-radius:999px;
    padding:6px 12px; display:flex; align-items:center; gap:7px;
    background:var(--panel); backdrop-filter:blur(6px); white-space:nowrap;
  }
  .status-pill .led{width:7px;height:7px;border-radius:50%;background:var(--ink-faint)}
  .status-pill.linked .led{background:var(--good);box-shadow:0 0 8px var(--good)}
  .status-pill.local .led{background:var(--warn);box-shadow:0 0 8px var(--warn)}
  .hdr-right{display:flex; align-items:center; gap:9px}
  [hidden]{display:none!important}
  #gate{position:fixed; inset:0; z-index:30; display:grid; place-items:center;
    background:radial-gradient(800px 600px at 50% 40%, var(--bg-gate) 0%, var(--bg-mid) 60%, #000005 100%);
    padding:20px}
  #gate[hidden]{display:none!important}
  .gate-err{color:var(--crit); font-family:var(--mono); font-size:11px; margin:-4px 0 12px}
  .sbox{width:min(92vw,420px); background:var(--sbox); border:1px solid var(--panel-line);
    border-radius:16px; padding:20px; box-shadow:0 30px 80px rgba(0,0,0,.6)}
  .stitle{font-family:var(--disp); font-weight:700; letter-spacing:.18em; text-transform:uppercase;
    font-size:13px; color:var(--magenta); margin-bottom:8px}
  .snote{font-size:12px; line-height:1.55; color:var(--ink-dim); margin:0 0 14px}
  .sfield{display:flex; flex-direction:column; gap:5px; margin-bottom:12px}
  .sfield span{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-faint)}
  .sfield input{background:rgba(0,0,0,.4); border:1px solid var(--panel-line); border-radius:9px;
    padding:10px 12px; color:var(--ink); font-family:var(--mono); font-size:12.5px}
  .sfield input:focus{outline:none; border-color:var(--magenta); box-shadow:0 0 0 2px rgba(var(--m-rgb),.25)}
  .srow{display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap}
  .sbtn{padding:9px 14px; border-radius:9px; cursor:pointer; border:1px solid var(--panel-line);
    background:rgba(var(--m-rgb),.08); color:var(--ink); font-family:var(--disp); font-weight:600;
    font-size:12px; letter-spacing:.06em; text-transform:uppercase; transition:.16s}
  .sbtn:hover{background:rgba(var(--m-rgb),.2)}
  .sbtn.primary{background:var(--magenta); border-color:var(--magenta); color:var(--on-accent)}
  .sbtn:focus-visible{outline:2px solid var(--yellow); outline-offset:2px}

  /* ---- center stage ---- */
  main{position:relative; overflow:hidden}
  #core{position:absolute; inset:0; width:100%; height:100%; display:block}

  .center-hud{
    position:absolute; left:50%; top:50%;
    transform:translate(-50%,-50%);
    text-align:center; pointer-events:none;
    z-index:3; width:min(70%,320px);
  }
  .center-hud .state{
    font-size:12px; letter-spacing:.34em; text-transform:uppercase;
    font-weight:600; color:var(--yellow);
    text-shadow:0 0 14px rgba(255,224,0,.5);
  }
  .center-hud .hint{
    margin-top:6px; font-family:var(--mono); font-size:10.5px;
    letter-spacing:.12em; color:var(--ink-faint); text-transform:uppercase;
  }

  /* ---- telemetry log ---- */
  #log{
    position:absolute; left:16px; top:16px;
    width:min(31vw,230px); max-height:56%;
    overflow:hidden; pointer-events:none; z-index:2;
    font-family:var(--mono); font-size:10px; line-height:1.65;
    letter-spacing:.02em; color:var(--ink-dim);
    -webkit-mask-image:linear-gradient(180deg,transparent,#000 12%,#000 84%,transparent);
            mask-image:linear-gradient(180deg,transparent,#000 12%,#000 84%,transparent);
  }
  #log .row{opacity:.9}
  #log .row b{color:var(--magenta); font-weight:600}
  #log .row .ok{color:var(--good)}
  #log .row .rt{color:var(--yellow)}
  #log .ts{color:var(--ink-faint)}

  /* ---- transcript ---- */
  #convo{
    position:absolute; right:16px; bottom:16px;
    width:min(38vw,300px); max-height:60%;
    display:flex; flex-direction:column; justify-content:flex-end;
    gap:8px; z-index:2; pointer-events:none;
  }
  .bubble{
    font-size:13px; line-height:1.5; border-radius:13px; padding:9px 13px;
    backdrop-filter:blur(8px); border:1px solid var(--panel-line);
    max-width:100%; word-wrap:break-word; animation:rise .35s ease both;
  }
  .bubble.you{
    align-self:flex-end; background:rgba(var(--m-rgb),.14);
    border-color:rgba(var(--m-rgb),.4); color:var(--ink);
  }
  .bubble.jv{
    align-self:flex-start; background:rgba(18,10,26,.6); color:var(--ink);
  }
  .bubble .who{
    font-family:var(--mono); font-size:9px; letter-spacing:.18em;
    text-transform:uppercase; color:var(--ink-faint); display:block; margin-bottom:3px;
  }
  .bubble.jv .who{color:var(--magenta)}

  /* ---- bottom console ---- */
  footer{
    z-index:5; padding:10px 16px 16px;
    padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));
    display:flex; flex-direction:column; gap:10px; align-items:center;
  }
  #wave{width:100%; max-width:560px; height:46px; display:block}
  .controls{display:flex; align-items:center; gap:12px; width:100%; max-width:560px}
  .mic{
    flex:0 0 auto; width:60px; height:60px; border-radius:50%;
    border:1.5px solid var(--magenta); background:rgba(var(--m-rgb),.12);
    color:var(--ink); cursor:pointer; position:relative;
    display:grid; place-items:center; transition:.2s;
    box-shadow:0 0 0 0 rgba(var(--m-rgb),.5);
  }
  .mic svg{width:26px;height:26px}
  .mic:hover{background:rgba(var(--m-rgb),.22)}
  .mic:focus-visible{outline:2px solid var(--yellow); outline-offset:3px}
  .mic.on{
    background:var(--magenta); border-color:var(--yellow); color:var(--on-accent);
    box-shadow:0 0 22px 4px rgba(var(--m-rgb),.7);
    animation:mic-pulse 1.3s ease-out infinite;
  }
  .mic.busy{opacity:.5; cursor:progress}
  .mic.blocked{opacity:.45}
  .mic.blocked::after{content:""; position:absolute; inset:-1.5px; border-radius:50%;
    background:linear-gradient(45deg,transparent 46%,var(--crit) 46%,var(--crit) 54%,transparent 54%); opacity:.6}
  .wake-toggle[aria-disabled="true"]{opacity:.4; pointer-events:none}
  .txt{
    flex:1 1 auto; min-width:0;
    background:var(--panel); border:1px solid var(--panel-line);
    border-radius:12px; padding:12px 14px; color:var(--ink);
    font-family:var(--disp); font-size:14px; letter-spacing:.01em;
    backdrop-filter:blur(6px);
  }
  .txt::placeholder{color:var(--ink-faint)}
  .txt:focus{outline:none; border-color:var(--magenta); box-shadow:0 0 0 2px rgba(var(--m-rgb),.25)}
  .send{
    flex:0 0 auto; padding:12px 16px; border-radius:12px; cursor:pointer;
    border:1px solid var(--panel-line); background:rgba(var(--m-rgb),.14);
    color:var(--ink); font-family:var(--disp); font-weight:600; font-size:13px;
    letter-spacing:.08em; text-transform:uppercase; transition:.18s;
  }
  .send:hover{background:rgba(var(--m-rgb),.28)}
  .send:focus-visible{outline:2px solid var(--yellow); outline-offset:2px}
  .banner{
    font-family:var(--mono); font-size:11px; letter-spacing:.03em;
    color:var(--warn); text-align:center; max-width:560px; line-height:1.5;
  }
  .banner:empty{display:none}

  .wake-toggle{
    display:inline-flex; align-items:center; gap:8px; cursor:pointer;
    font-family:var(--mono); font-size:10.5px; letter-spacing:.13em;
    text-transform:uppercase; color:var(--ink-faint);
    background:var(--panel); border:1px solid var(--panel-line);
    border-radius:999px; padding:6px 13px; backdrop-filter:blur(6px);
    transition:.2s;
  }
  .wake-toggle:hover{color:var(--ink-dim); border-color:rgba(var(--m-rgb),.4)}
  .wake-toggle:focus-visible{outline:2px solid var(--yellow); outline-offset:2px}
  .wake-toggle .cdot{width:7px;height:7px;border-radius:50%;background:var(--ink-faint);transition:.2s}
  .wake-toggle[aria-pressed="true"]{
    color:var(--yellow); border-color:var(--magenta);
    box-shadow:0 0 16px rgba(var(--m-rgb),.4);
  }
  .wake-toggle[aria-pressed="true"] .cdot{
    background:var(--yellow); box-shadow:0 0 8px var(--yellow);
    animation:blink 1s ease-in-out infinite;
  }
  .wakerow{display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center}
  .voice-sel{display:inline-flex; align-items:center; gap:7px; font-family:var(--mono);
    font-size:10px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-faint)}
  .voice-sel select{
    background:var(--panel); color:var(--ink); border:1px solid var(--panel-line);
    border-radius:999px; padding:5px 10px; font-family:var(--mono); font-size:10.5px;
    max-width:160px; cursor:pointer;
  }
  .voice-sel select:focus-visible{outline:2px solid var(--yellow); outline-offset:2px}

  /* dark "browser window" for search results */
  #results{
    position:absolute; z-index:4; right:16px; top:60px;
    width:min(40vw,360px); max-height:64%;
    display:flex; flex-direction:column; overflow:hidden;
    background:rgba(9,5,15,0.94); border:1px solid var(--panel-line); border-radius:14px;
    backdrop-filter:blur(12px);
    box-shadow:0 24px 70px rgba(0,0,0,.55), 0 0 0 1px rgba(var(--m-rgb),.12);
    opacity:0; transform:translateY(-10px) scale(.98); pointer-events:none;
    transition:opacity .28s ease, transform .28s ease;
  }
  #results.show{opacity:1; transform:none; pointer-events:auto}
  #results .rtop{display:flex; align-items:center; gap:9px; padding:9px 11px;
    border-bottom:1px solid var(--panel-line); background:rgba(255,255,255,.025)}
  #results .lights{display:flex; gap:5px; flex:0 0 auto}
  #results .lights i{width:9px; height:9px; border-radius:50%; display:block; opacity:.9}
  #results .lights i:nth-child(1){background:#ff5f57}
  #results .lights i:nth-child(2){background:#febc2e}
  #results .lights i:nth-child(3){background:#28c840}
  #results .addr{flex:1; min-width:0; font-family:var(--mono); font-size:10.5px;
    color:var(--ink-dim); background:rgba(0,0,0,.35); border:1px solid var(--panel-line);
    border-radius:7px; padding:5px 9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  #results .rclose{flex:0 0 auto; border:none; background:none; color:var(--ink-faint);
    cursor:pointer; font-size:13px; line-height:1; padding:3px 5px; border-radius:6px}
  #results .rclose:hover{color:var(--ink); background:rgba(var(--m-rgb),.15)}
  #results .rlist{overflow-y:auto; padding:6px}
  #results a.card{display:block; text-decoration:none; padding:9px 10px; border-radius:9px;
    color:var(--ink); border:1px solid transparent}
  #results a.card+a.card{margin-top:2px}
  #results a.card:hover{background:rgba(var(--m-rgb),.12); border-color:rgba(var(--m-rgb),.25)}
  #results .card .t{font-size:12.5px; font-weight:600; color:var(--card-title); margin-bottom:2px; line-height:1.3}
  #results .card .u{font-family:var(--mono); font-size:9.5px; color:var(--good);
    margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  #results .card .s{font-size:11px; color:var(--ink-dim); line-height:1.45}

  /* countdown timer chip (set by the set_timer tool) */
  .timer{
    display:inline-flex; align-items:center; gap:8px;
    font-family:var(--mono); font-size:10.5px; letter-spacing:.13em; text-transform:uppercase;
    font-variant-numeric:tabular-nums; color:var(--yellow);
    background:var(--panel); border:1px solid var(--magenta);
    border-radius:999px; padding:5px 7px 5px 13px; backdrop-filter:blur(6px);
    box-shadow:0 0 16px rgba(var(--m-rgb),.35);
  }
  .timer[hidden]{display:none}
  .timer .tdot{width:7px;height:7px;border-radius:50%;background:var(--yellow);
    box-shadow:0 0 8px var(--yellow); animation:blink 1s ease-in-out infinite}
  .timer button{border:none; background:none; color:var(--ink-faint); cursor:pointer;
    font-size:11px; line-height:1; padding:3px 5px; border-radius:6px}
  .timer button:hover{color:var(--ink); background:rgba(var(--m-rgb),.15)}
  .timer button:focus-visible{outline:2px solid var(--yellow); outline-offset:2px}

  @keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes mic-pulse{0%{box-shadow:0 0 0 0 rgba(var(--m-rgb),.6)}100%{box-shadow:0 0 0 20px rgba(var(--m-rgb),0)}}

  @media (max-width:640px){
    #log{display:none}
    #convo{width:min(64vw,320px); max-height:40%}
    .brand h1{font-size:12.5px; letter-spacing:.2em}
    #results{left:12px; right:12px; width:auto; top:56px; max-height:52%}
    .voice-sel select{max-width:120px}
  }
  @media (prefers-reduced-motion:reduce){
    .brand .dot,.mic.on,.timer .tdot{animation:none}
  }

  /* Deliberately single dark theme — force the black-space ground
     even when the viewer runs a light theme. */
  :root[data-theme="light"] body,
  :root:not([data-theme="dark"]) body{
    background:radial-gradient(1100px 900px at 50% 44%, var(--bg-core) 0%, var(--bg-mid) 46%, #000005 100%);
    color:var(--ink);
  }
</style>
</head>
<body>

<div id="stage">
  <header>
    <div class="brand">
      <span class="dot" aria-hidden="true"></span>
      <h1>JARVIS<span>·</span>CORE</h1>
    </div>
    <div class="hdr-right">
      <div class="status-pill local" id="conn"><span class="led"></span><span id="connlabel">Booting</span></div>
    </div>
  </header>

  <main>
    <canvas id="core"></canvas>
    <div id="log" aria-hidden="true"></div>
    <div id="convo" aria-live="polite"></div>
    <div id="results" role="dialog" aria-label="Search results">
      <div class="rtop">
        <span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="addr" id="rAddr"></span>
        <button class="rclose" id="rclose" aria-label="Close results">✕</button>
      </div>
      <div class="rlist" id="rList"></div>
    </div>
  </main>

  <footer>
    <div class="wakerow">
      <button class="wake-toggle" id="clap" aria-pressed="false" title="Clap twice to start listening">
        <span class="cdot" aria-hidden="true"></span>
        <span class="clbl">Clap ×2 to wake · off</span>
      </button>
      <button class="wake-toggle" id="wakeword" aria-pressed="false" title="Say &quot;Jarvis&quot; / &quot;자비스&quot; to start listening, hands-free">
        <span class="cdot" aria-hidden="true"></span>
        <span class="wwlbl">Say "Jarvis" to wake · off</span>
      </button>
      <label class="voice-sel"><span>Voice</span><select id="voiceSel" aria-label="English voice"></select></label>
      <label class="voice-sel"><span>Lang</span><select id="langSel" aria-label="Language">
        <option value="auto">Auto</option><option value="ko">한국어</option><option value="en">English</option></select></label>
      <label class="voice-sel"><span>Theme</span><select id="themeSel" aria-label="Core theme">
        <option value="stark">Stark</option><option value="mignon">Mignon</option></select></label>
      <div class="timer" id="timer" hidden>
        <span class="tdot" aria-hidden="true"></span>
        <span id="timerLbl">timer</span>
        <button id="timerX" aria-label="Cancel timer" title="Cancel timer">✕</button>
      </div>
    </div>
    <canvas id="wave"></canvas>
    <div class="controls">
      <button class="mic" id="mic" aria-label="Start listening" title="Tap to speak">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3"></rect>
          <path d="M5 10a7 7 0 0 0 14 0"></path>
          <line x1="12" y1="17" x2="12" y2="21"></line>
          <line x1="8" y1="21" x2="16" y2="21"></line>
        </svg>
      </button>
      <input class="txt" id="txt" type="text" placeholder="…or type a command" autocomplete="off" aria-label="Type a command">
      <button class="send" id="send">Send</button>
    </div>
    <div class="banner" id="banner"></div>
  </footer>
</div>

<div id="gate">
  <form class="sbox" id="gateForm" autocomplete="off">
    <div class="stitle">Jarvis · Access</div>
    <p class="snote">Enter the access password to bring the core online.</p>
    <label class="sfield"><span>Password</span>
      <input id="gateInput" type="password" placeholder="••••••••" autocomplete="current-password"></label>
    <div class="gate-err" id="gateErr" hidden>Wrong password — try again.</div>
    <div class="srow">
      <button type="submit" id="gateGo" class="sbtn primary">Enter</button>
    </div>
  </form>
</div>

<script>
(function(){
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;

  /* ---------------- agents ---------------- */
  const AGENTS = ["Strategist","Researcher","Chief of Staff","Finance","Editor",
    "Memory","Design","Engineering","Calendar","Email","Social","Ops",
    "Marketing","Sales","Developer"];

  /* ---------------- shared state ---------------- */
  const S = {
    mode:"idle",          // idle | listening | thinking | speaking
    micLevel:0,           // 0..1 from real mic
    speakLevel:0,         // 0..1 synthetic while TTS
    active:null,          // active agent index
    activeUntil:0,
    t:0,
    rot:0,                // 3D spin angle
    mx:0,my:0,            // eased parallax (from pointer)
    mtx:0,mty:0,          // target parallax
    boot: reduce ? 1 : 0, // 0..1 boot-in progress
    linked:false,
    hudA:0, hudB:0, hudC:0, sweep:0   // HUD ring angles (accumulated so speed changes never jump)
  };
  const PLX = reduce ? 0.12 : 1;  // dampen parallax for reduced-motion

  /* ---------------- helpers ---------------- */
  const $ = id => document.getElementById(id);
  const now = () => performance.now();
  function clamp(v,a,b){return v<a?a:v>b?b:v;}
  function lerp(a,b,t){return a+(b-a)*t;}

  /* ---------------- telemetry log ---------------- */
  const logEl = $("log");
  const logRows = [];
  function stamp(){ const d=new Date(); return d.toTimeString().slice(0,8); }
  function log(html, cls){
    logRows.push(`<div class="row"><span class="ts">${stamp()}</span> ${html}</div>`);
    if(logRows.length>40) logRows.shift();
    logEl.innerHTML = logRows.join("");
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------------- transcript ---------------- */
  const convo = $("convo");
  function bubble(who, cls){
    const b=document.createElement("div");
    b.className="bubble "+cls;
    b.innerHTML=`<span class="who">${who}</span><span class="body"></span>`;
    convo.appendChild(b);
    while(convo.children.length>6) convo.removeChild(convo.firstChild);
    return b.querySelector(".body");
  }

  /* ---------------- state label ---------------- */
  const stateLabel=$("stateLabel"), stateHint=$("stateHint");
  function setMode(m, hint){
    S.mode=m;
    const map={idle:"STANDBY",listening:"LISTENING",thinking:"PROCESSING",speaking:"RESPONDING"};
    if(stateLabel) stateLabel.textContent=map[m]||m.toUpperCase();
    if(stateHint && hint!==undefined) stateHint.textContent=hint;
    micBtn.classList.toggle("on", m==="listening");
    micBtn.classList.toggle("busy", m==="thinking");
  }

  /* ---------------- theme palettes (canvas colours; CSS uses data-core) ---------------- */
  const PALS={
    stark:{ main:[56,204,255], deep:[10,110,190], hot:[215,248,255], acc:[255,181,71],
      star:[200,230,255], starAlt:[120,205,255], label:[165,210,232], labelHot:[255,214,150],
      neb:[[8,60,110],[20,40,120],[0,85,125]] },
    mignon:{ main:[236,28,158], deep:[199,0,128], hot:[255,205,236], acc:[255,224,0],
      star:[220,225,255], starAlt:[255,150,220], label:[222,192,228], labelHot:[255,236,120],
      neb:[[150,20,110],[90,30,150],[120,0,80]] }
  };
  const rgba=(c,a)=>"rgba("+c[0]+","+c[1]+","+c[2]+","+a+")";
  let themeName=document.documentElement.getAttribute("data-core")==="mignon"?"mignon":"stark";
  let PAL=PALS[themeName];
  function applyTheme(name){
    themeName=PALS[name]?name:"stark"; PAL=PALS[themeName];
    document.documentElement.setAttribute("data-core",themeName);
    try{ localStorage.setItem("jarvis_theme",themeName); }catch(e){}
    if(W) buildHud();
  }
  const themeSel=$("themeSel");
  if(themeSel){
    themeSel.value=themeName;
    themeSel.addEventListener("change",()=>{ applyTheme(themeSel.value); log('theme → <span class="ok">'+themeName+"</span>"); });
  }

  /* ==========================================================
     CANVAS 1 — core + agent network
     ========================================================== */
  const cv=$("core"), cx=cv.getContext("2d");
  let W=0,H=0,DPR=1,CXp=0,CYp=0,ringR=0;
  function resize(){
    DPR=Math.min(window.devicePixelRatio||1,2);
    const r=cv.getBoundingClientRect();
    W=r.width; H=r.height;
    cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR);
    cx.setTransform(DPR,0,0,DPR,0,0);
    CXp=W/2; CYp=H/2;
    ringR=Math.min(W,H)*0.38;
    buildHud();
  }
  window.addEventListener("resize",resize);

  /* ---- deep-space: starfield + nebula + 3D agent sphere ---- */
  const TILT=-0.42;                       // fixed camera tilt (radians)
  // unit vectors for each agent on a Fibonacci sphere
  const SPH=AGENTS.map((_,i)=>{
    const n=AGENTS.length;
    const y=1-(i/(n-1))*2;                 // 1 .. -1
    const rr=Math.sqrt(Math.max(0,1-y*y));
    const phi=Math.PI*(3-Math.sqrt(5))*i;  // golden angle
    return {x:Math.cos(phi)*rr, y:y*0.9, z:Math.sin(phi)*rr};
  });
  // starfield (fractional coords, parallax by depth)
  const STARS=[];
  for(let i=0;i<230;i++){
    STARS.push({x:Math.random(), y:Math.random(), z:Math.random(),
      tw:Math.random()*6.28, sp:0.15+Math.random()*0.9, pink:Math.random()<0.22});
  }
  // drifting nebula blobs
  const NEB=[
    {x:0.28,y:0.32,r:0.42,c:0,a:0.055,dx:0.006,dy:0.004},
    {x:0.74,y:0.62,r:0.48,c:1,a:0.045,dx:-0.005,dy:0.006},
    {x:0.55,y:0.20,r:0.34,c:2,a:0.035,dx:0.004,dy:-0.005}
  ];

  function drawSpace(){
    // nebula
    cx.save();
    cx.globalCompositeOperation="screen";
    for(const b of NEB){
      const c=PAL.neb[b.c];
      const px=(0.5+ (b.x-0.5+ Math.sin(S.t*0.002*b.dx*40)*0.03))*W - S.mx*22;
      const py=(0.5+ (b.y-0.5+ Math.cos(S.t*0.002*b.dy*40)*0.03))*H - S.my*18;
      const rad=b.r*Math.min(W,H);
      const g=cx.createRadialGradient(px,py,0,px,py,rad);
      g.addColorStop(0,rgba(c,b.a));
      g.addColorStop(1,rgba(c,0));
      cx.fillStyle=g; cx.beginPath(); cx.arc(px,py,rad,0,7); cx.fill();
    }
    cx.restore();
    // stars
    for(const s of STARS){
      const sx=((s.x*W + S.t*0.05*s.sp*(0.35+s.z))%W+W)%W - S.mx*40*(0.2+s.z);
      const sy=s.y*H - S.my*30*(0.2+s.z);
      const size=0.5+s.z*1.7;
      const tw=reduce?0.7:(0.45+0.55*Math.sin(S.t*0.02+s.tw));
      const alpha=(0.25+0.6*s.z)*tw;
      cx.fillStyle=rgba(s.pink?PAL.starAlt:PAL.star,alpha);
      cx.beginPath(); cx.arc(sx,sy,size,0,7); cx.fill();
    }
  }

  // rotate a unit vector by current spin + tilt, return projected screen data
  function project(u, R3, focal){
    const effRot = S.rot + S.mx*0.45;               // mouse yaw
    const effTilt = TILT + S.my*0.32;               // mouse pitch
    const c=Math.cos(effRot), s=Math.sin(effRot);
    let x=u.x*c - u.z*s, z=u.x*s + u.z*c, y=u.y;    // spin around Y
    const ct=Math.cos(effTilt), st=Math.sin(effTilt);
    const y2=y*ct - z*st, z2=y*st + z*ct;           // tilt around X
    const p=focal/(focal - z2*R3);                  // perspective (near=bigger)
    return {sx:CXp + x*R3*p, sy:CYp + y2*R3*p, p, depth:z2};
  }

  /* ---- holographic HUD core, after the JARVIS interface in the films ----
     Static layers (hex hologram, degree dial) are pre-rendered once per
     resize/theme and only rotated per frame; everything else is live. */
  const TAU=Math.PI*2;
  let Rb=0, hexCv=null, dialCv=null;
  const HEX_R=3.2, DIAL_R=2.95;            // layer radii in multiples of Rb
  const SPARKS=[];
  for(let i=0;i<46;i++) SPARKS.push({r:1.25+Math.random()*2.25, a:Math.random()*TAU,
    sp:(Math.random()<0.5?-1:1)*(0.0015+Math.random()*0.006), tw:Math.random()*TAU, s:0.5+Math.random()*1.3});
  const EQ=72, eqArr=new Array(EQ).fill(0);
  const STATE_TXT={idle:"STANDBY",listening:"LISTENING",thinking:"PROCESSING",speaking:"RESPONDING"};

  function offscreen(radius){
    const c=document.createElement("canvas");
    c.width=c.height=Math.ceil(radius*2*DPR);
    const g=c.getContext("2d");
    g.setTransform(DPR,0,0,DPR,0,0); g.translate(radius,radius);
    return [c,g];
  }

  function buildHud(){
    Rb=Math.min(W,H)*0.078;
    if(!Rb) return;
    // hex hologram band
    const HR=Rb*HEX_R, [hc,hg]=offscreen(HR), hs=Rb*0.26, hw=Math.sqrt(3)*hs;
    hg.lineWidth=0.7;
    const rows=Math.ceil(HR/(hs*1.5))+1, cols=Math.ceil(HR/hw)+1;
    for(let row=-rows; row<=rows; row++){
      for(let col=-cols; col<=cols; col++){
        const x=col*hw+(row&1?hw/2:0), y=row*hs*1.5, d=Math.hypot(x,y)/HR;
        if(d>0.98 || d<0.36) continue;
        hg.strokeStyle=rgba(PAL.main,(0.22*Math.sin(Math.PI*(d-0.36)/0.62)).toFixed(3));
        hg.beginPath();
        for(let k=0;k<6;k++){
          const an=Math.PI/3*k+Math.PI/6, px=x+hs*0.92*Math.cos(an), py=y+hs*0.92*Math.sin(an);
          k?hg.lineTo(px,py):hg.moveTo(px,py);
        }
        hg.closePath(); hg.stroke();
      }
    }
    hexCv=hc;
    // degree dial: fine ticks + numerals every 30°
    const DR=Rb*DIAL_R, [dc,dg]=offscreen(DR);
    for(let i=0;i<180;i++){
      const an=i/180*TAU, long=i%15===0, mid=i%5===0;
      const r1=Rb*2.38, r2=Rb*(long?2.62:mid?2.52:2.46);
      dg.strokeStyle=rgba(long?PAL.hot:PAL.main, long?0.85:mid?0.55:0.32);
      dg.lineWidth=long?1.4:0.8;
      dg.beginPath(); dg.moveTo(Math.cos(an)*r1,Math.sin(an)*r1); dg.lineTo(Math.cos(an)*r2,Math.sin(an)*r2); dg.stroke();
    }
    dg.font="500 "+Math.max(6.5,Rb*0.2).toFixed(1)+"px 'IBM Plex Mono',monospace";
    dg.fillStyle=rgba(PAL.main,0.7); dg.textAlign="center"; dg.textBaseline="middle";
    for(let deg=0;deg<360;deg+=30){
      const an=(deg-90)*Math.PI/180;
      dg.save(); dg.translate(Math.cos(an)*Rb*2.78, Math.sin(an)*Rb*2.78); dg.rotate(an+Math.PI/2);
      dg.fillText(String(deg).padStart(3,"0"),0,0); dg.restore();
    }
    dg.strokeStyle=rgba(PAL.main,0.35); dg.lineWidth=0.8;
    dg.beginPath(); dg.arc(0,0,Rb*2.36,0,TAU); dg.stroke();
    dialCv=dc;
  }

  function blit(img, radius, ang, scale, alpha){
    cx.save(); cx.globalAlpha=clamp(alpha,0,1);
    cx.translate(CXp,CYp); cx.rotate(ang); cx.scale(scale,scale);
    cx.drawImage(img,-radius,-radius,radius*2,radius*2);
    cx.restore();
  }

  // soft wide halo + crisp line (drawn additively, reads as a glow)
  function arcStroke(r, a0, a1, w, col, alpha){
    cx.strokeStyle=rgba(col,alpha*0.18); cx.lineWidth=w*3.2;
    cx.beginPath(); cx.arc(CXp,CYp,r,a0,a1); cx.stroke();
    cx.strokeStyle=rgba(col,alpha); cx.lineWidth=w;
    cx.beginPath(); cx.arc(CXp,CYp,r,a0,a1); cx.stroke();
  }

  function drawCore(R, energy){
    const t=S.t, boot=S.boot;
    const think=S.mode==="thinking", active=S.mode!=="idle";
    const spin=reduce?0:(1+energy*1.4)*(think?2.6:1);
    const fl=reduce?1:(0.93+Math.random()*0.07);       // holographic flicker
    const glitch=!reduce && (t%237<3);                  // brief dropout every ~4s
    S.hudA+=0.004*spin; S.hudB-=0.007*spin; S.hudC+=0.012*spin;

    cx.save();
    cx.globalCompositeOperation="lighter";
    cx.lineCap="butt";

    // ambient bloom
    let g=cx.createRadialGradient(CXp,CYp,R*0.2,CXp,CYp,R*4.2);
    g.addColorStop(0,rgba(PAL.main,((0.16+0.22*energy)*fl).toFixed(3)));
    g.addColorStop(0.35,rgba(PAL.deep,(0.07+0.06*energy).toFixed(3)));
    g.addColorStop(1,rgba(PAL.deep,0));
    cx.fillStyle=g; cx.beginPath(); cx.arc(CXp,CYp,R*4.2,0,TAU); cx.fill();

    // hex hologram + degree dial (pre-rendered, counter-rotating)
    const sc=R/Rb;
    if(hexCv) blit(hexCv, Rb*HEX_R, -S.hudA*0.4, sc, (0.55+0.35*energy)*boot*fl);
    if(dialCv) blit(dialCv, Rb*DIAL_R, S.hudA, sc, (glitch?0.25:0.9)*boot*fl);

    // radar sweep between the core and the dial
    if(cx.createConicGradient){
      if(!reduce) S.sweep+=think?0.06:0.018;
      const k=think?0.24:0.09;
      const cg=cx.createConicGradient(S.sweep,CXp,CYp);
      cg.addColorStop(0,rgba(PAL.main,0)); cg.addColorStop(0.86,rgba(PAL.main,0));
      cg.addColorStop(0.995,rgba(PAL.main,(k*fl).toFixed(3))); cg.addColorStop(1,rgba(PAL.main,0));
      cx.fillStyle=cg;
      cx.beginPath(); cx.arc(CXp,CYp,R*2.34,0,TAU); cx.arc(CXp,CYp,R*1.12,0,TAU,true); cx.fill();
    }

    // segmented ring, amber keys every seventh segment
    const segN=28, segR=R*1.92, segW=Math.max(2,R*0.09);
    for(let i=0;i<segN;i++){
      if(i/segN>boot) break;
      const hot=i%7===0, a0=S.hudB+i/segN*TAU, len=TAU/segN*(hot?0.35:0.72);
      cx.strokeStyle=rgba(hot?PAL.acc:PAL.main,((hot?0.9:0.5)*fl*(glitch&&i%3===0?0.2:1)).toFixed(3));
      cx.lineWidth=hot?segW*1.4:segW;
      cx.beginPath(); cx.arc(CXp,CYp,segR,a0,a0+len); cx.stroke();
    }
    // guide rings
    cx.setLineDash([2,5]); cx.lineWidth=1;
    cx.strokeStyle=rgba(PAL.main,(0.35*fl).toFixed(3));
    cx.beginPath(); cx.arc(CXp,CYp,R*1.55,0,TAU*boot); cx.stroke();
    cx.setLineDash([]);
    cx.strokeStyle=rgba(PAL.main,0.18);
    cx.beginPath(); cx.arc(CXp,CYp,R*3.3,0,TAU*boot); cx.stroke();

    // sweeping brackets on the outer track
    for(let k=0;k<3;k++){
      const a0=S.hudC*(k%2?-0.6:1)+k*TAU/3, len=(0.55+0.25*Math.sin(t*0.01+k))*boot;
      arcStroke(R*3.05, a0, a0+len, Math.max(1.5,R*0.05), k===0?PAL.acc:PAL.main, (0.75+0.25*energy)*fl);
    }
    // comet sheen racing round the rim — the "shimmer"
    const cm=S.hudC*1.7;
    cx.lineWidth=2;
    for(let j=0;j<14;j++){
      const aj=cm-j*0.035;
      cx.strokeStyle=rgba(PAL.hot,(0.55*(1-j/14)*fl).toFixed(3));
      cx.beginPath(); cx.arc(CXp,CYp,R*3.3,aj-0.035,aj); cx.stroke();
    }

    // radial voice equalizer — mic spectrum while listening, speech while replying
    cx.lineWidth=Math.max(1.2,R*0.045);
    for(let i=0;i<EQ;i++){
      let v;
      if(S.mode==="listening" && freqData) v=freqData[Math.floor((i%(EQ/2))/(EQ/2)*freqData.length*0.55)]/255;
      else if(S.mode==="listening") v=S.micLevel*Math.abs(Math.sin(i*0.7+t*0.2));
      else if(S.mode==="speaking") v=S.speakLevel*(0.35+0.65*Math.abs(Math.sin(i*0.9+t*0.33)*Math.cos(i*0.23-t*0.07)));
      else if(think) v=0.18*Math.abs(Math.sin(i*0.35+t*0.12));
      else v=0.05+0.04*Math.abs(Math.sin(i*0.25+t*0.03));
      eqArr[i]=lerp(eqArr[i],v,0.3);
      const e=eqArr[i], an=i/EQ*TAU-Math.PI/2, r1=R*1.2, r2=r1+R*(0.06+e*0.62);
      cx.strokeStyle=rgba(e>0.6?PAL.acc:PAL.main,((0.35+0.6*Math.min(1,e*1.4))*fl).toFixed(3));
      cx.beginPath(); cx.moveTo(CXp+Math.cos(an)*r1,CYp+Math.sin(an)*r1); cx.lineTo(CXp+Math.cos(an)*r2,CYp+Math.sin(an)*r2); cx.stroke();
    }

    // arc-reactor core: lens gradient, rotating coils, bright rims
    g=cx.createRadialGradient(CXp,CYp,0,CXp,CYp,R);
    g.addColorStop(0,rgba(PAL.hot,(0.95*fl).toFixed(3)));
    g.addColorStop(0.22,rgba(PAL.main,(0.55*fl).toFixed(3)));
    g.addColorStop(0.62,rgba(PAL.deep,0.18));
    g.addColorStop(0.9,rgba(PAL.main,(0.35+0.3*energy).toFixed(3)));
    g.addColorStop(1,rgba(PAL.main,0));
    cx.fillStyle=g; cx.beginPath(); cx.arc(CXp,CYp,R,0,TAU); cx.fill();
    const coilN=10;
    cx.lineWidth=R*0.16;
    cx.strokeStyle=rgba(PAL.main,((0.55+0.35*energy)*fl).toFixed(3));
    for(let i=0;i<coilN;i++){
      const a0=-S.hudA*1.5+i/coilN*TAU;
      cx.beginPath(); cx.arc(CXp,CYp,R*0.66,a0,a0+TAU/coilN*0.62); cx.stroke();
    }
    arcStroke(R, 0, TAU, 2, PAL.hot, (0.7+0.3*energy)*fl);
    arcStroke(R*0.4, 0, TAU, 1.2, PAL.hot, 0.6*fl);

    // shimmer sparks orbiting the rings, with a cross glint at peak twinkle
    for(const p of SPARKS){
      p.a+=p.sp*spin;
      const tw=reduce?0.6:0.5+0.5*Math.sin(t*0.08+p.tw);
      const x=CXp+Math.cos(p.a)*R*p.r, y=CYp+Math.sin(p.a)*R*p.r;
      const al=(tw*(0.35+0.5*energy)*boot).toFixed(3);
      cx.fillStyle=rgba(PAL.hot,al);
      cx.beginPath(); cx.arc(x,y,p.s,0,TAU); cx.fill();
      if(tw>0.93){
        const L=p.s*5;
        cx.strokeStyle=rgba(PAL.hot,al*0.8); cx.lineWidth=0.8;
        cx.beginPath(); cx.moveTo(x-L,y); cx.lineTo(x+L,y); cx.moveTo(x,y-L); cx.lineTo(x,y+L); cx.stroke();
      }
    }

    // clap flash + a ripple while listening/thinking/speaking
    if(S.flash) arcStroke(R*(1.1+(1-S.flash)*2.4), 0, TAU, 2, PAL.acc, 0.8*S.flash);
    if(active && !reduce){
      const p=(t*0.015)%1;
      cx.strokeStyle=rgba(PAL.main,(0.5*(1-p)).toFixed(3)); cx.lineWidth=1.5;
      cx.beginPath(); cx.arc(CXp,CYp,R*(1.2+p*2.2),0,TAU); cx.stroke();
    }
    cx.restore();

    // readouts (normal compositing keeps text crisp)
    cx.save();
    cx.textAlign="center"; cx.textBaseline="middle";
    if("letterSpacing" in cx) cx.letterSpacing="0.3em";
    cx.font="600 "+Math.max(9,R*0.3).toFixed(1)+"px 'Chakra Petch',sans-serif";
    cx.fillStyle=rgba(PAL.acc,(0.9*boot).toFixed(3));
    cx.shadowColor=rgba(PAL.acc,0.6); cx.shadowBlur=10;
    cx.fillText(STATE_TXT[S.mode]||"", CXp, CYp+R*3.62);
    cx.shadowBlur=0;
    if("letterSpacing" in cx) cx.letterSpacing="0.18em";
    cx.font="500 "+Math.max(7,R*0.2).toFixed(1)+"px 'IBM Plex Mono',monospace";
    cx.fillStyle=rgba(PAL.main,(0.65*boot).toFixed(3));
    cx.fillText("J.A.R.V.I.S · CORE "+String(Math.round(energy*100)).padStart(3,"0"), CXp, CYp-R*3.62);
    cx.restore();
  }

  function drawNode(n, i, energy){
    const isActive = S.active===i && now()<S.activeUntil;
    const p=n.p, front=n.depth>=0;
    // connector line (depth fades far ones)
    const lineA = clamp((p-0.55)/0.9,0.12,1);
    const grad=cx.createLinearGradient(CXp,CYp,n.sx,n.sy);
    if(isActive){
      grad.addColorStop(0,rgba(PAL.acc,0.9*lineA));
      grad.addColorStop(1,rgba(PAL.acc,0.15*lineA));
      cx.lineWidth=2*p;
    }else{
      grad.addColorStop(0,rgba(PAL.main,0.42*lineA));
      grad.addColorStop(1,rgba(PAL.main,0.04*lineA));
      cx.lineWidth=Math.max(0.5,1*p);
    }
    cx.strokeStyle=grad;
    cx.beginPath(); cx.moveTo(CXp,CYp); cx.lineTo(n.sx,n.sy); cx.stroke();

    // travelling pulse
    if(!reduce && front){
      const speed=isActive?0.9:0.28;
      const tp=((S.t*speed*0.01)+(i*0.13))%1;
      cx.fillStyle=isActive?rgba(PAL.acc,0.95):rgba(PAL.hot,0.55*lineA);
      cx.beginPath(); cx.arc(lerp(CXp,n.sx,tp),lerp(CYp,n.sy,tp),(isActive?3:1.7)*p,0,7); cx.fill();
    }

    // node dot (size & glow scale with depth)
    const nr=(isActive?6:3.2)*p;
    cx.fillStyle=isActive?rgba(PAL.acc,1):rgba(PAL.hot,1);
    cx.globalAlpha=clamp((p-0.5)/0.8,0.2,1);
    cx.shadowColor=isActive?rgba(PAL.acc,0.9):rgba(PAL.main,0.7);
    cx.shadowBlur=(isActive?16:8)*p;
    cx.beginPath(); cx.arc(n.sx,n.sy,nr,0,7); cx.fill();
    cx.shadowBlur=0; cx.globalAlpha=1;

    // label (fade far / behind ones)
    const labA=clamp((p-0.62)/0.7,0,1)*(front?1:0.55);
    if(labA>0.05){
      cx.font=(isActive?"700 ":"600 ")+(9.5*Math.max(0.8,p)).toFixed(1)+"px 'Chakra Petch',sans-serif";
      cx.fillStyle=isActive?rgba(PAL.labelHot,labA):rgba(PAL.label,0.8*labA);
      cx.textBaseline="middle";
      const right=n.sx>=CXp;
      cx.textAlign=right?"left":"right";
      cx.fillText(AGENTS[i].toUpperCase(), n.sx+(right?10*p:-10*p), n.sy);
    }
  }

  function draw(){
    S.t+=1;
    if(!reduce) S.rot += 0.0016;
    S.mx += (S.mtx - S.mx)*0.06;   // ease parallax toward pointer
    S.my += (S.mty - S.my)*0.06;
    if(!reduce && S.boot<1) S.boot=clamp(S.boot+0.02,0,1);
    if(S.flash){ S.flash*=0.85; if(S.flash<0.02) S.flash=0; }

    // energy drives the HUD scale / glow / spin
    let energy=0.12 + 0.06*Math.sin(S.t*0.03);
    if(S.mode==="listening") energy=0.25 + S.micLevel*0.9;
    else if(S.mode==="speaking") energy=0.3 + S.speakLevel*0.7;
    else if(S.mode==="thinking") energy=0.4 + 0.12*Math.sin(S.t*0.14);
    if(S.flash) energy=Math.max(energy, 0.3+S.flash*0.85);
    energy=clamp(energy,0,1.2);

    cx.clearRect(0,0,W,H);
    drawSpace();

    const coreR=Rb*(0.94+0.12*energy)*(0.6+0.4*S.boot);
    const R3=ringR, focal=R3*2.7;

    // project + depth-sort agents
    const proj=SPH.map((u,i)=>({...project(u,R3,focal), i}));
    proj.sort((a,b)=>a.depth-b.depth);

    cx.save();
    cx.globalAlpha=S.boot;
    // back half (behind core)
    for(const n of proj) if(n.depth<0) drawNode(n,n.i,energy);
    cx.restore();

    if(Rb) drawCore(coreR, energy);

    cx.save();
    cx.globalAlpha=S.boot;
    // front half (over core)
    for(const n of proj) if(n.depth>=0) drawNode(n,n.i,energy);
    cx.restore();

    requestAnimationFrame(draw);
  }

  /* ==========================================================
     CANVAS 2 — waveform
     ========================================================== */
  const wv=$("wave"), wc=wv.getContext("2d");
  let WW=0,WH=0;
  const BARS=48;
  const barsArr=new Array(BARS).fill(0.06);
  function resizeWave(){
    const r=wv.getBoundingClientRect();
    WW=r.width; WH=r.height;
    wv.width=Math.round(WW*DPR); wv.height=Math.round(WH*DPR);
    wc.setTransform(DPR,0,0,DPR,0,0);
  }
  function drawWave(){
    wc.clearRect(0,0,WW,WH);
    const mid=WH/2, bw=WW/BARS;
    for(let i=0;i<BARS;i++){
      let target=0.06;
      if(S.mode==="listening"){
        if(freqData){
          const idx=Math.floor(i/BARS*freqData.length*0.6);
          target=0.06+ (freqData[idx]/255)*0.95;
        } else target=0.06+S.micLevel*0.9*Math.abs(Math.sin(i*0.5+S.t*0.2));
      }else if(S.mode==="speaking"){
        target=0.08+ S.speakLevel*0.8*Math.abs(Math.sin(i*0.6+S.t*0.35));
      }else if(S.mode==="thinking"){
        target=0.1+0.14*Math.abs(Math.sin(i*0.4+S.t*0.1));
      }else{
        target=0.05+0.03*Math.abs(Math.sin(i*0.3+S.t*0.04));
      }
      barsArr[i]=lerp(barsArr[i],target,0.35);
      const h=barsArr[i]*(WH*0.9);
      const active = S.mode==="listening"||S.mode==="speaking";
      wc.fillStyle= active
        ? (barsArr[i]>0.55?rgba(PAL.acc,0.95):rgba(PAL.main,0.9))
        : rgba(PAL.main,0.4);
      const x=i*bw+bw*0.2, w=bw*0.6;
      wc.fillRect(x,mid-h/2,w,h);
    }
    requestAnimationFrame(drawWave);
  }

  /* ==========================================================
     MIC + Web Audio analyser
     ========================================================== */
  let audioCtx=null, analyser=null, freqData=null, micStream=null, rafMic=0, micError="";
  function micHelp(){
    if(micError==="unsupported")
      return "This view can't reach the mic. Open the artifact in its own tab (↗ top-right) — or in Chrome — then allow the microphone.";
    if(micError==="NotAllowedError"||micError==="SecurityError")
      return "Mic access is blocked. Open the artifact in its own tab (↗), click the mic icon in the address bar, allow it, and toggle again.";
    if(micError==="NotFoundError"||micError==="OverconstrainedError")
      return "No microphone was found on this device.";
    return "Couldn't open the mic. Open the artifact in its own tab (↗) and allow mic access, then try again.";
  }
  async function startMicMeter(){
    try{
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ micError="unsupported"; return false; }
      if(!micStream){
        micStream=await navigator.mediaDevices.getUserMedia({audio:true});
        micError="";
      }
      if(!audioCtx){
        audioCtx=new (window.AudioContext||window.webkitAudioContext)();
        const src=audioCtx.createMediaStreamSource(micStream);
        analyser=audioCtx.createAnalyser();
        analyser.fftSize=128; analyser.smoothingTimeConstant=0.75;
        src.connect(analyser);
        freqData=new Uint8Array(analyser.frequencyBinCount);
      }
      if(audioCtx.state==="suspended") await audioCtx.resume();
      const tick=()=>{
        if(!analyser) return;
        analyser.getByteFrequencyData(freqData);
        let sum=0; for(let i=0;i<freqData.length;i++) sum+=freqData[i];
        S.micLevel=clamp((sum/freqData.length)/140,0,1);
        rafMic=requestAnimationFrame(tick);
      };
      tick();
      return true;
    }catch(e){
      micError=(e&&e.name)||"error";
      return false;
    }
  }
  function stopMicMeter(){
    cancelAnimationFrame(rafMic); S.micLevel=0;
  }

  /* ---- language: Auto (Whisper tells Korean from English) · 한국어 · English ---- */
  const HANGUL=/[가-힣]/;
  const langSel=$("langSel");
  let langPref="auto";
  try{ const l=localStorage.getItem("jarvis_lang"); if(l==="auto"||l==="ko"||l==="en") langPref=l; }catch(e){}
  let lastLang = langPref==="ko" ? "ko" : "en";    // language of the latest exchange
  // the browser recognizer can only listen for one language at a time
  function srLang(){ return langPref==="ko" || (langPref==="auto" && /^ko/i.test(navigator.language||"")) ? "ko-KR" : "en-US"; }
  if(langSel){
    langSel.value=langPref;
    langSel.addEventListener("change",()=>{
      langPref=langSel.value;
      if(langPref!=="auto") lastLang=langPref;
      try{ localStorage.setItem("jarvis_lang",langPref); }catch(e){}
      if(rec) rec.lang=srLang();
      log('language → <span class="ok">'+langPref+"</span>");
    });
  }

  /* ==========================================================
     SPEECH RECOGNITION — browser fallback (Chrome), language from the Lang menu.
     Signed-in sessions use Groq Whisper instead (see CONTROLS).
     ========================================================== */
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  let rec=null, recActive=false, sttOK = !!SR;
  const banner=$("banner");

  if(SR){
    rec=new SR();
    rec.lang=srLang(); rec.interimResults=true; rec.continuous=false; rec.maxAlternatives=1;
    let liveBody=null, finalText="";
    rec.onstart=()=>{ recActive=true; finalText=""; liveBody=bubble("You","you");
      log("mic <b>open</b> · listening", ); setMode("listening","Speak now — tap again to stop"); };
    rec.onresult=(ev)=>{
      let interim="", fin="";
      for(let i=ev.resultIndex;i<ev.results.length;i++){
        const t=ev.results[i][0].transcript;
        if(ev.results[i].isFinal) fin+=t; else interim+=t;
      }
      if(fin) finalText+=fin;
      if(liveBody) liveBody.textContent=(finalText+interim)||"…";
    };
    rec.onerror=(ev)=>{
      if(ev.error==="not-allowed"||ev.error==="service-not-allowed"){
        markVoiceBlocked();
        banner.textContent="Voice input is blocked here (browser mic permission). Type below — I'll still reply out loud.";
      }else if(ev.error==="no-speech"){
        banner.textContent="Didn't catch that — try again or type it.";
      }else if(ev.error==="audio-capture"){
        banner.textContent="No microphone was found on this device — type your command instead.";
      }
      log('mic <span style="color:var(--crit)">error: '+ev.error+"</span>");
    };
    rec.onend=()=>{
      recActive=false; stopMicMeter();
      if(S.mode==="listening") setMode("idle");
      const t=finalText.trim();
      if(t){ if(liveBody) liveBody.textContent=t; handleInput(t); }
      else if(liveBody && !liveBody.textContent.trim()){ liveBody.parentElement.remove(); }
      liveBody=null;
    };
  }

  /* ==========================================================
     SPEECH SYNTHESIS (TTS, English)
     ========================================================== */
  const voiceSel=$("voiceSel");
  let voice=null, voicesEN=[], voiceUserPick=false;
  let voicesKO=[];                                    // Korean replies pick the best of these
  function scoreKo(v){
    const n=v.name.toLowerCase(); let s=0;
    if(/google/.test(n)) s+=100;
    if(/yuna|유나/.test(n)) s+=80;
    if(/natural|neural|premium|enhanced|siri/.test(n)) s+=45;
    if(/microsoft/.test(n)) s+=20;
    return s;
  }
  function scoreVoice(v){
    const n=v.name.toLowerCase(), l=v.lang.toLowerCase();
    let s=0;
    if(/google us english/.test(n)) s+=100;
    else if(/google uk english/.test(n)) s+=78;
    if(/\b(samantha|ava|allison|serena|alex|aaron|karen|daniel|moira|tessa|fiona|nathan|evan|zoe)\b/.test(n)) s+=60;
    if(/natural|neural|premium|enhanced|siri/.test(n)) s+=45;
    if(/microsoft/.test(n)) s+=18;
    if(l==="en-us") s+=22; else if(l==="en-gb") s+=14; else if(l.indexOf("en")===0) s+=8;
    return s;
  }
  const UA=navigator.userAgent;
  const uaTag = /edg/i.test(UA)?"Edge" : (/chrome|crios/i.test(UA)?"Chrome" : (/firefox/i.test(UA)?"Firefox" : (/safari/i.test(UA)?"Safari":"browser")));
  let loggedVoices=false, loggedSpoke=false;
  function loadVoices(){
    if(!("speechSynthesis" in window)) return;
    voicesEN = speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang));
    voicesEN.sort((a,b)=>scoreVoice(b)-scoreVoice(a));
    voicesKO = speechSynthesis.getVoices().filter(v=>/^ko/i.test(v.lang)).sort((a,b)=>scoreKo(b)-scoreKo(a));
    if(!loggedVoices && voicesEN.length){ loggedVoices=true;
      log(uaTag+" · <span class='ok'>"+voicesEN.length+" EN · "+voicesKO.length+" KO voices</span>"); }
    if(!voiceUserPick) voice = voicesEN[0] || null;
    else if(voice){ const m=voicesEN.find(v=>v.name===voice.name); if(m) voice=m; } // keep ref fresh
    if(voiceSel){
      voiceSel.innerHTML="";
      if(!voicesEN.length){ const o=document.createElement("option"); o.textContent="System default"; voiceSel.appendChild(o); }
      voicesEN.forEach(v=>{ const o=document.createElement("option"); o.value=v.name;
        o.textContent=v.name.replace(/\(.*?\)/g,"").trim()+" · "+v.lang;
        if(voice&&v.name===voice.name) o.selected=true; voiceSel.appendChild(o); });
    }
  }
  if("speechSynthesis" in window){
    loadVoices();
    speechSynthesis.onvoiceschanged=loadVoices;
  }
  // Re-resolve the chosen voice from the LIVE list every time we speak —
  // stored voice objects go stale after the list refreshes and are then
  // silently ignored (engine falls back to the system default).
  function liveVoice(lang){
    if(!("speechSynthesis" in window)) return null;
    const vs=speechSynthesis.getVoices();
    if(lang==="ko"){
      const best=voicesKO[0];
      return (best && vs.find(v=>v.name===best.name)) || vs.find(v=>/^ko/i.test(v.lang)) || null;
    }
    if(voice){ const m=vs.find(v=>v.name===voice.name); if(m) return m; }
    return vs.find(v=>/^en/i.test(v.lang)) || null;
  }
  if(voiceSel) voiceSel.addEventListener("change",()=>{
    const v=voicesEN.find(x=>x.name===voiceSel.value);
    if(v){ voice=v; voiceUserPick=true;
      log('voice → <span class="ok">'+v.name.replace(/\(.*?\)/g,"").trim()+"</span>");
      try{ const u=new SpeechSynthesisUtterance("Voice ready."); u.voice=v; u.lang=v.lang; u.rate=1.02; speechSynthesis.speak(u); }catch(e){} }
  });
  let speakTimer=0;
  function speak(text){
    if(!("speechSynthesis" in window) || !text){ setMode("idle"); return; }
    speechSynthesis.cancel();
    const ko=HANGUL.test(text);                      // Korean text → Korean voice
    const v=liveVoice(ko?"ko":"en");
    if(!loggedSpoke || (ko && loggedSpoke!=="ko")){ loggedSpoke=ko?"ko":true;
      log('tts → <span class="'+(v?"ok":"rt")+'">'+(v?v.name.replace(/\(.*?\)/g,"").trim()+" ("+v.lang+")":"system default")+"</span>"); }
    // Chrome silently cuts off long utterances partway through (a long-standing
    // bug: speech just stops with neither onend nor onerror ever firing).
    // Speaking the reply as a queue of short chunks keeps each one comfortably
    // under that limit. SAFE_LEN is conservative because Korean takes longer
    // per character to speak than English, so a length that's safe in English
    // can still trip the cutoff in Korean — and a run-on sentence with no
    // punctuation is force-split at word boundaries instead of staying whole.
    const SAFE_LEN=80;
    const splitLong=s=>{
      if(s.length<=SAFE_LEN) return [s];
      const words=s.split(/(\s+)/); const out=[]; let cur="";
      for(const w of words){
        if(cur && (cur+w).length>SAFE_LEN){ out.push(cur.trim()); cur=w; } else cur+=w;
      }
      if(cur.trim()) out.push(cur.trim());
      return out.length?out:[s];
    };
    const sentences=(text.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g)||[text]).map(s=>s.trim()).filter(Boolean);
    const chunks=sentences.flatMap(splitLong).reduce((out,s)=>{
      const last=out[out.length-1];
      if(last && (last+" "+s).length<=SAFE_LEN) out[out.length-1]=last+" "+s; else out.push(s);
      return out;
    },[]);
    let i=0;
    const done=()=>{ clearInterval(speakTimer); S.speakLevel=0; setMode("idle"); };
    const speakNext=()=>{
      if(i>=chunks.length){ done(); return; }
      const chunk=chunks[i++];
      const u=new SpeechSynthesisUtterance(chunk);
      if(v){ u.voice=v; u.lang=v.lang; } else { u.lang=ko?"ko-KR":"en-US"; }
      u.rate=1.02; u.pitch=1.02;
      let advanced=false;
      // Chrome's speech events aren't fully reliable — onend occasionally never
      // fires (seen most on the last chunk), which would otherwise leave the UI
      // stuck on "responding" forever. This fallback moves on regardless, sized
      // generously so it never cuts off genuine speech first.
      const fallback=setTimeout(()=>{ if(!advanced){ advanced=true; speakNext(); } }, Math.max(2500,chunk.length*100));
      u.onstart=()=>{ setMode("speaking");
        clearInterval(speakTimer);
        speakTimer=setInterval(()=>{ S.speakLevel=0.35+Math.random()*0.6; },90);
      };
      u.onboundary=()=>{ S.speakLevel=0.7+Math.random()*0.3; };
      u.onend=()=>{ if(!advanced){ advanced=true; clearTimeout(fallback); speakNext(); } };
      u.onerror=()=>{ if(!advanced){ advanced=true; clearTimeout(fallback); done(); } };
      try{ speechSynthesis.speak(u); }catch(e){ if(!advanced){ advanced=true; clearTimeout(fallback); done(); } }
    };
    // small delay dodges the Chrome cancel()->speak() race that drops voice
    setTimeout(speakNext, 60);
  }

  /* ==========================================================
     THE BRAIN — Groq via /api/chat, which calls the real tools
     (weather, air quality, currency, Wikipedia, holidays, headlines, timer).
     Offline, only weather + system check work from the browser.
     ========================================================== */

  const DEFAULT_CITY="Seoul";
  let authed=false, authPass="";
  try{ authPass=sessionStorage.getItem("jarvis_pass")||""; }catch(e){}
  const history=[]; // {role,content} chat context sent to the server

  function routeToAgent(name){
    if(!name) return;
    const idx=AGENTS.findIndex(a=>a.toLowerCase()===name.trim().toLowerCase());
    if(idx>=0){
      S.active=idx; S.activeUntil=now()+9000;
      log('routing → <span class="rt">'+AGENTS[idx].toUpperCase()+"</span>");
    }
  }
  function parseReply(raw){
    const m=raw.match(/ROUTE:\s*([^\n\r]+)/i);
    let agent=null, body=raw;
    if(m){ agent=m[1].trim(); if(/^none$/i.test(agent)) agent=null;
      body=raw.replace(/ROUTE:\s*[^\n\r]+/i,"").trim(); }
    return {agent,body};
  }

  // offline fallback — says plainly what still works instead of pretending
  function localBrain(text){
    const t=text.toLowerCase();
    if(lastLang==="ko")
      return {agent:null, body:/안녕|자비스|거기|있어/.test(text)
        ? "여기 있어요. 그런데 지금은 두뇌에 연결이 안 돼요. 날씨랑 시스템 점검은 계속 쓸 수 있어요."
        : "지금은 두뇌에 연결할 수 없어서 그건 아직 못 해요. 날씨랑 시스템 점검은 오프라인에서도 돼요."};
    if(/hello|hi |hey|are you there|jarvis/.test(t))
      return {agent:null,body:"I'm here, but my brain is offline right now. Weather and system check still work, so try again in a moment for everything else."};
    return {agent:null,body:"I can't reach my brain right now, so I can't do that yet. Weather and system check still work offline."};
  }

  /* ---- standalone live data: real weather via open-meteo (keyless, CORS-ok) ---- */
  function trim(s,n){ s=String(s==null?"":s); return s.length>n?s.slice(0,n)+"…":s; }
  const WCODE={0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",45:"fog",48:"rime fog",
    51:"light drizzle",53:"drizzle",55:"dense drizzle",56:"freezing drizzle",57:"freezing drizzle",
    61:"light rain",63:"rain",65:"heavy rain",66:"freezing rain",67:"freezing rain",
    71:"light snow",73:"snow",75:"heavy snow",77:"snow grains",
    80:"rain showers",81:"rain showers",82:"heavy rain showers",85:"snow showers",86:"snow showers",
    95:"thunderstorm",96:"thunderstorm with hail",99:"thunderstorm with hail"};
  async function geocode(city){
    const r=await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name="+encodeURIComponent(city));
    if(!r.ok) throw new Error("geo "+r.status);
    const j=await r.json(); const g=j&&j.results&&j.results[0];
    if(!g) return null;
    return {lat:g.latitude, lon:g.longitude, name:g.name+(g.country?(", "+g.country):"")};
  }
  async function getWeather(city){
    const g=await geocode(city||DEFAULT_CITY);
    if(!g) return {err:"place-not-found"};
    const u="https://api.open-meteo.com/v1/forecast?latitude="+g.lat+"&longitude="+g.lon+
      "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature"+
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=4";
    const r=await fetch(u); if(!r.ok) throw new Error("wx "+r.status);
    const j=await r.json(); const c=j.current||{}, d=j.daily||{};
    const desc=WCODE[c.weather_code]||"";
    const round=v=>Math.round(Number(v));
    const data="Now in "+g.name+": "+round(c.temperature_2m)+"°C (feels "+round(c.apparent_temperature)+"°), "+desc+
      ", humidity "+c.relative_humidity_2m+"%, wind "+round(c.wind_speed_10m)+" km/h. "+
      "Today high "+round(d.temperature_2m_max&&d.temperature_2m_max[0])+"° low "+round(d.temperature_2m_min&&d.temperature_2m_min[0])+"°.";
    const days=["Today","Tomorrow"];
    const sources=(d.time||[]).map((t,i)=>({
      title: days[i]||fmtWhen(t),
      label: WCODE[d.weather_code&&d.weather_code[i]]||"",
      desc: "High "+round(d.temperature_2m_max[i])+"°C · Low "+round(d.temperature_2m_min[i])+"°C"+
            (d.precipitation_probability_max?(" · rain "+d.precipitation_probability_max[i]+"%"):"")
    }));
    return {data, sources, place:g.name, desc, temp:round(c.temperature_2m), feels:round(c.apparent_temperature)};
  }

  /* ---- brain via the server proxy (/api/chat → Groq, key hidden) ---- */
  let userTZ="Asia/Seoul";
  try{ userTZ=Intl.DateTimeFormat().resolvedOptions().timeZone||userTZ; }catch(e){}
  async function postChat(messages){
    const r=await fetch("/api/chat",{
      method:"POST", headers:{"content-type":"application/json"},
      body:JSON.stringify({password:authPass, messages:messages, tz:userTZ, lang:langPref})
    });
    if(r.status===401){ authed=false; const e=new Error("bad password"); e.code=401; throw e; }
    if(r.status===429){ const e=new Error("busy"); e.code=429; throw e; }
    if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.message||("server "+r.status)); }
    const j=await r.json();
    return {text:(j.text||"").trim(), cards:j.cards||[], actions:j.actions||[], tools:j.tools||[], model:j.model||""};
  }
  async function askBrain(text){
    const msgs=history.concat([{role:"user",content:text}]);
    const out=await postChat(msgs);
    history.push({role:"user",content:text},{role:"assistant",content:out.text});
    if(history.length>20) history.splice(0,history.length-20);   // ~10 turns — a balance between remembering the session and keeping replies fast (more history = a bigger prompt = slower every turn); resets on reload/close since it only lives in this tab
    return out;
  }

  /* ---- dark "browser window" for search results ---- */
  const resultsEl=$("results"), rList=$("rList"), rAddr=$("rAddr");
  function hostOf(u){ try{return new URL(u).hostname.replace(/^www\./,"");}catch(e){return String(u||"").slice(0,40);} }
  function fmtWhen(s){
    if(!s) return "";
    try{
      const d=new Date(s);
      if(isNaN(d)) return String(s);
      const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(String(s));
      const opt=dateOnly?{month:"short",day:"numeric"}:{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"};
      return d.toLocaleString([], opt);
    }catch(e){ return String(s); }
  }
  function cleanSnippet(s){
    return String(s||"")
      .replace(/!\[[^\]]*\]\([^)]*\)/g,"")
      .replace(/\[([^\]]*)\]\([^)]*\)/g,"$1")
      .replace(/https?:\/\/\S+/g,"")
      .replace(/[#*`>\\_|]/g," ")
      .replace(/\s+/g," ").trim();
  }
  function showResults(query, sources){
    if(!resultsEl||!sources||!sources.length) return;
    rAddr.textContent=query;
    rList.innerHTML="";
    sources.slice(0,8).forEach(r=>{
      const a=document.createElement("a");
      a.className="card"; a.href=r.url||"#"; a.target="_blank"; a.rel="noopener noreferrer";
      const t=document.createElement("div"); t.className="t"; t.textContent=r.title||"(untitled)";
      const u=document.createElement("div"); u.className="u"; u.textContent=r.label||hostOf(r.url);
      a.appendChild(t); a.appendChild(u);
      const sn=trim(cleanSnippet(r.desc),220);
      if(sn){ const s=document.createElement("div"); s.className="s"; s.textContent=sn; a.appendChild(s); }
      rList.appendChild(a);
    });
    resultsEl.classList.add("show");
    log('results <span class="ok">'+Math.min(sources.length,8)+" cards</span>");
  }
  if($("rclose")) $("rclose").addEventListener("click",()=>resultsEl.classList.remove("show"));

  function finishBrain(full, jvBody){
    const {agent,body}=parseReply(full);
    routeToAgent(agent);
    jvBody.textContent=body;
    log('response <span class="ok">ready</span>');
    speak(body);
  }

  function sayAgent(agent, body, jvBody){
    routeToAgent(agent); jvBody.textContent=body;
    log('response <span class="ok">ready</span>'); speak(body);
  }
  const WX_RE=/weather|forecast|rain|temperature|umbrella|날씨|기온|비\s*와|우산|더[워울]|추[워울]/i;

  /* ---- SYSTEM CHECK — diagnostic sweep of every subsystem ---- */
  const SYS_RE=/\b(system\s*check|systems?\s*check|self\s*check|system\s*status|diagnostics?)\b|시스템\s*체크|상태\s*점검|시스템\s*점검/i;
  function sweepNodes(){
    let i=0;
    const iv=setInterval(()=>{ S.active=i%AGENTS.length; S.activeUntil=now()+800; i++;
      if(i>AGENTS.length){ clearInterval(iv); } }, reduce?0:80);
  }
  async function runSystemCheck(jvBody){
    setMode("thinking");
    log('<span class="rt">◈ SYSTEM CHECK</span> initiated');
    sweepNodes();
    const checks=[
      ["Voice synthesis", ("speechSynthesis" in window)],
      [(authed&&canRecord) ? "Speech input · Whisper (KO/EN)" : "Speech input · browser", (authed&&canRecord)||!!sttOK],
      [authed?"Brain · Groq":"Brain · offline", authed],
      ["Tools · weather, air, currency, wiki, holidays, news, timer", authed],
      ["Weather · offline fallback", true]
    ];
    const sources=checks.map(([label,ok])=>({title:(ok?"✓ ":"✗ ")+label, label:(ok?"online":"offline"), desc:""}));
    showResults("system check", sources);
    const ok=checks.filter(c=>c[1]).length;
    await new Promise(r=>setTimeout(r, reduce?200:1200));
    const body = lastLang==="ko"
      ? "시스템 점검을 마쳤어요. "+checks.length+"개 중 "+ok+"개가 정상이에요."
      : "Systems check complete. "+ok+" of "+checks.length+" subsystems online. "
        +(sttOK?"Voice and ":"")+"core functions nominal.";
    routeToAgent("Chief of Staff");
    jvBody.textContent=body;
    log('system check <span class="ok">complete</span>');
    speak(body);
  }

  /* ---- "what can you do" → show the real abilities as cards ---- */
  const CAP_RE=/what (else )?can you do|what are you able to|your (abilities|capabilities|features|skills)|뭐\s*할\s*(수|줄)|할\s*수\s*있는\s*(게|거|일)/i;
  const CAPS=[
    {title:"Weather & forecast", label:"“weather in Busan”", desc:"Now, feels-like, 4-day high/low and rain chance"},
    {title:"Air quality", label:"“is the air bad today?”", desc:"PM2.5 · PM10 with Korean levels, AQI, UV"},
    {title:"Currency", label:"“100 dollars in won”", desc:"Today's European Central Bank rate"},
    {title:"Wikipedia", label:"“who is Sam Altman?”", desc:"Short summary with a link"},
    {title:"Holidays", label:"“next holiday”", desc:"Upcoming public holidays, Korea by default"},
    {title:"Tech headlines", label:"“tech headlines”", desc:"Top Hacker News stories right now"},
    {title:"Timer", label:"“timer 25 minutes”", desc:"Beeps and speaks when done — keep this tab open"},
    {title:"System check", label:"“system check”", desc:"Voice, mic and brain status"}
  ];
  const CAPS_KO=[
    {title:"날씨·예보", label:"“부산 날씨 어때?”", desc:"지금 기온·체감, 4일 최고·최저, 강수 확률"},
    {title:"대기질", label:"“오늘 미세먼지 어때?”", desc:"초미세먼지·미세먼지 한국 기준 등급, 자외선"},
    {title:"환율", label:"“100달러 원화로 얼마야?”", desc:"오늘 유럽중앙은행 기준 환율"},
    {title:"위키 요약", label:"“샘 올트먼이 누구야?”", desc:"한국어 위키 요약과 링크"},
    {title:"공휴일", label:"“다음 공휴일 언제야?”", desc:"다가오는 한국 공휴일"},
    {title:"테크 헤드라인", label:"“오늘 테크 뉴스 알려줘”", desc:"Hacker News 인기 기사"},
    {title:"타이머", label:"“25분 타이머 맞춰줘”", desc:"끝나면 소리와 음성으로 알려줘요 — 탭을 열어 두세요"},
    {title:"시스템 점검", label:"“시스템 체크”", desc:"음성·마이크·두뇌 연결 상태"}
  ];

  /* ---- browser countdown timer (started by the set_timer tool) ---- */
  const timerEl=$("timer"), timerLbl=$("timerLbl"), timerX=$("timerX");
  let timerEnd=0, timerIv=0, timerName="timer";
  function fmtClock(s){
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), r=s%60, p=n=>String(n).padStart(2,"0");
    return h ? h+":"+p(m)+":"+p(r) : m+":"+p(r);
  }
  function beep(){
    try{
      const ctx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
      if(ctx.state==="suspended") ctx.resume();
      [0,0.35,0.7].forEach(t=>{
        const o=ctx.createOscillator(), g=ctx.createGain(), at=ctx.currentTime+t;
        o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001,at); g.gain.exponentialRampToValueAtTime(0.25,at+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001,at+0.25);
        o.start(at); o.stop(at+0.3);
      });
    }catch(e){}
  }
  function stopTimer(){ clearInterval(timerIv); timerIv=0; timerEnd=0; timerEl.hidden=true; }
  function tickTimer(){
    const left=Math.max(0,Math.round((timerEnd-Date.now())/1000));
    timerLbl.textContent=timerName+" · "+fmtClock(left);
    if(left<=0){
      stopTimer(); beep();
      log('timer <span class="ok">done</span>');
      speak(lastLang==="ko" ? timerName+" 타이머가 끝났어요." : "Your "+timerName+" timer is done.");
    }
  }
  function startTimer(sec, label){
    timerName=String(label||"timer").slice(0,30);
    timerEnd=Date.now()+sec*1000;
    clearInterval(timerIv); timerEl.hidden=false;
    tickTimer(); timerIv=setInterval(tickTimer,500);
    log('timer <span class="ok">'+fmtClock(sec)+"</span> · "+timerName.replace(/[<>&]/g,""));
  }
  if(timerX) timerX.addEventListener("click",()=>{ stopTimer(); log("timer cancelled"); });

  // apply what the server's tools returned: result cards, timer, log line
  let loggedModel="";
  function handleTools(out){
    if(out.model && out.model!==loggedModel){ loggedModel=out.model;
      log('brain model <span class="ok">'+String(out.model).replace(/[<>&]/g,"")+"</span>"); }
    const groups=out.cards||[];
    if(groups.length){
      const items=[].concat(...groups.map(g=>g.items||[]));
      showResults(groups.map(g=>g.title).join(" + "), items);
    }
    (out.actions||[]).forEach(a=>{ if(a && a.type==="timer" && a.seconds>0) startTimer(a.seconds, a.label); });
    if(out.tools && out.tools.length)
      log('tools → <span class="rt">'+out.tools.join(", ").replace(/[<>&]/g,"")+"</span>");
  }

  // spokenLang: what Whisper detected ("ko"/"en"), if the input came from voice
  async function handleInput(text, spokenLang){
    if(!text) return;
    lastLang = langPref!=="auto" ? langPref
      : (spokenLang==="ko"||spokenLang==="en") ? spokenLang
      : (HANGUL.test(text) ? "ko" : "en");
    if(recActive && rec){ try{rec.stop();}catch(e){} }
    log('heard: "<b>'+text.replace(/[<>&]/g,"")+'</b>"');
    setMode("thinking");
    const jvBody=bubble("Jarvis","jv"); jvBody.textContent="…";

    if(SYS_RE.test(text)){ await runSystemCheck(jvBody); return; }
    if(CAP_RE.test(text)) showResults(lastLang==="ko"?"기능":"capabilities", lastLang==="ko"?CAPS_KO:CAPS);

    // 1) LLM brain with real tools, via the server proxy (Groq)
    try{
      const out=await askBrain(text);
      // a display glitch in cards/timer must not be reported as a brain failure
      try{ handleTools(out); }catch(err){ log('cards <span style="color:var(--crit)">'+trim(err.message,40)+"</span>"); }
      const {agent,body}=parseReply(out.text);
      banner.textContent="";
      sayAgent(agent, body||"Done.", jvBody); return;
    }catch(e){
      if(e.code===401){ banner.textContent="Session expired — enter the password again."; showGate(); }
      else if(e.code===429){ banner.textContent="Brain is busy (free-tier limit) — try again in a moment."; }
      else { log('brain <span style="color:var(--crit)">'+trim(e.message,60).replace(/[<>&]/g,"")+"</span>");
        banner.textContent="Brain unreachable ("+trim(e.message,110)+") — only weather and system check work offline."; }
      // fall through to offline
    }

    // 2) offline: weather still works straight from the browser (open-meteo, no key)
    if(WX_RE.test(text)){
      routeToAgent("Researcher");
      log('querying <span class="rt">WEATHER</span> · open-meteo');
      try{
        const loc=((text.match(/(?:in|for|near)\s+([a-z .'-]{2,30})/i)||[])[1]||DEFAULT_CITY).trim();
        const w=await getWeather(loc);
        const ko=lastLang==="ko";
        if(w.err==="place-not-found"){ sayAgent("Researcher", ko?"그 지역을 찾지 못했어요. 도시 이름으로 다시 말해 주세요.":"I couldn't find that place — try naming a city.", jvBody); return; }
        showResults("weather · "+(w.place||loc), w.sources);
        sayAgent("Researcher", ko
          ? "현재 "+w.place+" 기온은 "+w.temp+"도, 체감 "+w.feels+"도예요."
          : "In "+w.place+", it's "+w.temp+" degrees, "+w.desc+", feeling like "+w.feels+".", jvBody); return;
      }catch(e){
        log('weather <span style="color:var(--crit)">'+trim(e.message,40)+"</span>");
      }
    }

    // 3) honest offline reply
    const {agent,body}=localBrain(text);
    sayAgent(agent, body, jvBody);
  }

  /* ==========================================================
     CONTROLS
     ========================================================== */
  const micBtn=$("mic"), txt=$("txt"), sendBtn=$("send");

  /* ---- voice input via Groq Whisper (/api/transcribe) ----
     Records one utterance, stops after ~1.2 s of silence (or on a second tap),
     and lets Whisper tell Korean from English. Works in any browser that can
     record; the browser recognizer is the fallback. */
  const canRecord = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let recorder=null, recChunks=[], vadIv=0, whisperStarting=false;
  const heardNothing=()=>lastLang==="ko" ? "잘 못 들었어요 — 다시 말하거나 입력해 주세요." : "Didn't catch that — try again or type it.";

  function pickMime(){
    for(const m of ["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus"]){
      try{ if(MediaRecorder.isTypeSupported(m)) return m; }catch(e){}
    }
    return "";
  }
  async function startWhisper(){
    const ok=await startMicMeter();
    if(!ok || !micStream){ banner.textContent=micHelp(); return false; }
    const want=pickMime();
    try{ recorder=new MediaRecorder(micStream, want?{mimeType:want}:undefined); }
    catch(e){ recorder=null; return false; }
    const mime=(recorder.mimeType||want||"audio/webm").split(";")[0];
    const t0=Date.now();
    let heard=false, loud=0, quietSince=0, floorSum=0, floorN=0, floor=0.04;
    let floorReady=false, winMin=1, winStart=0;
    recChunks=[];
    recorder.ondataavailable=e=>{ if(e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop=()=>{ clearInterval(vadIv); finishWhisper(mime, t0); };
    recorder.start(250);
    setMode("listening","Speak now — tap again to stop");
    log("mic <b>open</b> · whisper");
    // voice-activity detection on the analyser level, relative to the room's noise floor.
    // The floor isn't just a one-time snapshot: every ~3s it's re-anchored to the
    // quietest reading seen in that window. Real speech still has brief gaps (between
    // words, breaths) that read near-true-ambient, so this doesn't get fooled by
    // someone talking continuously — but steady background noise (traffic, AC hum),
    // which stays at roughly the same level the whole window, gets folded into the
    // floor so it stops being mistaken for "still talking" once the person goes quiet.
    vadIv=setInterval(()=>{
      const lv=S.micLevel, t=Date.now()-t0;
      if(t<300){ floorSum+=lv; floorN++; return; }
      if(!floorReady){ floor=Math.min(0.1, floorN?floorSum/floorN:0.04); floorReady=true; winStart=t; }
      if(lv<winMin) winMin=lv;
      if(t-winStart>3000){
        floor=Math.min(0.1, floor*0.5+winMin*0.5);
        winMin=1; winStart=t;
      }
      if(lv>floor+0.08){ if(++loud>=3) heard=true; quietSince=0; }
      else{
        loud=0;
        if(heard && lv<floor+0.035){ if(!quietSince) quietSince=t; else if(t-quietSince>1200) stopWhisper(); }
      }
      if(!heard && t>7000) stopWhisper();      // nothing said
      if(t>20000) stopWhisper();               // hard cap keeps uploads small
    },100);
    return true;
  }
  function stopWhisper(){ if(recorder && recorder.state==="recording"){ try{ recorder.stop(); }catch(e){} } }

  async function finishWhisper(mime, t0){
    recorder=null; stopMicMeter();
    const blob=new Blob(recChunks,{type:mime}); recChunks=[];
    if(Date.now()-t0<600 || blob.size<800){ setMode("idle"); banner.textContent=heardNothing(); return; }
    setMode("thinking");
    log("whisper <span class='rt'>transcribing</span> · "+Math.round(blob.size/1024)+" KB");
    const live=bubble("You","you"); live.textContent="…";
    try{
      const r=await fetch("/api/transcribe?lang="+encodeURIComponent(langPref),{
        method:"POST",
        headers:{"content-type":"application/octet-stream","x-audio-type":mime,"x-jarvis-password":encodeURIComponent(authPass)},
        body:blob
      });
      if(r.status===401){ authed=false; showGate(); const e=new Error("Session expired — enter the password again."); e.shown=true; throw e; }
      const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.message||("speech "+r.status));
      const text=String(j.text||"").trim();
      if(!text){ live.parentElement.remove(); setMode("idle"); banner.textContent=heardNothing(); return; }
      live.textContent=text;
      log('whisper <span class="ok">'+String(j.language||"?").replace(/[<>&]/g,"")+"</span>");
      handleInput(text, j.language||"");
    }catch(e){
      live.parentElement.remove(); setMode("idle");
      banner.textContent = e.shown ? e.message : "Voice input failed ("+trim(e.message,80)+") — type instead, or try again.";
      log('whisper <span style="color:var(--crit)">'+trim(e.message,50).replace(/[<>&]/g,"")+"</span>");
    }
  }

  async function toggleListen(){
    if(recorder && recorder.state==="recording"){ stopWhisper(); return; }
    if(recActive){ try{rec.stop();}catch(e){} return; }
    if(whisperStarting) return;                      // mic permission prompt still open
    if(S.mode==="speaking"){ speechSynthesis.cancel(); }
    banner.textContent="";
    // signed in + able to record → Whisper (Korean & English); otherwise the browser recognizer
    if(authed && canRecord){
      whisperStarting=true;
      const ok=await startWhisper().catch(()=>false);
      whisperStarting=false;
      if(ok) return;
    }
    if(!sttOK){
      banner.textContent="Voice input isn't available here — type your command below and I'll still reply out loud.";
      txt.focus(); return;
    }
    // visualizer meter is best-effort — do NOT block recognition on it,
    // since SpeechRecognition uses its own audio path and may work anyway.
    startMicMeter().then(ok=>{ if(!ok) log("mic meter <span class='rt'>off ("+(micError||"?")+")</span>"); });
    try{ rec.lang=srLang(); rec.start(); }
    catch(e){ /* InvalidStateError: already started — ignore */ }
  }
  micBtn.addEventListener("click",toggleListen);
  cv.addEventListener("click",toggleListen);

  function submitText(){
    const v=txt.value.trim(); if(!v) return;
    txt.value="";
    bubble("You","you").textContent=v;
    handleInput(v);
  }
  sendBtn.addEventListener("click",submitText);
  txt.addEventListener("keydown",e=>{ if(e.key==="Enter") submitText(); });

  /* ---- pointer parallax ---- */
  function aim(clientX, clientY){
    S.mtx = clamp((clientX/window.innerWidth  - 0.5)*2, -1, 1) * PLX;
    S.mty = clamp((clientY/window.innerHeight - 0.5)*2, -1, 1) * PLX;
  }
  window.addEventListener("pointermove", e=>{ if(e.pointerType!=="touch") aim(e.clientX,e.clientY); });
  window.addEventListener("touchmove", e=>{ const t=e.touches[0]; if(t) aim(t.clientX,t.clientY); }, {passive:true});
  window.addEventListener("pointerleave", ()=>{ S.mtx=0; S.mty=0; });
  window.addEventListener("deviceorientation", e=>{           // gentle tilt on mobile
    if(e.gamma==null||e.beta==null) return;
    S.mtx = clamp(e.gamma/35,-1,1)*PLX; S.mty = clamp((e.beta-40)/35,-1,1)*PLX;
  });

  /* ==========================================================
     CLAP-TO-WAKE — ambient mic listens for two sharp claps

     Uses its own mic stream + analyser, separate from the Whisper
     recording stream:
      - autoGainControl/noiseSuppression/echoCancellation are turned
        OFF here because they actively flatten sharp transients like
        claps (they're built to do exactly that to real noise). The
        Whisper recording stream keeps them on, since that helps
        transcription instead of hurting it.
      - fftSize is 2048 (~43ms of audio at 48kHz) instead of the
        meter's 128 (~2.7ms), so a poll every 26ms can't land in a
        gap between windows and miss the clap entirely.
     ========================================================== */
  const clapBtn=$("clap"), clapLbl=clapBtn.querySelector(".clbl");
  let clapOn=false, clapTimer=0, voiceBlocked=false;
  let clapStream=null, clapCtx=null, clapAnalyser=null;
  function closeClapMic(){
    try{ clapStream && clapStream.getTracks().forEach(t=>t.stop()); }catch(e){}
    try{ clapCtx && clapCtx.close(); }catch(e){}
    clapStream=null; clapCtx=null; clapAnalyser=null;
  }
  function markVoiceBlocked(){
    voiceBlocked=true;
    try{ micBtn.classList.add("blocked"); micBtn.setAttribute("aria-label","Voice input blocked — type below"); micBtn.title="Voice input blocked here — type instead"; }catch(e){}
    try{ if(clapBtn){ clapBtn.setAttribute("aria-disabled","true");
      if(clapOn){ clapOn=false; clearInterval(clapTimer); closeClapMic(); clapBtn.setAttribute("aria-pressed","false"); clapLbl.textContent="Clap ×2 to wake · off"; } } }catch(e){}
    try{ if(wwBtn){ wwBtn.setAttribute("aria-disabled","true"); if(wwOn) turnWakeWordOff(); } }catch(e){}
    try{ txt.focus(); }catch(e){}
  }

  async function openClapMic(){
    try{
      clapStream=await navigator.mediaDevices.getUserMedia({audio:{
        autoGainControl:false, noiseSuppression:false, echoCancellation:false
      }});
    }catch(e){ micError=(e&&e.name)||"error"; return false; }
    clapCtx=new (window.AudioContext||window.webkitAudioContext)();
    const src=clapCtx.createMediaStreamSource(clapStream);
    clapAnalyser=clapCtx.createAnalyser();
    clapAnalyser.fftSize=2048;
    src.connect(clapAnalyser);
    return true;
  }
  async function startClapWake(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ micError="unsupported"; }
    const ok = navigator.mediaDevices ? await openClapMic() : false;
    if(!ok || !clapAnalyser){
      banner.textContent=micHelp();
      log("clap-wake <span style='color:var(--crit)'>mic blocked ("+(micError||"?")+")</span>");
      return false;
    }
    const buf=new Uint8Array(clapAnalyser.fftSize);
    let prevClap=0, baseline=0.04, refr=0;
    clearInterval(clapTimer);
    clapTimer=setInterval(()=>{
      if(!clapOn || !clapAnalyser) return;
      if(recActive || S.mode!=="idle") return;  // only wake from standby
      clapAnalyser.getByteTimeDomainData(buf);
      let peak=0;
      for(let i=0;i<buf.length;i++){ const v=Math.abs(buf[i]-128)/128; if(v>peak) peak=v; }
      baseline=baseline*0.94 + peak*0.06;
      const tnow=now();
      if(tnow>refr && peak>0.22 && peak>baseline+0.14){  // sharp transient = clap
        refr=tnow+150;                                   // skip the clap's ring-out
        S.flash=1;                                       // visual blip on the core (single clap)
        if(prevClap && tnow-prevClap>90 && tnow-prevClap<900){
          prevClap=0; log('clap <span class="ok">✓✓ wake</span>'); wakeByClap();
        } else { prevClap=tnow; }
      }
    },26);
    return true;
  }
  function wakeByClap(){
    log('<span class="rt">✦ clap-wake</span> → listening');
    toggleListen();
  }
  clapBtn.addEventListener("click", async ()=>{
    if(clapOn){
      clapOn=false; clearInterval(clapTimer); closeClapMic();
      clapBtn.setAttribute("aria-pressed","false");
      clapLbl.textContent="Clap ×2 to wake · off";
      return;
    }
    clapLbl.textContent="Starting…";
    const ok=await startClapWake();
    if(ok){
      if(wwOn) turnWakeWordOff();   // mutually exclusive — only one ambient listener at a time
      clapOn=true; clapBtn.setAttribute("aria-pressed","true");
      clapLbl.textContent="Listening for claps";
      banner.textContent="";
      log("clap-wake <span class='ok'>armed</span> · mic stays open");
    }else{
      clapLbl.textContent="Clap ×2 to wake · off";
    }
  });

  /* ==========================================================
     WAKE WORD — say "Jarvis" (or "자비스") from anywhere in the
     room to start listening, no clap or button needed.

     Reuses the browser's own continuous speech recognizer (the same
     SR used as the Whisper fallback), so it costs nothing extra and
     works wherever that fallback already works. It only runs while
     the core is idle: a small watcher stops it the moment a real
     conversation starts and restarts it once back at idle, so it
     never mishears Jarvis's own reply (which often contains the
     word "Jarvis") as a fresh wake.
     ========================================================== */
  const wwBtn=$("wakeword"), wwLbl=wwBtn.querySelector(".wwlbl");
  const WAKE_RE=/\bjarvis\b|자비스/i;
  let wwOn=false, wwRec=null, wwActive=false, wwWatch=0;

  function stopWakeWordRec(){
    if(wwRec){ try{ wwRec.onresult=null; wwRec.onerror=null; wwRec.onend=null; wwRec.stop(); }catch(e){} }
    wwRec=null; wwActive=false;
  }
  function startWakeWordRec(){
    if(wwActive || !SR) return;
    wwRec=new SR();
    wwRec.continuous=true; wwRec.interimResults=true; wwRec.lang=srLang();
    wwRec.onresult=e=>{
      const said=(e.results[e.results.length-1][0].transcript||"");
      if(WAKE_RE.test(said)){
        log('wake-word <span class="ok">✓ "'+said.trim()+'" → listening</span>');
        // Hand the mic off to Whisper only once this recognizer has actually
        // released it (its onend fires) — starting getUserMedia while Chrome
        // is still tearing down the SpeechRecognition session can hand back
        // a MediaRecorder that looks like it's "recording" but never emits
        // audio or a stop event, so silence never ends the exchange. A short
        // timeout is a fallback in case onend never fires.
        const r=wwRec;
        wwRec=null; wwActive=false;
        r.onresult=null; r.onerror=null;
        let handedOff=false;
        const proceed=()=>{ if(handedOff) return; handedOff=true; r.onend=null; toggleListen(); };
        r.onend=proceed;
        try{ r.stop(); }catch(e){ proceed(); }
        setTimeout(proceed,400);
      }
    };
    wwRec.onerror=err=>{
      if(err.error==="not-allowed" || err.error==="service-not-allowed"){
        log("wake-word <span style='color:var(--crit)'>mic blocked</span>");
        turnWakeWordOff();
      }
      // no-speech / network / aborted: the watcher below restarts it
    };
    wwRec.onend=()=>{ wwActive=false; };
    try{ wwRec.start(); wwActive=true; }catch(e){ wwActive=false; }
  }
  function turnWakeWordOff(){
    wwOn=false; clearInterval(wwWatch); stopWakeWordRec();
    wwBtn.setAttribute("aria-pressed","false");
    wwLbl.textContent='Say "Jarvis" to wake · off';
  }
  wwBtn.addEventListener("click", ()=>{
    if(wwOn){ turnWakeWordOff(); return; }
    if(!SR){ banner.textContent='This browser can\'t listen continuously for a wake word — try Chrome, or use Clap ×2.'; return; }
    if(clapOn){ clapOn=false; clearInterval(clapTimer); closeClapMic(); clapBtn.setAttribute("aria-pressed","false"); clapLbl.textContent="Clap ×2 to wake · off"; }
    wwOn=true;
    wwBtn.setAttribute("aria-pressed","true");
    wwLbl.textContent='Listening for "Jarvis"';
    banner.textContent="";
    log("wake-word <span class='ok'>armed</span>");
    clearInterval(wwWatch);
    wwWatch=setInterval(()=>{
      if(!wwOn) return;
      const shouldListen = S.mode==="idle" && !recActive;
      if(shouldListen && !wwActive) startWakeWordRec();
      if(!shouldListen && wwActive) stopWakeWordRec();
    },400);
    startWakeWordRec();
  });

  /* ==========================================================
     CONNECTION STATUS
     ========================================================== */
  const connPill=$("conn"), connLabel=$("connlabel");
  function setLinked(on){
    S.linked=on;
    connPill.classList.toggle("linked",on);
    connPill.classList.toggle("local",!on);
    connLabel.textContent=on?"Claude Linked":"Local Mode";
  }

  /* ==========================================================
     BOOT
     ========================================================== */
  function bootSequence(){
    const lines=[
      "core online",
      "loading agent mesh · "+AGENTS.length+" nodes",
      "speech engine "+(("speechSynthesis" in window)?"<span class='ok'>ready</span>":"<span style='color:var(--crit)'>unavailable</span>"),
      "recognition "+(sttOK?"<span class='ok'>ready</span>":"<span style='color:var(--crit)'>text-only</span>"),
    ];
    let i=0;
    (function next(){
      if(i<lines.length){ log(lines[i++]); setTimeout(next, reduce?0:260); }
    })();
    if(!sttOK && !("__b" in banner)){
      banner.textContent="Voice input isn't supported in this browser — type your command and I'll reply out loud.";
    }
  }

  function refreshBrainPill(){
    if(authed){ setLinked(true); if(connLabel) connLabel.textContent="Brain online"; }
    else { setLinked(false); if(connLabel) connLabel.textContent="Locked"; }
  }
  function initBrain(){
    refreshBrainPill();
    log("tools <span class='ok'>7 ready</span> · weather, air, fx, wiki, holidays, news, timer");
  }

  /* ---- password gate ---- */
  const gateEl=$("gate"), gateForm=$("gateForm"), gateInput=$("gateInput"), gateErr=$("gateErr"), gateGo=$("gateGo");
  function showGate(){ if(gateEl){ gateEl.hidden=false; setTimeout(()=>gateInput&&gateInput.focus(),40); } }
  function hideGate(){ if(gateEl) gateEl.hidden=true; }
  async function tryEnter(pass){
    gateErr.hidden=true; gateGo.disabled=true; gateGo.textContent="Checking…";
    try{
      const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({password:pass, ping:true})});
      if(r.ok){
        authPass=pass; authed=true;
        try{ sessionStorage.setItem("jarvis_pass",pass); }catch(e){}
        refreshBrainPill(); hideGate();
        log("access <span class='ok'>granted</span> · brain online");
      }else{
        gateErr.textContent = r.status===401 ? "Wrong password — try again."
          : "Server not ready (set env vars & redeploy).";
        gateErr.hidden=false;
      }
    }catch(e){
      gateErr.textContent="Can't reach the server (are you on the deployed URL?)."; gateErr.hidden=false;
    }finally{ gateGo.disabled=false; gateGo.textContent="Enter"; }
  }
  if(gateForm) gateForm.addEventListener("submit",e=>{ e.preventDefault(); tryEnter((gateInput.value||"").trim()); });

  /* ---- go ---- */
  resize(); resizeWave();
  requestAnimationFrame(draw);
  requestAnimationFrame(drawWave);
  setMode("idle");
  document.fonts && document.fonts.ready.then(()=>buildHud()); // redraw dial numerals in the real font
  bootSequence();
  initBrain();
  if(authPass) tryEnter(authPass); else showGate();
})();
</script>
</body>
</html>
````

### `api/chat.js`

<!-- FILE: api/chat.js sha256=62a399e72470ba7039e8b9fdd3ac0186df514a2b86f735158ef15d3c90026ee2 -->
````js
// Vercel serverless function — Jarvis brain proxy.
// Keeps the free Groq API key server-side (never sent to the browser),
// checks a shared password, and relays the chat to Groq (OpenAI-compatible).
// The model can call real tools (weather, air quality, currency, Wikipedia,
// holidays, tech headlines, timer); results come back as cards for the page.
//
// Required env vars (set in Vercel → Project → Settings → Environment Variables):
//   GROQ_API_KEY    your free key from https://console.groq.com  (no credit card)
//   JARVIS_PASSWORD the shared password visitors must enter
// Optional:
//   GROQ_MODEL      pin a model, e.g. "openai/gpt-oss-120b". If unset — or not available
//                   to this key — the first usable model from PREFERRED below is picked.

const SYSTEM = [
  "You are JARVIS, the voice of a personal AI command center for a solo founder.",
  "Reply as JARVIS: warm, crisp, confident, a touch cinematic — never robotic.",
  "Your reply is spoken ALOUD: keep it to 1-3 short sentences, no lists, no markdown, no emoji.",
  "LANGUAGE: reply in the language the user used. Korean input → natural spoken Korean (해요체), numbers as digits with Korean units (e.g. 25도, 13만 5천 원). English input → English, numbers said as words.",
  "Tool arguments stay in English even when the user speaks Korean: romanized city names (Seoul, Busan, Jeju), ISO currency codes. For Wikipedia, set language to ko and query in Korean when the user speaks Korean.",
  "",
  "WHAT YOU CAN ACTUALLY DO (use the tools for these):",
  "- current weather and a 4-day forecast for any city",
  "- air quality: fine dust PM2.5 and PM10, AQI, UV index",
  "- currency conversion at today's European Central Bank rates",
  "- short Wikipedia summaries of people, companies and concepts",
  "- upcoming public holidays for a country (Korea by default)",
  "- today's top tech headlines from Hacker News",
  "- set a countdown timer in the browser",
  "- a quick system check of voice, mic and brain (the user just says 'system check')",
  "- general conversation, brainstorming and answering from your own knowledge",
  "- understanding and answering in Korean or English, by voice or text",
  "",
  "WHAT YOU CANNOT DO YET: web search, reading or sending email, calendars, Notion, social media, files, long-term memory (you forget everything when the page reloads), or acting on other apps.",
  "Never claim you did, queued, drafted, scheduled or saved something unless a tool result confirms it. If asked for something you cannot do, say so plainly in one sentence and offer the closest thing you can do.",
  "When asked what you can do, name three or four of the real abilities above in one or two sentences — never invent others.",
  "Use tool results as the only source for live facts. If a tool returns an error, say what failed in plain words.",
  "If the user gives no city, use Seoul. Use the current date and time given below for anything time-related.",
  "",
  'FORMAT: on the FIRST line output exactly "ROUTE: <AgentName>" choosing one of Strategist, Researcher, Chief of Staff, Finance, Editor, Memory, Design, Engineering, Calendar, Email, Social, Ops, Marketing, Sales, Developer (or "ROUTE: none"). This only lights a node on screen. Then a blank line, then the spoken reply.'
].join("\n");

const UA = "jarvis-core/1.0 (personal voice assistant on Vercel)";
const MAX_ROUNDS = 3;

/* ---------------- tool definitions (sent to Groq) ---------------- */
const TOOLS = [
  fn("get_weather", "Current weather and 4-day forecast for a city.", {
    city: { type: "string", description: "City name in English, e.g. Seoul, Busan, Jeju, Tokyo. Translate Korean names to English." }
  }, ["city"]),
  fn("get_air_quality", "Current air quality for a city: PM2.5, PM10, US AQI and UV index.", {
    city: { type: "string", description: "City name in English, e.g. Seoul. Translate Korean names to English." }
  }, ["city"]),
  fn("convert_currency", "Convert an amount between currencies at today's ECB reference rate.", {
    amount: { type: "number", description: "Amount to convert, e.g. 100" },
    from: { type: "string", description: "ISO currency code to convert from, e.g. USD" },
    to: { type: "string", description: "ISO currency code to convert to, e.g. KRW" }
  }, ["amount", "from", "to"]),
  fn("wikipedia_summary", "Short Wikipedia summary of a person, company, place or concept.", {
    query: { type: "string", description: "What to look up, in the chosen edition's language, e.g. Sam Altman or 샘 올트먼" },
    language: { type: "string", enum: ["en", "ko"], description: "Wikipedia edition: ko when the user speaks Korean, otherwise en" }
  }, ["query"]),
  fn("upcoming_holidays", "Upcoming public holidays for a country.", {
    country_code: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. KR, US, JP. Default KR." }
  }, []),
  fn("tech_headlines", "Top tech and startup headlines from Hacker News right now.", {
    count: { type: "integer", description: "How many headlines, 1 to 5. Default 3." }
  }, []),
  fn("set_timer", "Start a countdown timer in the user's browser. It beeps and speaks when done.", {
    minutes: { type: "number", description: "Minutes, can be fractional. Use 0 if only seconds." },
    seconds: { type: "integer", description: "Extra seconds. Default 0." },
    label: { type: "string", description: "Short label, e.g. focus, tea" }
  }, ["minutes"])
];

function fn(name, description, properties, required) {
  return { type: "function", function: { name, description,
    parameters: { type: "object", properties, required } } };
}

/* ---------------- tool implementations ---------------- */
const WCODE = {0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",45:"fog",48:"rime fog",
  51:"light drizzle",53:"drizzle",55:"dense drizzle",56:"freezing drizzle",57:"freezing drizzle",
  61:"light rain",63:"rain",65:"heavy rain",66:"freezing rain",67:"freezing rain",
  71:"light snow",73:"snow",75:"heavy snow",77:"snow grains",
  80:"rain showers",81:"rain showers",82:"heavy rain showers",85:"snow showers",86:"snow showers",
  95:"thunderstorm",96:"thunderstorm with hail",99:"thunderstorm with hail"};
const round = v => Math.round(Number(v));

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(7000) });
  if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
  return r.json();
}

// Korean city names → names the geocoder knows. Searching "서울" finds nothing
// and "부산" lands on a different, inland Pusan, so translate first.
const KO_CITY = { "서울": "Seoul", "부산": "Busan", "인천": "Incheon", "대구": "Daegu", "대전": "Daejeon",
  "광주": "Gwangju", "울산": "Ulsan", "세종": "Sejong", "수원": "Suwon", "성남": "Seongnam", "고양": "Goyang",
  "용인": "Yongin", "창원": "Changwon", "청주": "Cheongju", "전주": "Jeonju", "천안": "Cheonan", "포항": "Pohang",
  "제주": "Jeju", "서귀포": "Seogwipo", "강릉": "Gangneung", "춘천": "Chuncheon", "원주": "Wonju", "여수": "Yeosu",
  "경주": "Gyeongju", "김해": "Gimhae", "안동": "Andong", "목포": "Mokpo", "속초": "Sokcho", "파주": "Paju", "평택": "Pyeongtaek" };
const HANGUL = /[가-힣]/;
const KO_CITY_EN = new Set(Object.values(KO_CITY).map(s => s.toLowerCase()));

async function geocode(city) {
  let q = String(city || "Seoul").trim().slice(0, 60);
  if (HANGUL.test(q)) {
    const base = q.replace(/\s+/g, "").replace(/(특별자치시|특별자치도|특별시|광역시|시|군)$/, "");
    q = KO_CITY[base] || q;
  }
  // Korean cities are searched inside Korea only — plain "Jeju" otherwise resolves to Ethiopia
  const kr = KO_CITY_EN.has(q.toLowerCase());
  const search = lang => getJSON("https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + lang +
    "&name=" + encodeURIComponent(q) + (kr ? "&countryCode=KR" : ""));
  let j = await search("en");
  let g = j && j.results && j.results[0];
  if (!g && HANGUL.test(q)) { j = await search("ko"); g = j && j.results && j.results[0]; }
  if (!g) return null;
  return { lat: g.latitude, lon: g.longitude, name: g.name + (g.country ? ", " + g.country : "") };
}

const IMPL = {
  async get_weather({ city }) {
    const g = await geocode(city);
    if (!g) return { result: { error: "place not found: " + city } };
    const j = await getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + g.lat + "&longitude=" + g.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=4");
    const c = j.current || {}, d = j.daily || {};
    const days = (d.time || []).map((t, i) => ({
      date: t, summary: WCODE[d.weather_code[i]] || "",
      high_c: round(d.temperature_2m_max[i]), low_c: round(d.temperature_2m_min[i]),
      rain_chance_pct: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null
    }));
    const names = ["Today", "Tomorrow"];
    return {
      result: { place: g.name, now: { temp_c: round(c.temperature_2m), feels_c: round(c.apparent_temperature),
        summary: WCODE[c.weather_code] || "", humidity_pct: c.relative_humidity_2m, wind_kmh: round(c.wind_speed_10m) }, days },
      cards: { title: "weather · " + g.name, items: days.map((x, i) => ({
        title: names[i] || x.date, label: x.summary,
        desc: "High " + x.high_c + "°C · Low " + x.low_c + "°C" + (x.rain_chance_pct != null ? " · rain " + x.rain_chance_pct + "%" : "")
      })) }
    };
  },

  async get_air_quality({ city }) {
    const g = await geocode(city);
    if (!g) return { result: { error: "place not found: " + city } };
    const j = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + g.lat + "&longitude=" + g.lon +
      "&current=pm10,pm2_5,us_aqi,uv_index&timezone=auto");
    const c = j.current || {};
    // Korean Ministry of Environment PM2.5 bands (µg/m³)
    const pm25 = Number(c.pm2_5), pm10 = Number(c.pm10);
    const band25 = pm25 <= 15 ? "good" : pm25 <= 35 ? "moderate" : pm25 <= 75 ? "bad" : "very bad";
    const band10 = pm10 <= 30 ? "good" : pm10 <= 80 ? "moderate" : pm10 <= 150 ? "bad" : "very bad";
    return {
      result: { place: g.name, pm2_5_ugm3: round(pm25), pm2_5_level_korea: band25, pm10_ugm3: round(pm10),
        pm10_level_korea: band10, us_aqi: c.us_aqi, uv_index: c.uv_index,
        mask_advice: (band25 === "bad" || band25 === "very bad" || band10 === "bad" || band10 === "very bad") ? "mask recommended" : "no mask needed" },
      cards: { title: "air quality · " + g.name, items: [
        { title: "PM2.5 · " + round(pm25) + " µg/m³", label: band25, desc: "Fine dust (초미세먼지)" },
        { title: "PM10 · " + round(pm10) + " µg/m³", label: band10, desc: "Dust (미세먼지)" },
        { title: "US AQI · " + c.us_aqi, label: "UV index " + c.uv_index, desc: "" }
      ] }
    };
  },

  async convert_currency({ amount, from, to }) {
    const a = Number(amount);
    const f = String(from || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const t = String(to || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!isFinite(a) || f.length !== 3 || t.length !== 3) return { result: { error: "need an amount and two 3-letter currency codes" } };
    if (f === t) return { result: { amount: a, from: f, to: t, converted: a } };
    let j;
    try { j = await getJSON("https://api.frankfurter.dev/v1/latest?base=" + f + "&symbols=" + t); }
    catch (e) { if (e.status === 404 || e.status === 422) return { result: { error: "unsupported currency " + f + " or " + t } }; throw e; }
    const rate = j.rates && j.rates[t];
    if (!rate) return { result: { error: "unsupported currency " + t } };
    const converted = Math.round(a * rate * 100) / 100;
    return {
      result: { amount: a, from: f, to: t, rate, converted, rate_date: j.date, source: "European Central Bank" },
      cards: { title: "currency · " + f + " → " + t, items: [
        { title: a.toLocaleString("en-US") + " " + f + " = " + converted.toLocaleString("en-US") + " " + t,
          label: "ECB rate " + j.date, desc: "1 " + f + " = " + rate + " " + t }
      ] }
    };
  },

  async wikipedia_summary({ query, language }) {
    const q = String(query || "").slice(0, 100);
    const find = async lang => {
      const s = await getJSON("https://" + lang + ".wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=" + encodeURIComponent(q));
      const hit = s.query && s.query.search && s.query.search[0];
      return hit ? { lang, title: hit.title } : null;
    };
    // Korean edition first when asked; fall back to English if it has no article
    const hit = (language === "ko" && await find("ko")) || await find("en");
    if (!hit) return { result: { error: "no Wikipedia article found for " + q } };
    const p = await getJSON("https://" + hit.lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(hit.title.replace(/ /g, "_")));
    const url = (p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page) || "";
    return {
      result: { title: p.title, language: hit.lang, description: p.description || "", summary: String(p.extract || "").slice(0, 1200) },
      cards: { title: "wikipedia · " + p.title, items: [
        { title: p.title, url, label: p.description || hit.lang + ".wikipedia.org", desc: p.extract || "" }
      ] }
    };
  },

  async upcoming_holidays({ country_code }) {
    const cc = String(country_code || "KR").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "KR";
    let list;
    try { list = await getJSON("https://date.nager.at/api/v3/NextPublicHolidays/" + cc); }
    catch (e) { if (e.status === 404) return { result: { error: "no holiday data for country " + cc } }; throw e; }
    // merge consecutive days with the same name (e.g. Chuseok spans 3 days)
    const merged = [];
    for (const h of list) {
      const last = merged[merged.length - 1];
      if (last && last.name === h.name) last.end = h.date;
      else merged.push({ name: h.name, local_name: h.localName, start: h.date, end: h.date });
    }
    const top = merged.slice(0, 5);
    return {
      result: { country: cc, holidays: top },
      cards: { title: "holidays · " + cc, items: top.map(h => ({
        title: h.name + (h.local_name && h.local_name !== h.name ? " · " + h.local_name : ""),
        label: h.start === h.end ? h.start : h.start + " → " + h.end, desc: ""
      })) }
    };
  },

  async tech_headlines({ count }) {
    const n = Math.max(1, Math.min(5, parseInt(count, 10) || 3));
    const ids = await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json");
    const items = await Promise.all(ids.slice(0, n).map(id =>
      getJSON("https://hacker-news.firebaseio.com/v0/item/" + id + ".json").catch(() => null)));
    const stories = items.filter(Boolean).map(it => ({ title: it.title, points: it.score,
      url: it.url || "https://news.ycombinator.com/item?id=" + it.id }));
    return {
      result: { headlines: stories.map(s => ({ title: s.title, points: s.points })) },
      cards: { title: "tech headlines · hacker news", items: stories.map(s => ({
        title: s.title, url: s.url, label: s.points + " points", desc: "" })) }
    };
  },

  async set_timer({ minutes, seconds, label }) {
    const total = Math.round((Number(minutes) || 0) * 60 + (parseInt(seconds, 10) || 0));
    if (!(total > 0)) return { result: { error: "timer length must be more than zero" } };
    if (total > 6 * 3600) return { result: { error: "timer can be at most six hours" } };
    const lab = String(label || "timer").slice(0, 30);
    return { result: { started: true, total_seconds: total, label: lab,
      note: "The timer is running in the browser tab; it stops if the tab is closed." },
      action: { type: "timer", seconds: total, label: lab } };
  }
};

async function runTool(name, argsJson) {
  const impl = IMPL[name];
  if (!impl) return { result: { error: "unknown tool " + name } };
  let args = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch (e) { return { result: { error: "bad arguments" } }; }
  try { return await impl(args || {}); }
  catch (e) { return { result: { error: name + " service unreachable (" + String((e && e.message) || e).slice(0, 60) + ")" } }; }
}

/* ---------------- Groq call ---------------- */
// Model choice: GROQ_MODEL if set, otherwise the first of PREFERRED.
// If Groq says the model doesn't exist for this key, ask /models once and switch.
const PREFERRED = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"];
let activeModel = null;   // remembered while the function instance stays warm

async function availableModel(KEY) {
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { authorization: "Bearer " + KEY }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).filter(m => m && m.active !== false).map(m => m.id);
  return PREFERRED.find(p => ids.includes(p)) ||
    ids.find(id => !/whisper|guard|orpheus|compound|tts|safeguard/i.test(id)) || null;
}

function modelOptions(model) {
  // reasoning models think before answering — keep that short, hidden, and budgeted
  if (/^openai\/gpt-oss/.test(model)) return { reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 1200 };
  if (/^qwen\//.test(model)) return { reasoning_effort: "none", reasoning_format: "hidden", max_completion_tokens: 600 };
  return { max_completion_tokens: 300 };
}

async function groqOnce(KEY, model, payload) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + KEY },
    body: JSON.stringify({ ...payload, model, ...modelOptions(model) }),
    signal: AbortSignal.timeout(25000)
  });
  if (r.ok) return { ok: true, json: await r.json(), model };
  const text = await r.text().catch(() => "");
  return { ok: false, status: r.status, text, model };
}

async function groq(KEY, payload) {
  const model = activeModel || process.env.GROQ_MODEL || PREFERRED[0];
  const r = await groqOnce(KEY, model, payload);
  if (r.ok) { activeModel = model; return r; }
  const missing = r.status === 404 || /model_not_found|does not exist|decommissioned/i.test(r.text || "");
  if (!missing) return r;
  const alt = await availableModel(KEY).catch(() => null);
  console.error("groq model unavailable:", model, "→ switching to", alt);
  if (!alt || alt === model) return r;
  const r2 = await groqOnce(KEY, alt, payload);
  if (r2.ok) activeModel = alt;
  return r2;
}

function cleanHistory(raw) {
  // only plain user/assistant turns from the browser — never system/tool roles
  return (Array.isArray(raw) ? raw : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

function clockLine(tz) {
  const zone = typeof tz === "string" && tz.length < 50 ? tz : "Asia/Seoul";
  try {
    return "Current date and time for the user: " + new Date().toLocaleString("en-US",
      { timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (" + zone + ").";
  } catch (e) {
    return "Current date and time for the user: " + new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }) + " (Asia/Seoul).";
  }
}

module.exports = async (req, res) => {
  // same-origin in production; permissive headers are harmless
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const PASS = process.env.JARVIS_PASSWORD || "";
  const KEY = process.env.GROQ_API_KEY || "";

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // password gate
  if (PASS && body.password !== PASS) {
    return res.status(401).json({ error: "bad_password" });
  }
  // lightweight auth ping (used by the page's password screen)
  if (body.ping) return res.status(200).json({ ok: true });

  if (!KEY) return res.status(500).json({ error: "server_missing_key",
    message: "GROQ_API_KEY is not set on the server." });

  const history = cleanHistory(body.messages);
  if (!history.length) return res.status(400).json({ error: "no_messages" });

  // the page's language setting: "ko"/"en" pins the reply language, "auto" follows the user
  const langLine = body.lang === "ko" ? "\nReply in Korean." : body.lang === "en" ? "\nReply in English." : "";
  const system = SYSTEM + "\n" + clockLine(body.tz) + langLine;
  const messages = [{ role: "system", content: system }, ...history];
  const cards = [];
  const actions = [];
  const toolsUsed = [];
  const toolNotes = [];   // tool results as plain text, for the no-tools fallback
  const busy = () => res.status(429).json({ error: "rate_limited",
    message: "Free model is busy or the daily limit was hit — try again shortly." });
  const done = text => res.status(200).json({ text: (text || "").trim(), cards, actions, tools: toolsUsed, model: activeModel });

  // Plain chat without tool definitions — how the brain worked before tools.
  // Used whenever a tool-enabled call fails, so a reply always comes back.
  async function plainReply() {
    const sys = system + (toolNotes.length
      ? "\nTool results already fetched for this question (use them, do not invent others):\n" + toolNotes.join("\n")
      : "\nTools are unavailable for this reply; answer from your own knowledge and say so if live data was needed.");
    const r = await groq(KEY, { temperature: 0.6,
      messages: [{ role: "system", content: sys }, ...history] });
    if (r.ok) {
      const m = (r.json.choices && r.json.choices[0] && r.json.choices[0].message) || {};
      return done(m.content);
    }
    console.error("groq plain fallback failed", r.status, (r.text || "").slice(0, 600));
    if (r.status === 429) return busy();
    return res.status(502).json({ error: "upstream", message: "Groq " + r.status + ": " + (r.text || "").slice(0, 160) });
  }

  try {
    let retried = false;
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS;
      const payload = { temperature: retried ? 0.1 : 0.4, messages };
      if (!lastRound) { payload.tools = TOOLS; payload.tool_choice = "auto"; }

      const r = await groq(KEY, payload);
      if (!r.ok) {
        console.error("groq tool call failed", r.status, "round", round, (r.text || "").slice(0, 600));
        if (r.status === 429) return busy();
        // malformed tool call from the model — Groq suggests retrying cooler once
        if (r.status === 400 && /tool_use_failed/.test(r.text) && !retried) { retried = true; round--; continue; }
        return await plainReply();
      }

      const msg = (r.json.choices && r.json.choices[0] && r.json.choices[0].message) || {};
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length || lastRound) {
        if (!(msg.content || "").trim() && toolNotes.length) return await plainReply();
        return done(msg.content);
      }

      messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
      const outs = await Promise.all(calls.slice(0, 4).map(c => runTool(c.function && c.function.name, c.function && c.function.arguments)));
      calls.slice(0, 4).forEach((c, i) => {
        const out = outs[i];
        const name = c.function && c.function.name;
        const json = JSON.stringify(out.result);
        toolsUsed.push(name);
        toolNotes.push(name + ": " + json.slice(0, 1500));
        if (out.cards) cards.push(out.cards);
        if (out.action) actions.push(out.action);
        messages.push({ role: "tool", tool_call_id: c.id, name, content: json.slice(0, 4000) });
      });
      // any tool calls beyond the first four still need an answer so the thread stays valid
      calls.slice(4).forEach(c => messages.push({ role: "tool", tool_call_id: c.id,
        name: c.function && c.function.name, content: JSON.stringify({ error: "skipped: too many tools at once" }) }));
    }
    return await plainReply();
  } catch (e) {
    console.error("chat handler error", String((e && e.message) || e).slice(0, 300));
    try { return await plainReply(); }
    catch (e2) { return res.status(502).json({ error: "upstream", message: String((e2 && e2.message) || e2).slice(0, 200) }); }
  }
};

// exported for local testing of the tools without calling Groq
module.exports.IMPL = IMPL;
````

### `api/transcribe.js`

<!-- FILE: api/transcribe.js sha256=c107dc29430268a8514a33e011dba5c75dbdca4843ec07a5ae53ef4d2a44c7e9 -->
````js
// Vercel serverless function — speech to text via Groq Whisper.
// The browser records one short utterance and POSTs the raw audio here;
// the Groq key stays server-side. Korean and English are detected automatically.
//
// Request:  POST /api/transcribe?lang=auto|ko|en
//           headers  x-jarvis-password  (encodeURIComponent'd shared password)
//                    x-audio-type       (recorder mime type, e.g. audio/webm)
//                    content-type       application/octet-stream
//           body     raw audio bytes (max 4 MB — Vercel caps request bodies at 4.5 MB)
// Response: { text, language: "ko" | "en" | "" }
//
// Uses the same env vars as api/chat.js: GROQ_API_KEY, JARVIS_PASSWORD.

const MAX_BYTES = 4 * 1024 * 1024;
const MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3",
  "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "m4a" };
const LANG = { korean: "ko", ko: "ko", english: "en", en: "en" };
// Whisper invents these on near-silent clips (Korean YouTube / broadcast outros)
const HALLUCINATION = /^(시청해\s*주셔서\s*감사합니다|구독과\s*좋아요.*|MBC\s*뉴스.*|감사합니다|thank you for watching|thanks for watching|thank you)[.!。\s]*$/i;

async function readAudio(req) {
  // Vercel hands octet-stream bodies over as a Buffer; otherwise read the stream
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : (v || "");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-jarvis-password, x-audio-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const PASS = process.env.JARVIS_PASSWORD || "";
  const KEY = process.env.GROQ_API_KEY || "";

  let given = "";
  try { given = decodeURIComponent(header(req, "x-jarvis-password")); } catch (e) { given = ""; }
  if (PASS && given !== PASS) return res.status(401).json({ error: "bad_password" });
  if (!KEY) return res.status(500).json({ error: "server_missing_key", message: "GROQ_API_KEY is not set on the server." });

  const audio = await readAudio(req);
  if (audio.length > MAX_BYTES) return res.status(413).json({ error: "too_large", message: "Recording is longer than the limit." });
  if (audio.length < 800) return res.status(400).json({ error: "empty_audio", message: "No audio received." });

  const mime = String(header(req, "x-audio-type") || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime] || "webm";
  const q = String((req.query && req.query.lang) || new URL(req.url, "http://x").searchParams.get("lang") || "auto");
  const lang = q === "ko" || q === "en" ? q : "";

  let lastErr = "";
  for (const model of MODELS) {
    const fd = new FormData();
    fd.append("file", new Blob([audio], { type: mime }), "speech." + ext);
    fd.append("model", model);
    fd.append("response_format", "verbose_json");
    fd.append("temperature", "0");
    if (lang) {
      fd.append("language", lang);
      fd.append("prompt", lang === "ko" ? "자비스에게 하는 짧은 음성 명령." : "A short voice command to Jarvis.");
    }
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { authorization: "Bearer " + KEY }, body: fd, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      return res.status(502).json({ error: "upstream", message: "Whisper unreachable: " + String((e && e.message) || e).slice(0, 120) });
    }
    if (r.status === 429) return res.status(429).json({ error: "rate_limited", message: "Speech limit reached — try again shortly." });
    if (!r.ok) {
      lastErr = "Whisper " + r.status + ": " + (await r.text().catch(() => "")).slice(0, 160);
      console.error("transcribe failed", model, lastErr);
      if (r.status === 404 || /model_not_found|does not exist|decommissioned/i.test(lastErr)) continue;  // try the next model
      return res.status(502).json({ error: "upstream", message: lastErr });
    }
    const j = await r.json().catch(() => ({}));
    let text = String(j.text || "").trim();
    const segs = Array.isArray(j.segments) ? j.segments : [];
    if (segs.length && segs.every(s => Number(s.no_speech_prob) > 0.6)) text = "";   // mostly silence
    if (HALLUCINATION.test(text)) text = "";
    const detected = LANG[String(j.language || "").toLowerCase()] || (/[가-힣]/.test(text) ? "ko" : (text ? "en" : ""));
    return res.status(200).json({ text, language: lang || detected, model });
  }
  return res.status(502).json({ error: "upstream", message: lastErr || "no speech model available" });
};
````

### `package.json`

<!-- FILE: package.json sha256=6b7fad3c4dce8a46f9add43707adac4de04410e0ddf0267cb33283b3a698222b -->
````json
{
  "name": "jarvis-voice",
  "version": "1.0.0",
  "private": true,
  "description": "Jarvis voice command center — static page + Groq brain proxy (Vercel)"
}
````

### `README.md`

<!-- FILE: README.md sha256=66dd36009b772c047d936dd5bdeb9c2fa75e9d7d122df236298bc6a715478fa1 -->
````markdown
# Jarvis Core · Voice (Vercel)

A voice-driven "Jarvis" command center you can deploy to a public URL.
Speak to it, it replies out loud, shows live weather + search-style result
cards, and runs a real LLM brain — all for **$0** using Groq's free tier.
A shared **password** gates it so strangers can't burn your free quota.

- **Voice in / out + clap-to-wake** — works smoothly once deployed to https
  (browser remembers the mic permission after one Allow).
- **Brain** — Groq (free, fast open models). The key stays server-side.
- **Weather** — live via open-meteo (no key).
- Not included: your personal Calendar/Gmail/Notion connectors (those only
  work inside the claude.ai artifact version).

## 1. Get a free Groq key (no credit card)
1. Go to https://console.groq.com and sign in.
2. **API Keys → Create API Key** → copy it (starts with `gsk_...`).

## 2. Deploy to Vercel

**Option A — drag & drop / Git (easiest)**
1. Put this folder in a GitHub repo (or use Vercel's "deploy folder").
2. On https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other**. Deploy.

**Option B — CLI**
```bash
npm i -g vercel
cd jarvis-vercel
vercel        # follow prompts
vercel --prod # deploy to production
```

## 3. Set environment variables (Vercel → Project → Settings → Environment Variables)
| Name | Value |
| --- | --- |
| `GROQ_API_KEY` | your `gsk_...` key |
| `JARVIS_PASSWORD` | any password you choose |
| `GROQ_MODEL` | *(optional)* pin a model such as `openai/gpt-oss-120b`. Leave it unset and the server picks the first model your key can use (`PREFERRED` in `api/chat.js`). |

After adding them, **redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the values.

## 4. Use it
- Open your `https://<project>.vercel.app` URL.
- Enter the password once.
- Tap the mic (allow the microphone once) and speak Korean or English — Groq
  Whisper detects which, and Jarvis answers in the same language. The **Lang**
  menu can pin one language.
- Try: *"what can you do?"*, *"system check"*, *"weather in Busan"*,
  *"is the air bad today?"*, *"100 dollars in won"*, *"who is Sam Altman?"*,
  *"next holiday"*, *"tech headlines"*, *"timer 25 minutes"*, or just chat.
  In Korean too: *"오늘 미세먼지 어때?"*, *"제주 날씨 어때?"*, *"25분 타이머 맞춰줘"*.
- The brain calls real tools on the server (`api/chat.js` → `IMPL`): Open-Meteo
  weather + air quality, Frankfurter (ECB) currency, Wikipedia, Nager.Date
  holidays, Hacker News, and a browser timer. None of them need a key.
- Toggle **Clap ×2 to wake** to start listening by clapping twice.

## Notes
- **Cost:** Vercel Hobby = free, Groq free tier = free. No billing attached.
- **Limits:** free models have per-minute / per-day caps (fine for personal use;
  if you share widely you may hit them — that only pauses replies, no charge).
- Voice input goes through Groq Whisper (`api/transcribe.js`), so it works in
  any browser that can record; Chrome's built-in recognizer is the fallback.
  Korean replies use a Korean voice — Chrome's "Google 한국의" sounds best.
- Change the agent names / persona in `api/chat.js` (the `SYSTEM` prompt) and in
  `index.html` (the `AGENTS` array) to match your own workflow.
````

### `.env.example`

<!-- FILE: .env.example sha256=4dca9d87e66b0f3dfc201f1f4a3c3c0bac7bf15196207aac5c64483412ab8029 -->
````bash
# Copy these into Vercel → Project → Settings → Environment Variables
# (do NOT commit real values to git)

GROQ_API_KEY=your_free_groq_key_here
JARVIS_PASSWORD=choose-a-password
# optional — leave unset to auto-pick the first model your key can use
# GROQ_MODEL=openai/gpt-oss-120b
````
