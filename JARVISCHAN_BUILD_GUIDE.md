# Jarvischan 빌드 가이드

음성으로 말하면 대답하고, 실제 도구(날씨·대기질·환율·위키·공휴일·헤드라인·타이머)를 쓰고, 로컬 에이전트로 내 컴퓨터의 앱까지 여는 영화 스타일 음성 비서를 Vercel에 배포하는 가이드입니다. 지금 배포본(`https://jarvischan.vercel.app`)과 똑같은 결과물을 만들 수 있습니다.

이 문서 하나에 명세, 구현 순서, 그동안 겪은 함정, 테스트 방법, 그리고 **파일 원본 전체**(맨 아래 부록)가 들어 있다.

**이미 배포된 상태에서 이어서 작업한다면:** `jarvischan-vercel/`이 이미 있고 GitHub(`https://github.com/kheechan04/jarvischan`, Public, MIT 라이선스)에도 연결돼 있다. §5-1 추출 스크립트를 다시 돌릴 필요 없이 파일을 바로 고치고, §5-2 검증 후 `git add`·`git commit`·`git push`만 하면 자동 배포된다(§5-3b). 고친 파일은 이 가이드 맨 아래 부록에도 §5-1과 같은 형식으로 다시 동기화해서, md와 실제 코드가 항상 같은 내용이게 유지한다. 현재 상태 요약은 §8에 있다.

---

## Claude Code에게 이렇게 말한다

> 이 가이드(`JARVISCHAN_BUILD_GUIDE.md`)대로 Jarvischan을 구현하고 Vercel에 배포해줘. 부록의 파일은 추출 스크립트로 그대로 꺼내고, 검증 단계를 모두 통과한 뒤에 배포해. API 키와 비밀번호는 내가 직접 넣을게.

### Claude Code가 지켜야 할 규칙

- 부록 파일은 **다시 쓰지 말고 추출 스크립트로 그대로 꺼낸다.** 추출한 뒤 SHA-256이 부록 표와 같은지 확인한다.
- `GROQ_API_KEY`와 `JARVIS_PASSWORD` 값은 **사용자가 직접 입력한다.** Claude는 키나 비밀번호를 받거나 입력하지 않고, `vercel env pull`로 비밀값을 로컬에 내려받지도 않는다.
- 프로젝트 폴더 안에 `.claude/` 같은 작업용 파일을 남기지 않는다. Vercel이 폴더 전체를 공개 사이트로 올린다.
- 검증 단계(§5)를 건너뛰지 않는다. 실패하면 배포하지 말고 결과를 그대로 보고한다.
- 문서 문체: 사용자용 README는 "\~해요", 이 가이드 같은 개발 문서는 "\~한다"(shadow-mitts와 같은 규칙). 한 줄에 `~`가 두 번 있으면 GitHub가 취소선으로 그리니 `\~`로 쓴다.

---

## 1. 결과물

| 영역 | 내용 |
|---|---|
| 화면 | 영화 속 JARVIS 스타일 홀로그램 HUD 코어, 15개 에이전트 노드가 도는 3D 구, 대화 말풍선, 결과 카드 창, 원형 음성 이퀄라이저 |
| 음성 | Groq Whisper 음성 인식(한국어·영어 자동 감지, 녹음되는 모든 브라우저) + 브라우저 음성 합성(한국어·영어 목소리 자동 선택). 로그인 전이나 녹음이 안 되면 Chrome 음성 인식으로 대체. 박수 두 번이나 웨이크워드로 깨우기 |
| 두뇌 | Vercel 서버 함수 `api/chat.js` → Groq(무료). 모델이 도구를 스스로 골라 호출 |
| 도구 | 날씨·4일 예보, 대기질(PM2.5·PM10), 환율, 위키 요약, 공휴일, 테크 헤드라인, 타이머. **모두 키 불필요** |
| 컴퓨터 조작 | 선택 사항인 로컬 에이전트(§9)로 앱·URL·파일 열기, 스크린샷, 볼륨 등. 윈도우 전용 |
| 보안 | 공용 비밀번호 1개(`JARVIS_PASSWORD`). Groq 키는 서버에만 있고 브라우저로 가지 않음 |
| 테마 | Stark(청록 홀로그램 + 주황, 기본값) / Mignon(마젠타 + 노랑). 화면에서 바꾸면 기억됨 |
| 비용 | Vercel Hobby + Groq 무료 플랜 = 0원 |

### 파일 구조

```
jarvischan-vercel/
├── index.html      # 화면 전체: HUD 캔버스, 음성, 대화, 결과 카드, 타이머, 테마 (빌드 과정 없음)
├── api/chat.js     # Vercel Node 서버 함수: 비밀번호 확인, Groq 도구 호출 루프, 도구 7개 + 로컬 에이전트 도구 9개(§9)
├── api/transcribe.js # Vercel Node 서버 함수: 녹음 → Groq Whisper 받아쓰기(한국어·영어 감지)
├── manifest.webmanifest # PWA 설치 정보(이름·아이콘·standalone) — 크롬 '설치' 버튼, iOS 홈 화면 추가
├── icons/          # PWA 아이콘 PNG 4개(192·512·maskable 512·apple-touch 180) — 바이너리라 부록에 없음, 저장소에 직접 있음
├── package.json    # 의존성 없음
├── README.md
└── .env.example    # 환경변수 이름 안내 (실제 값은 넣지 않음)

local-agent/         # Vercel과 별개로 사용자 컴퓨터에서 직접 실행하는 동반 프로그램 — §9
├── agent.js         # ws://localhost:8765 서버, 허용 목록 명령 실행
├── apps.json        # 열기/닫기 가능한 앱 허용 목록(부르는 이름 → 실행 명령·프로세스명)
├── package.json     # 의존성: ws
├── start-agent.bat  # 더블클릭 실행용
├── install-autostart.(ps1|bat), uninstall-autostart.(ps1|bat)  # 윈도우 로그인 시 자동 실행
└── README.md        # 설치·페어링·명령 목록 사용법

README.md, LICENSE   # 저장소 소개(한국어)와 MIT 라이선스 — Root Directory 밖이라 배포되지 않음
```

프레임워크, 빌드 과정, npm 의존성이 모두 없다(`local-agent/`의 `ws` 하나만 예외). Vercel이 `index.html`은 정적 파일로, `api/*.js`는 Node 함수로 자동 인식한다. `local-agent/`는 Vercel에 배포되지 않고 사용자 컴퓨터에서 직접 실행된다.

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
     └─ POST /api/chat  {password, messages, tz, lang, localAgent}
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
  cards → 오른쪽 결과 창 / actions(timer) → 카운트다운 / actions(device) → 로컬 에이전트 / text → 말풍선 + 음성
  두뇌 연결 실패 → 날씨만 브라우저에서 직접 조회, 나머지는 "지금은 못 한다"고 솔직하게 대답
```

---

## 3. 서버 명세 — `api/chat.js`

### 요청과 응답

**요청:** `POST /api/chat`

```json
{ "password": "…", "messages": [{"role":"user","content":"100 dollars in won"}], "tz": "Asia/Seoul", "lang": "auto", "localAgent": false }
```

- `ping: true`만 보내면 비밀번호만 확인하고 `{ok:true}`를 돌려준다. 비밀번호 화면에서 쓴다.
- `messages`는 `user`와 `assistant` 역할만 받는다(최근 20개 = 약 10턴, 각 2,000자까지). 기억 범위와 응답 속도 사이의 절충값이다 — 기록이 많을수록 매번 보내는 프롬프트가 커져서 응답이 느려진다. `system`이나 `tool` 역할은 서버가 버린다.
- `tz`는 현재 시각을 알려주는 데 쓴다. 기본값은 `Asia/Seoul`.
- `lang`(auto·ko·en): ko나 en이면 그 언어로만 대답하고, auto면 사용자가 쓴 언어로 대답한다.
- `localAgent`: 로컬 에이전트가 지금 연결돼 있으면 `true`. 이때만 컴퓨터 조작 도구 9개(§9)를 모델에 넘긴다.

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

- `text` 첫 줄의 `ROUTE: <에이전트>`는 화면의 노드를 켜는 데만 쓴다. 실제로 일을 넘기지는 않는다.

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

- 모델: `whisper-large-v3-turbo`, 404면 `whisper-large-v3`.
- `lang`이 ko나 en이면 Whisper에 언어를 알려준다(정확도가 올라간다). auto면 자동 감지.
- 무음 판정: 모든 구간의 `no_speech_prob`가 0.6보다 크면 빈 글자로 돌려준다. "시청해주셔서 감사합니다" 같은 Whisper 환각 문구도 빈 글자로 바꾼다.
- 언어: 응답의 `language`(korean/english)를 쓰고, 없으면 한글이 들어 있는지로 판단한다.
- Vercel은 `application/octet-stream` 본문을 Buffer(`req.body`)로 넘겨준다. 요청 본문 한도가 4.5MB라서 녹음은 20초로 제한한다.
- 오류: 401 `bad_password` · 400 `empty_audio` · 413 `too_large` · 429 `rate_limited` · 500 `server_missing_key` · 502 `upstream`
- 무료 한도: 하루 2,000건, 오디오 28,800초. 한 번에 최소 10초로 계산된다.

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
- 한글 도시 이름(서울·부산·제주 등 30곳, `KO_CITY`)은 서버에서 영어로 바꾼다. 한국 도시는 `countryCode=KR`로 한국 안에서만 찾는다. 그냥 "Jeju"로 찾으면 에티오피아가 나온다.
- 외부 호출은 모두 7초 제한 시간이 있고, `User-Agent` 헤더를 붙인다(위키가 요구한다).
- 도구가 실패하면 예외를 던지지 않고 `{error:"…"}`를 모델에 넘긴다. 모델은 무엇이 실패했는지 말로 설명한다.

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

- 생각 과정이 있는 모델은 생각에 쓰는 토큰도 한도에 포함된다. 그래서 한도를 넉넉히 준다.
- `reasoning_format:"raw"`를 도구 호출과 같이 쓰면 400 에러가 난다.
- 도구 호출은 `temperature 0.4`로 보낸다. `tool_use_failed` 에러가 나면 한 번만 `0.1`로 다시 시도한다.

### 실패 대비 순서

1. 429 → 바로 `rate_limited`
2. 400 `tool_use_failed` → 온도를 낮춰 1회 재시도
3. 그 밖의 실패, 3회 반복 초과, 빈 대답 → `plainReply()`: 도구 정의 없이 일반 대화로 대답한다. 이미 받은 도구 결과는 지시문에 글로 넣는다.
4. 그것도 실패 → 502와 함께 `Groq <상태코드>: <내용>`을 돌려준다. 화면 노란 문구에 그대로 뜬다.

실패는 모두 `console.error`로 Vercel 로그에 남는다. 키 값은 기록하지 않는다.

### 지시문(SYSTEM)의 핵심

- 대답은 소리 내어 읽으므로 1~3문장, 목록·마크다운·이모지 금지
- 사용자가 쓴 언어로 대답: 한국어는 해요체에 숫자는 아라비아 숫자+단위(25도, 13만 5천 원), 영어는 숫자를 단어로
- 도구 인수는 영어로(도시는 로마자, 통화는 ISO 코드). 위키만 한국어 사용자에게 ko판을 쓴다
- **할 수 있는 일**과 **아직 못 하는 일**(웹 검색·메일·캘린더·노션·SNS·장기 기억)을 명시. 앱·파일 열기 같은 컴퓨터 조작은 로컬 에이전트가 연결돼 있을 때만 할 수 있다고 말한다
- 도구 결과로 확인되지 않은 일을 "했다", "예약했다", "저장했다"고 말하지 않기
- "what can you do"에는 실제 기능 3~4개만 말하기
- 도시를 말하지 않으면 서울
- 첫 줄에 `ROUTE: <에이전트>` 형식

---

## 4. 화면 명세 — `index.html`

단일 파일이다. 폰트는 Google Fonts의 Chakra Petch(제목), IBM Plex Mono(데이터)를 쓴다.

### 음성 입력과 언어

- 비밀번호로 들어온 뒤 녹음이 되는 브라우저면 **Whisper**를 쓴다. 마이크를 누르면 녹음이 시작되고 말이 끝나면 자동으로 멈춘다. 다시 누르면 바로 멈추고, 최대 20초이며, 7초 동안 말이 없으면 취소된다.
- 말 끝 판정: 크롬은 브라우저 자체 음성 종료 신호(`onspeechend`)를 먼저 쓴다. 그 밖에는 소리 크기로 판단한다 — 녹음 첫 0.3초로 방 소음 수준(floor, 최대 0.7)을 재고 0.7초마다 다시 잡는다. floor보다 0.08 이상 크면 말소리, 말을 들은 뒤 floor + 0.035 아래로 0.8초 이어지면 멈춘다. 이렇게 된 과정은 §6 표에 있다.
- 녹음 형식: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`(Safari) → `audio/ogg` 중 브라우저가 지원하는 것.
- 그 밖의 경우(로그인 전, 녹음 불가, Whisper 시작 실패)는 브라우저 음성 인식을 쓴다. 인식 언어는 Lang 메뉴를 따르고, Auto면 브라우저 언어를 따른다.
- **Lang 메뉴**(Auto·한국어·English, `localStorage.jarvis_lang`): Auto는 Whisper가 감지한 언어로, 한국어·English는 그 언어로 고정한다. 서버에도 `lang`으로 전달한다.
- **목소리:** 대답에 한글이 있으면 한국어 목소리(Google 한국의 > Yuna > 그 밖의 ko 목소리)를, 없으면 Voice 메뉴의 영어 목소리를 쓴다.
- 기능 카드, 오프라인 대답, 오프라인 날씨, 타이머 알림, 시스템 점검 문구도 마지막 대화 언어(`lastLang`)를 따라 한국어로 나온다.

### 입력 처리 순서 (`handleInput`)

1. `SYS_RE`(system check, 시스템 점검 등) → 브라우저에서 바로 점검. 두뇌와 도구는 **비밀번호 인증이 됐을 때만** ✓로 표시한다.
2. `CAP_RE`("what can you do", "뭐 할 수 있어" 등) → 기능 카드 8개를 결과 창에 먼저 띄운다.
3. `/api/chat` 호출 → `handleTools(out)`로 카드·타이머·로그 처리 → 대답을 말풍선과 음성으로. `handleTools`에서 화면 오류가 나도 두뇌 실패로 착각하지 않게 따로 감싼다.
4. 실패하면 401은 비밀번호 화면으로, 429는 "busy" 안내, 그 밖은 노란 문구에 원인을 표시한다.
5. 오프라인 대비: 날씨 문장이면 브라우저에서 open-meteo를 직접 조회한다.
6. 그 밖에는 `localBrain` → "지금은 두뇌에 연결할 수 없다"고 솔직하게 대답한다. **가짜로 '하는 척'하는 대답은 금지.**

### 타이머

- `set_timer` 액션을 받으면 버튼 줄에 주황 칩(`#timer`)이 뜬다. 0.5초마다 갱신하고, 끝나면 삐 소리 3번과 함께 "Your … timer is done."(한국어 대화면 한국어)을 말한다. ✕로 취소할 수 있다.
- 탭을 닫으면 타이머도 멈춘다. 이 사실은 도구 결과에도 적혀 있다.

### 테마

- `<head>`의 짧은 스크립트가 첫 화면이 그려지기 전에 `<html data-core="stark|mignon">`을 붙인다. 저장값은 `localStorage.jarvis_theme`이고, 기본은 `stark`.
- CSS 색은 전부 토큰으로 쓴다. 마젠타 색 값은 `rgba(var(--m-rgb),a)` 형태로 바꿔 두었다.
- 아래 표에서 `:root` 기본값은 Mignon이지만, 저장값이 없으면 스크립트가 `stark`를 붙이므로 실제 첫 화면은 Stark다.

| 토큰 | Mignon (기본 :root) | Stark (`:root[data-core="stark"]`) |
|---|---|---|
| `--magenta` / `--m-rgb` | `#EC1C9E` / `236,28,158` | `#38CCFF` / `56,204,255` |
| `--magenta-deep` | `#C70080` | `#0A7FC4` |
| `--yellow` (포인트) | `#FFE000` | `#FFB547` |
| `--ink` / `--ink-dim` / `--ink-faint` | `#f4e9f2` / `#b79ac2` / `#7d6b8c` | `#E4F5FF` / `#94B9CD` / `#5E7E91` |
| `--bg-core` / `--bg-mid` / `--bg-gate` | `#0b0410` / `#050208` / `#17091f` | `#04121d` / `#020810` / `#061a28` |
| `--on-accent` (강조색 위 글자) | `#f4e9f2` | `#021019` |

- 캔버스 색은 JS의 `PALS.stark` / `PALS.mignon`(main, deep, hot, acc, star, starAlt, label, labelHot, neb)에서 가져온다.
- 테마를 바꾸면 `applyTheme()` → `buildHud()`로 미리 그려 둔 레이어를 다시 그린다.

### HUD 코어 레이어 (영화 JARVIS 스타일)

기준 반지름은 `Rb = min(화면 너비, 높이) × 0.078`이다. 에너지(0~1.2)에 따라 `R = Rb × (0.94 + 0.12 × energy)`로 커지고, 부팅할 때 0.6배에서 시작한다. 링 합성은 `lighter`(빛 더하기)다.

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
| 글자 | ±3.62 | 아래는 상태(STANDBY/LISTENING/PROCESSING/RESPONDING), 위는 `JARVISCHAN · 000`(에너지 수치) |

- **깜빡임:** 매 프레임 밝기를 0.93~1 사이에서 흔들고, 237프레임마다 3프레임 동안 다이얼과 조각 링이 흐려진다(신호 끊김 효과).
- **회전 속도:** `(1 + energy × 1.4) × (처리 중이면 2.6)`. 각도는 `S.hudA/hudB/hudC/sweep`에 누적해서 속도가 바뀌어도 튀지 않는다.
- **움직임 줄이기** 설정을 켠 사용자에게는 회전과 깜빡임을 끄고 정지 화면으로 보여준다.
- 에이전트 구 반지름은 `min × 0.38`이다(전에는 0.34). HUD와 겹치지 않게 넓혔다.
- **성능:** 육각형과 다이얼만 크기 변경·테마 변경·폰트 로드 때 다시 그리고, 나머지는 매 프레임 그린다.

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

이 가이드가 있는 폴더에서 실행한다. `jarvischan-vercel/` 폴더가 만들어진다.

```bash
python3 - <<'EOF'
import re, pathlib, hashlib
md = pathlib.Path("JARVISCHAN_BUILD_GUIDE.md").read_text(encoding="utf-8")
# marker must start a line and the path has no spaces, so this script's own text never matches
files = re.findall(r"(?ms)^<!-- FILE: (\S+) sha256=([0-9a-f]{64}) -->\n````[a-z]*\n(.*?)\n````\n", md)
assert len(files) == 7, f"expected 7 files, found {len(files)}"
for path, digest, body in files:
    data = (body + "\n").encode("utf-8")
    ok = hashlib.sha256(data).hexdigest() == digest
    p = pathlib.Path("jarvischan-vercel") / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    print(("OK  " if ok else "BAD ") + str(p))
    assert ok, "checksum mismatch — the guide was altered"
EOF
```

### 5-2. 로컬 검증 (배포 전 필수)

```bash
cd jarvischan-vercel
node --check api/chat.js
node --check api/transcribe.js
python3 -c 'import re,subprocess,tempfile;h=open("index.html").read();f=tempfile.NamedTemporaryFile("w",suffix=".js",delete=False);f.write("\n".join(re.findall(r"<script>(.*?)</script>",h,re.S)));f.close();r=subprocess.run(["node","--check",f.name]);print("page script OK" if r.returncode==0 else "page script FAIL")'
```

도구 7개를 실제 API로 시험한다. Groq를 부르지 않아서 키가 필요 없다.

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

7개가 모두 `OK`여야 한다.

### 5-3. 배포

```bash
vercel whoami                                  # 로그인 확인
vercel deploy --prod --yes --name jarvischan-vercel
```

### 5-3b. GitHub 연동과 자동 배포 (2026-09-22에 설정 완료)

이 프로젝트는 GitHub과 연결돼 있어서 **`git push`만 해도 Vercel이 알아서 다시 배포한다.** `vercel deploy --prod --yes`도 여전히 되지만 굳이 쓸 필요는 없다.

- 저장소: `https://github.com/kheechan04/jarvischan`(2026-09-25부터 Public), 소유자 `kheechan04`
- Vercel 프로젝트 `khchan04/jarvischan-vercel`의 **Settings → Git**에서 이 저장소에 연결돼 있고, **Root Directory가 `jarvischan-vercel`**로 지정돼 있다. 저장소 루트에 가이드·README·LICENSE도 같이 있어서 이 설정이 꼭 필요하다.
- 새 Claude Code 세션에서 이어서 작업할 때: 코드 수정 → `git add` → `git commit` → `git push`로 끝난다. 수동으로 `vercel deploy`를 하지 않아도 보통 10초 안팎에 배포된다.
- 배포 확인은 `vercel ls`로 상태(`● Ready`)를 보거나, `curl`로 `https://jarvischan.vercel.app/`을 직접 확인한다.

⚠️ **처음 연결할 때 겪은 함정**(자세한 원인은 §6 표): Vercel 계정에 GitHub 로그인 연결 → GitHub에 Vercel 앱 설치(저장소 접근 권한) → Root Directory 설정이 모두 필요하고, **로컬 git의 커밋 작성자 이메일이 계정과 안 맞으면 배포가 `Deployment Blocked`로 조용히 멈춘다.** 이 저장소는 repo-local `git config user.email`을 GitHub 계정에 연결된 noreply 이메일(`280937297+kheechan04@users.noreply.github.com`)로 맞춰 둬서 정상 동작한다. 다른 컴퓨터에서 새로 클론해서 커밋하면 이 문제가 다시 생길 수 있으니 이메일부터 확인한다.

### 5-4. 환경변수 — 사용자가 직접

Groq 무료 키는 https://console.groq.com → API Keys에서 만든다(`gsk_…`).

터미널에서 사용자가 직접 실행하고, 값은 물어볼 때 붙여넣는다.

```bash
vercel env add GROQ_API_KEY production
```

```bash
vercel env add JARVIS_PASSWORD production
```

Vercel → 프로젝트 → Settings → Environment Variables에서 넣어도 된다. `GROQ_MODEL`은 넣지 않는 것을 권장한다(자동 선택).

⚠️ `JARVIS_PASSWORD`를 빼면 비밀번호 없이 누구나 무료 한도를 쓸 수 있다. 저장소가 공개라 비밀번호 확인 방식도 다 보이므로, 추측하기 어려운 값으로 정한다.

### 5-5. 다시 배포하고 확인

환경변수는 다시 배포해야 적용된다.

```bash
vercel deploy --prod --yes
curl -s -o /dev/null -w "page %{http_code}\n" https://<프로젝트>.vercel.app/
curl -s -w " api %{http_code}\n" -X POST -H "content-type: application/json" -d '{"messages":[{"role":"user","content":"hi"}]}' https://<프로젝트>.vercel.app/api/chat
```

- 페이지는 `200`, 비밀번호 없는 API 요청은 `401 {"error":"bad_password"}`가 나와야 한다.

### 5-6. 사용자 확인 (비밀번호가 필요해서 Claude는 할 수 없음)

Chrome에서 사이트를 열고 비밀번호를 넣은 뒤 한국어나 영어로 말한다.

| 말하기 | 기대 결과 |
|---|---|
| "what can you do?" | 기능 카드 8개 + 실제 기능만 말함. 왼쪽 로그에 `brain model openai/…` |
| "system check" | 5개 항목 모두 ✓ |
| "is the air bad today?" | PM2.5·PM10 카드 |
| "100 dollars in won" | 환율 카드 |
| "next holiday" | 공휴일 카드 |
| "timer 1 minute" | 주황 타이머 칩 → 1분 뒤 삐 소리와 음성 |
| "send an email to my team" | 아직 못 한다고 솔직하게 대답 |
| (한국어로) "오늘 미세먼지 어때?" | 한국어로 대답하고 한국어 목소리로 읽음. 로그에 `whisper ko` |
| (한국어로) "제주 날씨 어때?" | 제주시(대한민국) 날씨 카드 |

- 노란 문구가 뜨면 `Brain unreachable (Groq …)` 안의 내용을 확인한다.
- 서버 로그는 `vercel logs <배포 URL>`로 본다.

---

## 6. 알아둘 함정

| 증상 | 원인 | 해결 |
|---|---|---|
| `Groq 404 … llama-3.3-70b-versatile does not exist` | Groq에서 서비스가 종료된 것으로 보인다. 다른 프로젝트에서도 같은 404가 보고됐고, Groq 문서 일부에는 아직 남아 있다 | 모델 자동 선택 로직. 모델 이름을 고정하지 않는다 |
| 예전 기본 모델 `llama-3.1-8b-instant` | 2026-08-16 종료 | 대체 모델은 `openai/gpt-oss-20b` |
| gpt-oss 대답이 비어 있음 | 생각 과정 토큰이 한도를 다 쓴다 | `include_reasoning:false`, `reasoning_effort:"low"`, `max_completion_tokens:1200` |
| 환율 API 301 | `api.frankfurter.app` 주소가 바뀌었다 | `api.frankfurter.dev/v1`을 쓴다 |
| 위키 403 | User-Agent 헤더가 없다 | 헤더를 붙인다 |
| 뉴스 API가 배포 사이트에서 막힘 | NewsAPI.org 무료 플랜은 localhost 전용이고, 기사도 24시간 늦다 | 쓰지 않는다. 뉴스는 2단계 Groq 웹 검색으로(§7) |
| 두뇌가 끊겨도 "초안 쓸게요" | 옛 코드가 미리 적힌 가짜 답을 냈다 | `localBrain`은 솔직한 오프라인 안내만 한다 |
| 로컬 미리보기 서버가 404 | macOS 보호 폴더(Downloads 등)를 서버가 못 읽는다 | 보호되지 않는 임시 폴더로 복사해서 미리 본다 |
| `/.claude/launch.json`이 공개됨 | 프로젝트 폴더 전체가 배포된다 | 작업 파일은 프로젝트 밖에 두거나 `.vercelignore`에 추가한다 |
| "제주 날씨"가 에티오피아로 나옴 | 날씨 검색이 "Jeju"를 에티오피아로 찾고, 한글 "서울"·"제주"는 결과가 없다 | 한글 도시 이름 표 + 한국 도시는 `countryCode=KR` |
| 조용했는데 "시청해주셔서 감사합니다"가 입력됨 | Whisper가 조용한 녹음에서 문장을 지어낸다 | `no_speech_prob` 검사 + 환각 문구 걸러내기 |
| 한국어 대답이 어색한 목소리로 읽힘 | 컴퓨터에 좋은 한국어 음성이 없다 | Chrome의 "Google 한국의" 목소리를 권장한다 |
| 짧은 한국어를 영어로 잘못 알아들음 | 짧은 말은 언어 감지가 헷갈릴 수 있다 | Lang 메뉴를 한국어로 고정한다 |
| 박수 두 번 웨이크가 잘 안 잡힘 | 공유 analyser의 `fftSize=128`(≈2.7ms 창)을 26ms마다 폴링해서 대부분의 오디오를 놓친다. 게다가 `getUserMedia({audio:true})`가 기본으로 켜는 자동 게인·노이즈 억제가 박수 같은 순간적인 소리를 눌러 버린다 | 박수 감지 전용 스트림을 `autoGainControl:false, noiseSuppression:false, echoCancellation:false`로 따로 열고, 그 analyser의 `fftSize`를 2048(≈43ms)로 키워 폴링 공백을 없앴다. Whisper 녹음용 스트림은 그대로 둬서 받아쓰기 품질에는 영향이 없다 |
| 웨이크워드로 시작한 대화가 조용해져도 안 끝남 | "Jarvis"를 인식한 음성 인식 세션이 마이크를 완전히 놓기 전에 Whisper용 마이크를 새로 잡으려 했다. 그러면 화면에는 "녹음 중"으로 뜨지만 실제로는 오디오도 못 받고 종료 이벤트도 안 나는 상태로 멈춘다 | 웨이크워드 인식기가 진짜로 끝났다는 신호(`onend`, 보조로 400ms 타임아웃)를 받은 뒤에 Whisper 녹음을 시작하도록 순서를 바꿨다 |
| 조용한 방이 아니면 대화가 안 끝남(생활 소음이 계속 "말하는 중"으로 잡힘) | 무음 판정 기준(floor)을 녹음 시작 300ms에 한 번만 재고 끝까지 고정해서 썼다. 그 뒤 주변 소음이 그보다 커지면 계속 "말하는 중"으로 잘못 분류된다 | 3초마다 그 구간의 최저값으로 floor를 다시 잡는다. 실제 목소리는 단어·숨 사이에 틈이 있어서 걸리지 않고, 꾸준한 생활 소음만 흡수된다 |
| floor를 다시 잡아도 말이 끝난 뒤 녹음이 안 끝남 | 마이크 레벨을 analyser의 64개 주파수 빈 **전체**(초저음 웅웅거림부터 초고음 잡음까지)를 뭉뚱그려 평균 내서, 목소리와 배경 소음이 잘 구분되지 않았다 | 사람 목소리 대역(약 300Hz~3.4kHz)에 해당하는 빈만 골라 평균 내도록 바꿨다(`voiceLo`/`voiceHi`, `audioCtx.sampleRate`로 계산). 그 대역 밖 소음은 레벨 계산에서 빠진다 |
| 목소리 대역 필터 이후, 조용해졌는데도 녹음 종료까지 10초 가까이 걸림 | 빈을 8개 정도로 줄여 평균 내다 보니 측정값 하나하나가 들쭉날쭉해졌다. "조용함" 1.2초 연속 판정이 잡음 튐에 계속 리셋되다가 우연히 겨우 성공하는 패턴이 됐다 | VAD 판정에 쓰는 값만 지수이동평균(EMA, 가중치 0.45)으로 살짝 평활화했다. 화면 비주얼라이저용 `S.micLevel`은 그대로 둬서 시각 효과에는 영향이 없다 |
| 평활화 뒤에도 말이 끝난 뒤 정적이 계속 김 | 진폭(데시벨) 기준 VAD는 아무리 다듬어도 "말이 끝났다"를 소리 크기만으로 판단하는 방식 자체에 한계가 있다 | 브라우저 `SpeechRecognition`의 자체 음성 종료 감지(`onspeechend`)를 1차 신호로 쓴다. Whisper 녹음(MediaRecorder)과 별개로 글자는 쓰지 않는 보조 인식 세션을 하나 더 띄워서, `onspeechend`가 오면 바로 `stopWhisper()`한다. `onend`만으로는 멈추지 않는다(말을 시작하기도 전에 끊길 위험). 기존 진폭 VAD와 7초/20초 상한은 미지원 브라우저·실패 대비로 남겨 둔다 |
| 답변이 길면 음성이 중간에 소리 없이 끊김 | Chrome이 긴 `SpeechSynthesisUtterance`(대략 15초 이상)를 `onend`/`onerror` 없이 그냥 멈추는 오래된 버그가 있다 | 답변을 짧은 조각(최대 80자, 마침표 없는 긴 문장은 단어 단위로 강제 분할)으로 쪼개 차례로 `speak()`하는 큐 방식으로 바꿨다. 처음엔 180자였는데, 한국어는 글자당 발음 시간이 길어서 여전히 끊겨 80자로 줄였다 |
| 소리는 다 나왔는데 화면이 계속 RESPONDING에 멈춤 | 큐 방식으로 바꾼 뒤에도 마지막 조각의 `onend`가 가끔 아예 오지 않는다(Chrome 음성 이벤트의 신뢰성 문제) | 조각마다 글자 수로 예상한 재생 시간만큼 안전장치 타이머를 같이 걸어서, `onend`가 안 와도 다음 단계로 넘어가게 했다 |
| GitHub 연동 후 Vercel 배포가 `UNKNOWN` 상태로 몇 시간씩 안 끝남 | 처음엔 "Fix Git Configuration" 버튼만 보여서 원인을 알 수 없었다. CLI 배포와 git push 배포가 똑같이 막혔다. 실제 원인은 Vercel이 보낸 이메일로 알았다: 로컬 git의 커밋 작성자 이메일(`khchan04@naver.com`, 이 컴퓨터에 예전부터 전역 설정돼 있던 값)이 Vercel 팀의 어느 멤버와도 맞지 않아서 배포가 계속 보류됐다 | ① Vercel 계정에 GitHub 로그인 연결 ② GitHub에 Vercel 앱 설치(저장소 접근 권한, All repositories) ③ Vercel 프로젝트 Settings에서 **Root Directory 지정**(당시 `jarvis-vercel`, 지금은 `jarvischan-vercel`) ④ 이 저장소에 한해 `git config user.email`을 GitHub 계정에 연결된 noreply 이메일(`{id}+{username}@users.noreply.github.com`, id는 `gh api user`로 확인)로 맞춤. 넷 다 해야 풀린다 — 절차는 §5-3b |
| 노트북(크롬)에선 말이 끝나면 바로 끊기는데 폰·패드에선 자동 종료가 거의 안 됨 | iOS Safari는 `onspeechend`(바로 위 항목의 해결책)가 아예 없거나, 있어도 이벤트가 오지 않는다. 로그에는 `endpointer unavailable`/`no browser endpointer`만 찍힌다. 그래서 진폭 기준 VAD에 전부 의존하게 되는데, 모바일에서는 `getUserMedia`의 `autoGainControl`이 배경 소음까지 키워서 "조용한 방 = 거의 0"이라는 VAD의 전제가 깨져 있었다 | Whisper 녹음 스트림도 `autoGainControl:false`로 열어 원래 음량을 그대로 읽는다. iOS에서는 어차피 못 쓰는 보조 `onspeechend` 세션을 만들지 않아서 마이크 경합 위험도 없앴다 |
| 위 수정 후에도 아이패드에서 20초 상한까지 안 끊김(로그로 확인: floor가 0.1에 고정) | "조용함" 기준(floor)의 상한을 0.1로 박아 뒀다. 자동 게인이 켜져 있던 때는 조용한 방 음량이 늘 0.1 아래였지만, 끄고 나니 그 기기의 실제 주변 소음이 0.1보다 높아서 floor가 실제 값을 따라가지 못했다 | 상한을 0.7로 올렸다(안전장치일 뿐 목표값이 아니다) |
| floor 상한을 올렸는데도 말이 끝나고 15초 넘게 지나서야 끊김(로그: floor가 3초마다 목표치에 절반씩만 다가감) | 3초 구간마다 "이전 floor 절반 + 이번 구간 최솟값 절반"으로만 보정해서, 실제 주변 소음값에 닿는 데 여러 구간(수십 초)이 걸렸다 | 구간을 1.2초로 줄였다가 다시 0.7초로 줄이고(`6f0745c`), 절반씩 섞는 대신 그 구간 최솟값으로 바로 맞춘다. "조용함" 확정 대기 시간도 1.2초에서 0.8초로 줄여 체감 지연을 더 줄였다 |
| 웨이크워드 "자비스찬"을 또박또박 말해야만 인식되고, 켜 둔 지 좀 지나면 그마저도 잘 안 됨 | ① 정규식이 `자비스찬`/`jarvischan` 정확한 문자열만 찾았다. 사전에 없는 만든 이름이라 조금만 웅얼거려도 음성 인식이 비슷한 다른 음절로 받아 적으면 실패한다 ② 크롬의 연속(`continuous:true`) 인식 세션은 오래 켜 둘수록 인식 품질이 눈에 띄게 떨어진다(문서에 없는 특성) | 정규식을 구분하기 쉬운 핵심 부분(`자비스`/`jarvis`)만 찾도록 완화하고, `maxAlternatives:3`으로 1순위 말고 다른 후보들도 검사한다. 대기 세션은 15초마다 새 세션으로 교체한다 |
| 스크린샷을 찍으면 화면 일부만 잘려서 담김 | PowerShell 프로세스가 기본적으로 DPI를 인식하지 않아서, 배율이 100%보다 큰 디스플레이(요즘 노트북 대부분)에서 .NET이 실제 해상도 대신 축소된 "논리 해상도"로 캡처한다(실측: 2560×1600 화면이 1707×1067로 보임) | 캡처 스크립트 시작 때 `user32.dll`의 `SetProcessDPIAware()`를 호출한다. 여러 모니터를 다 담으려고 `PrimaryScreen.Bounds` 대신 `SystemInformation.VirtualScreen`을 쓴다 |
| (안전) 앱 닫기 명령이 저장 여부를 묻지 않고 바로 강제 종료함 | `taskkill /F`를 무조건 써서, 메모장·VS Code 등에 저장 안 한 내용이 있어도 그냥 날아갔다 | 기본은 `/F` 없이 정상 종료를 요청하고(앱이 저장 여부를 직접 물을 수 있게) 프로세스가 실제로 사라졌는지 확인한다. 강제 종료는 `force:true`를 명시적으로 받을 때만 하고, LLM은 사용자가 "강제로 꺼줘"라고 할 때만 그 값을 쓴다 |
| 로컬 에이전트를 테스트한 뒤 사용자가 켜 둔 에이전트까지 꺼져서 페이지의 Local agent 연결이 끊김 (2026-09-25) | 테스트용 에이전트를 끄면서 명령줄에 `agent.js`가 들어간 node 프로세스를 전부 종료했다. `start-agent.bat`로 켠 진짜 에이전트도 같은 이름이라 같이 꺼졌다 | 테스트는 `JARVIS_AGENT_PORT=8799 node agent.js`처럼 **다른 포트**로 띄우고, 끌 때는 그 프로세스만 **PID로** 종료한다. 이름 패턴으로 한꺼번에 종료하지 않는다. 끊겼으면 `start-agent.bat`를 다시 실행한다 |
| Git Bash에서 `vercel api /v9/projects/…`가 `Invalid arguments. Use an API path starting with /`로 실패 | Git Bash(MSYS)가 `/`로 시작하는 인자를 윈도우 경로(`C:/Program Files/Git/v9/…`)로 바꿔서 넘긴다 | 명령 앞에 `MSYS_NO_PATHCONV=1`을 붙인다. 팀 프로젝트라 `?teamId=<.vercel/project.json의 orgId>`도 필요하다 |

---

## 7. 다음 단계

| 단계 | 기능 | 필요한 것 |
|---|---|---|
| 2 | 웹 검색 결과 카드(`groq/compound-mini`). 한국어 음성 인식과 한국어 대답은 이미 완료 | 기존 `GROQ_API_KEY` |
| 3 | 오래 기억하기(Upstash Redis), 노션 저장·조회, 텔레그램 전송, 유튜브 성과 | 서비스별 무료 키 |
| 4 | 구글 캘린더, Gmail 요약, 인스타그램 인사이트 | OAuth 설정 |
| 5 | 노트북 앱 제어 — **2026-09-23 완료.** §9 참고 | 완료 |
| 6 | 로컬 에이전트 맥 포팅(지금은 윈도우 전용 셸 명령) | 실제로 맥을 쓰는 사람이 생기면 |
| 7 | 폰·패드에서 노트북을 원격 제어. 지금은 "localhost"가 각 기기 자신을 가리켜서 물리적으로 불가능하다. 노트북의 LAN IP로 붙거나(브라우저 mixed-content 정책 때문에 인증서 필요) 서버를 거쳐 중계하는 방식으로 다시 설계해야 한다 | 미정 |

⚠️ **3단계 전에 로그인 방식을 바꿔야 한다.** 지금은 공용 비밀번호 하나라서, 비밀번호를 아는 사람은 누구나 연결된 노션·메일에 접근할 수 있다. Vercel 로그인 보호를 켜거나 Google 로그인을 붙인다.

---

## 8. 현재 상태와 진행 기록

### 지금 상태 (2026-09-25)

- 배포: `https://jarvischan.vercel.app`, Vercel 프로젝트 `khchan04/jarvischan-vercel`(Root Directory `jarvischan-vercel`). `git push`하면 자동 배포된다(§5-3b).
- 저장소: `https://github.com/kheechan04/jarvischan`, Public, MIT 라이선스. README는 전부 한국어.
- 기능: 음성 대화(한국어·영어), 서버 도구 7개, 박수·웨이크워드로 깨우기, 로컬 에이전트(윈도우, 명령 9개), PWA 설치.
- 포트폴리오: https://kheechan04.github.io/jarvischan/
- 아래는 날짜순 진행 기록이다. 옛 주소나 옛 이름이 나오는 건 그때 기록이라서다.

### 첫 배포 (2026-09-16)

- 배포: `https://jarvis-vercel-beta.vercel.app`, Vercel 프로젝트 `jiwoo/jarvis-vercel`
- 서버 도구 7개: 실제 API로 시험 통과
- Groq 실패 대비와 모델 자동 선택: 가짜 Groq 응답으로 11가지 상황 시험 통과
- HUD와 테마: 로컬 미리보기에서 대기·처리 중·대답 중 화면 확인, 콘솔 에러 없음
- 한국어 지원: 음성 인식 서버 12가지 상황(가짜 Groq 응답), 한국어 대답 지시, 한글 도시 이름, 한국어 위키 시험 통과
- **남은 확인:** 실제 Groq 대화와 실제 한국어 음성 인식. 비밀번호가 필요해서 사용자가 확인해야 했다(§5-6)

### 업데이트 (2026-09-22)

- 배포: `https://jarvis-vercel-blush.vercel.app`, Vercel 프로젝트 `khchan04/jarvis-vercel`
- 실제 Groq 대화·한국어 음성 인식을 사용자가 확인했다(§5-6 통과).
- 박수 두 번 웨이크 감지를 개선했다. 원인과 해결은 §6 표에 있고, 배포본에서 다시 확인했다.
- 소스 저장소: `https://github.com/kheechan04/jarvis`(당시 Private)

### 업데이트 (2026-09-23) — 새 기능과 안정성 다지기

**배포 방식이 바뀌었다.** GitHub 연동을 마쳐서 이제 `git push`만 하면 자동 배포된다(§5-3b). 그날 겪은 "Vercel 배포가 계속 `UNKNOWN`으로 멈춤" 문제와 해결(Git 연동·GitHub 앱 설치·Root Directory·커밋 이메일)은 §6 표에 적었다.

**새 기능**
- **웨이크워드**: "Jarvischan" / "자비스찬"이라고 부르면 박수나 버튼 없이 대화를 시작한다. 브라우저 `SpeechRecognition`을 재사용하고, 대기 상태일 때만 동작한다.
- **이름 변경**: 앱 이름을 Jarvis → **Jarvischan(자비스찬)**으로 바꿨다. 탭 제목·헤더·웨이크워드·시스템 프롬프트까지 전부 바꿨고, 내부 저장 키·환경변수 이름은 건드리지 않았다.
- **대화 기억**: 탭이 열려 있는 동안 최근 약 10턴을 기억한다(서버·클라이언트 모두 `slice(-20)`). 더 늘리면 응답이 느려져서 절충한 값이다.

**안정성 수정** (원인과 해결은 모두 §6 표에 있다)
- 박수 웨이크 인식 개선(전용 스트림 + fftSize 확대)
- 웨이크워드 → Whisper 마이크 넘겨주기 경합 수정
- 무음 감지(VAD)를 세 번 개선한 끝에 브라우저 자체 `onspeechend`를 1차 신호로 바꿈 — 진폭 기준의 근본적 한계를 우회
- 긴 답변에서 TTS가 중간에 끊기는 Chrome 버그 우회(문장 큐 분할, 80자 단위, 안전장치 타이머)

**남은 확인:** 사용자가 최신 배포본에서 웨이크워드·무음 감지·TTS 안정성을 실제로 쓰면서 다시 확인하는 중이었다(§5-6). 문제가 다시 생기면 §6 표부터 본다.

### 업데이트 (2026-09-23b) — 모바일 안정화와 로컬 에이전트

**모바일(폰·패드)에서 다시 확인하다 나온 문제 3개를 모두 해결했다.** 노트북에선 문제없던 것이 아이패드로 테스트하니 드러났다. 증상·원인·해결은 전부 §6 표에 있고, 짧게 정리하면 이렇다.
1. iOS에는 `onspeechend`가 없어서 진폭 VAD에 전부 의존하는데, `autoGainControl`이 켜져 있어서 그 VAD가 제대로 동작하지 않았다 → 자동 게인을 껐다.
2. VAD의 "조용함" 기준 상한이 0.1로 박혀 있어서, 자동 게인을 끈 뒤의 실제 소음 수준(그보다 높음)을 따라가지 못했다 → 상한을 올렸다.
3. 기준 재보정이 3초 구간·절반씩 섞기라 너무 느렸다(15초 이상) → 짧은 구간(지금은 0.7초)·즉시 맞추기로 바꿨다.

**웨이크워드 인식률도 같이 손봤다.** 정규식을 핵심 음절만 찾도록 완화하고, 인식 후보를 3개까지 검사하고, 대기 세션을 15초마다 새로 바꾼다(§6 표).

**새 기능 — 로컬 에이전트(노트북 앱 제어)**: 자세한 내용은 §9. Vercel 서버는 클라우드 함수라 사용자 컴퓨터에 닿을 수 없다는 게 출발점이다. 그래서 노트북에서 따로 실행하는 작은 동반 프로그램(`local-agent/`)을 만들고, 웹 페이지가 `ws://localhost:8765`로 직접 붙어서 LLM의 도구 호출을 그쪽으로 중계하는 구조로 설계했다. 허용 목록 방식(앱 열기·닫기, URL·파일·폴더 열기, 파일 검색, 화면 잠금, 스크린샷, 클립보드, 볼륨)만 지원하고, 임의 명령 실행·삭제·종료/재시작은 일부러 뺐다.

**남은 확인:** 없음. 이번에는 전부 실제 기기(아이패드) 로그로 원인을 확인했고, 로컬 에이전트도 실제 명령을 실행해 결과를 확인한 뒤 배포했다.

### 업데이트 (2026-09-25) — 이름 정리(jarvis → jarvischan)와 공개

앱 이름은 이미 Jarvischan이었는데 저장소·프로젝트·폴더 이름에 옛 이름이 남아 있어서 한꺼번에 맞췄다.
- GitHub 저장소 `kheechan04/jarvis` → **`kheechan04/jarvischan`**(옛 주소는 GitHub이 자동으로 넘겨준다).
- Vercel 프로젝트 `jarvis-vercel` → **`jarvischan-vercel`**. 폴더도 `jarvischan-vercel/`로 바꾸고 Vercel의 **Root Directory도 `jarvischan-vercel`**로 바꿨다. **배포 주소도 `https://jarvischan.vercel.app`으로 바꿨다** — 프로젝트 도메인에 추가하고, 옛 주소 `https://jarvis-vercel-blush.vercel.app`은 새 주소로 308 리다이렉트한다. 로컬 에이전트 Origin 허용 목록에 새 주소를 추가했다(옛 주소도 남겨 둠). 브라우저 저장값(`localStorage`·`sessionStorage`)은 주소(origin)별이라, 새 주소에서 처음 열면 비밀번호와 에이전트 토큰을 한 번 다시 입력해야 한다.
- 이 가이드 파일 이름 `JARVIS_BUILD_GUIDE.md` → `JARVISCHAN_BUILD_GUIDE.md`. `package.json` 이름·README 문구·User-Agent·Whisper 힌트 문구·스크린샷 파일명도 jarvischan으로 바꿨다.
- 저장소 루트에 `Jarvischan 열기.html`을 추가했다. 더블클릭하면 `https://jarvischan.vercel.app`으로 바로 넘어가는 바로가기 페이지다(Vercel Root Directory 밖이라 배포되지 않는다).
- **사용자 확인 완료**: 새 주소에서 비밀번호·토큰을 다시 입력한 뒤 로컬 에이전트 연결이 정상이다. 서버 도구 7개가 실제 API 시험을 통과했고, 에이전트는 새 주소 인증과 잘못된 Origin·토큰 거부까지 확인했다.
- **PWA 추가**: `manifest.webmanifest` + `icons/` + `index.html` `<head>`에 manifest·theme-color·apple-touch-icon 링크. 크롬 주소창의 **설치** 버튼으로 앱을 설치하고, 아이폰·아이패드는 공유 → 홈 화면에 추가. service worker는 넣지 않았다 — 크롬이 더 이상 설치 조건으로 요구하지 않고, 캐시 때문에 배포 후 옛 화면이 뜨는 문제를 피하려고. 헤드리스 크롬 `Page.getInstallabilityErrors`로 설치 가능(오류 0개)을 확인했다.
- **이름에서 "Core" 제거**: 탭 제목·헤더(`JARVISCHAN·CORE` → `JARVISCHAN`)·HUD 링 위 글씨(`J.A.R.V.I.S · CORE 000` → `JARVISCHAN · 000`)·PWA 앱 이름·README·가이드 제목·User-Agent를 모두 그냥 **Jarvischan**으로 바꿨다. 부팅 문구 "core online"처럼 시스템 상태를 말하는 core와 `data-core`·`#core` 같은 내부 이름은 그대로 뒀다.
- **포트폴리오 페이지**: 이 프로젝트의 공개 기록은 `kheechan04/kheechan04.github.io` 저장소의 `jarvischan/`에 있다(https://kheechan04.github.io/jarvischan/, 상세는 `full.html`). 폴더를 `jarvis/`에서 옮겼고 옛 `/jarvis/` 주소는 없앴다. 저장소나 사이트 주소가 또 바뀌면 그 페이지의 "자료 출처" 표와 푸터 링크도 같이 고쳐야 한다.
- **PWA 설치 확인 완료**: 사용자가 크롬에서 직접 설치해서 `Chrome 앱\Jarvischan`으로 등록된 것을 확인했다(설치 가능 판정과 배포도 확인). 설치 전에 임시로 쓰던 바탕화면 바로가기(`chrome --app=…`)와 그 아이콘 `jarvischan.ico`는 PWA로 대체돼서 지웠다.
- **저장소 Public 전환 + MIT 라이선스**: 전환 전에 커밋 기록 전체에서 API 키·비밀번호·`.env`·에이전트 토큰이 한 번도 커밋되지 않았고 커밋 이메일이 noreply인 것을 확인했다. 비밀값은 계속 Vercel 환경변수에만 둔다 — 이제 커밋하면 바로 공개된다.
- **로그인창 placeholder**: `••••••••`(점 8개)가 비밀번호 길이 힌트처럼 보여서 `Enter password`라는 글자로 바꿨다. 입력할 때 찍히는 점은 브라우저 기본 동작이라 그대로 뒀다.
- **GitHub 첫 화면 정리**: 저장소 루트에 `README.md`(소개·폴더 구성·직접 배포하는 법)를 추가하고, `jarvischan-vercel/README.md`에 저장소째 가져오면 Root Directory를 `jarvischan-vercel`로 지정하라는 안내를 넣었다. 저장소 설명·토픽·홈페이지(`https://jarvischan.vercel.app`, 전에는 옛 blush 주소였다)도 설정했다. 포트폴리오 페이지의 저장소 표기도 `(private)`에서 공개·MIT로 바꾸고 링크를 달았다. 루트 README와 LICENSE는 Root Directory 밖이라 배포되지 않는다.
- **README 전부 한국어로**: 루트 README, `jarvischan-vercel/README.md`(부록도 동기화), `local-agent/README.md`를 한국어로 옮겼다. 명령 이름·파일 경로·화면에 뜨는 영어 버튼 이름(`Local agent`, `connecting…` 등)은 실제 화면과 맞추려고 그대로 뒀다.
- **가이드 정리**: 코드와 어긋난 내용(에이전트 도구 개수, 요청 필드 `lang`·`localAgent`, "못 하는 일" 목록 등)을 바로잡고, §8 맨 위에 지금 상태 요약을 넣었다. 문체는 다른 저장소(shadow-mitts)의 개발 문서와 같은 "~한다" 평서체로 통일했다. 그러면서 VAD 기준 재보정 간격이 문서·코드 주석에 1.2초로 남아 있던 것(실제로는 `6f0745c`부터 0.7초)도 바로잡았다.
- **일부러 안 바꾼 것**: `JARVIS_PASSWORD`·`JARVIS_AGENT_PORT` 환경변수, `x-jarvis-password` 헤더, `jarvis_*` 브라우저 저장 키(바꾸면 비밀번호 재입력·저장값 초기화가 생긴다), 웨이크워드 정규식 `/jarvis|자비스/`(핵심 음절만 찾아야 인식률이 나온다 — §6 표), 영화 속 JARVIS를 가리키는 주석.

---

## 9. 로컬 에이전트 — 노트북 앱 제어

### 왜 서버가 아니라 별도 프로그램인가

`api/chat.js`의 기존 도구(날씨·환율 등)는 전부 Vercel 서버에서 실행된다. 서버는 인터넷에 공개된 API만 부를 수 있는 **상태 없는 클라우드 함수**라서, 사용자의 노트북처럼 인터넷에 열려 있지 않은 개인 기기에는 닿을 방법이 없다. 그래서 "앱 열어줘" 같은 요청은 서버가 아니라 **사용자의 노트북에서 직접 실행되는 별도 프로그램**이 처리해야 한다. 이게 `local-agent/` 폴더가 있는 이유다.

### 구조

```
브라우저(index.html) ──ws://localhost:8765──▶ local-agent/agent.js ──▶ 실제 OS 명령
       ▲                                              │
       └──────────── 실행 결과 돌려주기 ◀──────────────┘
```

1. 사용자가 `local-agent/`에서 `npm start`(또는 `start-agent.bat` 더블클릭)로 에이전트를 실행하면, 처음 한 번 페어링 토큰이 만들어져 콘솔에 출력된다.
2. 브라우저에서 "Local agent" 버튼을 눌러 그 토큰을 입력하면 `ws://localhost:8765`로 웹소켓이 열린다. 크롬은 https 페이지에서 `localhost`로 연결하는 것을 mixed-content 정책의 예외로 허용해서 따로 인증서가 필요 없다.
3. LLM이 `open_app` 같은 도구를 호출하면, `api/chat.js`는 직접 실행하지 않고 `{type:"device", command:"open_app", args:{...}}` 형태의 액션만 만들어 브라우저로 돌려준다(타이머 도구와 같은 방식).
4. 브라우저는 그 액션을 웹소켓으로 에이전트에 전달하고, 에이전트가 실제로 실행한 뒤 결과(성공/실패)를 돌려준다. LLM의 음성 답변은 이 실제 결과가 나오기 *전에* 만들어지므로, 진짜 결과는 로그·배너·카드로 따로 보여준다.

### 보안 — 허용 목록, 페어링 토큰, Origin 검사

혼자 쓰는 개인 도구로 설계했고, 세 겹으로 제한한다.
- **허용 목록만 실행**: `open_app`/`close_app`은 `apps.json`에 등록된 앱만 다루고, 나머지 명령도 정해진 안전한 동작만 한다. 임의 셸 명령 실행은 없다.
- **일부러 안 넣은 것**: 컴퓨터 종료·재시작·절전, 파일 삭제·이동, 임의 프로세스 강제 종료, 포커스된 창에 글자 자동 입력. 음성 인식이 잘못 들었을 때 되돌리기 어렵거나 위험한 동작이라서, 넣으려면 별도 확인 절차부터 설계해야 한다.
- **페어링 토큰**: 에이전트를 처음 실행할 때 무작위로 만들어져 `~/.jarvischan-agent/token.txt`에 저장된다. 브라우저는 이 토큰 없이는 어떤 명령도 보낼 수 없다.
- **Origin 검사**: 배포된 Jarvischan 주소가 아닌 곳에서 오는 연결은 핸드셰이크 단계에서 거부한다. 허용 주소는 `agent.js`의 `ALLOWED_ORIGINS`(지금은 `jarvischan.vercel.app`, 옛 blush 주소, `localhost:3000`)라서, 다른 주소에 배포하면 거기에 추가해야 한다.

### 지원 명령 (9개)

| 명령 | 동작 | 비고 |
|---|---|---|
| `open_app` / `close_app` | `apps.json`에 등록된 앱 열기/닫기 | 닫기는 기본이 정상 종료(저장 확인 창을 존중), `force:true`일 때만 강제 종료. `explorer`는 바탕화면 셸이라 닫기가 항상 거부됨 |
| `open_url` | 기본 브라우저로 URL 열기 | `http(s)://`만 허용 |
| `open_path` | 파일/폴더 열기 | `desktop`/`downloads`/`documents`/`pictures`/`바탕화면`/`다운로드`/`문서` 같은 별칭 지원, 전체 경로도 가능 |
| `find_files` | 바탕화면·문서·다운로드에서 파일 이름 검색 | 읽기 전용, 최대 8개·깊이 5 |
| `lock_screen` | 화면 잠금 | |
| `take_screenshot`(에이전트 쪽 명령 이름은 `screenshot`) | 전체 화면을 캡처해 바탕화면에 저장 | DPI 처리로 고배율 디스플레이에서도 전체 캡처(§6 표) |
| `set_clipboard` | 클립보드에 글자 복사 | |
| `adjust_volume` | 볼륨 올리기/내리기/음소거 | 실제 볼륨 키를 누른 것처럼 동작 |

### 편의 기능

- `start-agent.bat`: 더블클릭으로 실행한다(터미널 명령을 몰라도 된다).
- `install-autostart.(ps1\|bat)` / `uninstall-autostart.(ps1\|bat)`: 윈도우 로그인 때 자동 실행되는 시작프로그램 바로가기를 추가/제거한다.
- 브라우저 쪽은 연결이 끊기면 5초 뒤 자동으로 다시 시도하고, 페이지를 다시 열면 저장된 토큰으로 자동 접속한다. 한 번 페어링하면 그 뒤로는 버튼을 누를 일이 거의 없다.

### 다른 사람이 쓰려면

같은 컴퓨터를 같이 쓰는 사람은 같은 토큰(`~/.jarvischan-agent/token.txt`)을 그대로 쓰면 된다. 자기 컴퓨터에서 쓰려는 사람은 `local-agent/` 폴더를 통째로 복사해서(zip 등으로 전달), Node.js를 설치하고 그 폴더에서 `npm install`을 한 번 한 뒤 `start-agent.bat`만 실행하면 된다. 각자 자기 컴퓨터의 에이전트에만 페어링되고, 서로의 컴퓨터는 건드릴 수 없다. 자세한 사용법은 `local-agent/README.md`. **지금은 윈도우 전용**(`start`/`explorer`/`taskkill`/`rundll32` 사용)이라 맥에선 포팅이 필요하다(§7 표).

### 업데이트 (2026-09-26) — 모바일 음성 출력과 링크 미리보기

- **폰·패드에서 답변 소리가 안 나던 문제**: 원인이 세 가지였다. (1) iOS Safari와 안드로이드 크롬은 `speechSynthesis`를 사용자 제스처 안에서 한 번 시작해야 이후 발화를 허용하는데, 답변은 `/api/chat` 응답을 기다린 뒤에 말해서 조용히 버려졌다. 첫 탭·키 입력 때 음량 0짜리 빈 발화를 한 번 보내서 엔진을 연다(`unlockAudio`). (2) Whisper 녹음이 끝나도 마이크 스트림을 닫지 않아서 기기가 통화 오디오 모드에 머물렀고, 출력이 수화기로 가거나 거의 안 들렸다. 녹음이 끝나면 `releaseMic()`으로 트랙과 `AudioContext`를 닫고 다음 탭에 다시 연다. (3) 박수 깨우기는 마이크를 계속 열어 두므로 발화 시작 때 닫고 발화가 끝나면 다시 연다. 웨이크워드 인식기는 원래 대기 상태가 아닐 때 멈추므로 따로 손대지 않았다. 처음에는 Safari 16.4+의 `navigator.audioSession`으로 세션 종류도 바꿨지만, 아이폰에서 오히려 소리와 마이크를 막아서 뒤에 뺐다(아래 "두 번째 진단 결과와 되돌림").
- **메신저 링크 미리보기**: Open Graph·`description`·`twitter:card`·canonical 태그가 없어서 카카오톡 등에서 링크 카드 없이 글자로만 보였다. `<head>`에 넣었고 주소는 `https://jarvischan.vercel.app` 절대 경로다. 직접 배포하는 사람은 자기 도메인으로 바꿔야 한다. 카카오톡은 미리보기를 캐시하므로 배포 후 https://developers.kakao.com/tool/clear/og 에서 캐시를 지워야 새 카드가 뜬다.
- **링크 옆 사이트 아이콘**: 메신저와 브라우저 상당수는 `<link rel="icon">`보다 루트의 `/favicon.ico`를 먼저 찾는데 이 파일이 없어서 404였다. `icon-512.png`로 `favicon.ico`(16·32·48px)와 `icons/icon-32.png`를 만들어 넣고 `<head>`에 연결했다.
- **폰 카카오톡에서 카드가 안 뜨던 문제**: 노트북(PC 카톡)에서는 카드가 떴지만 폰에서는 글자로만 보였다. 폰에서 카드가 잘 뜨는 shadow-mitts와 비교하면 미리보기 이미지가 512px 정사각 아이콘(`summary`)이었던 것이 달랐다. shadow-mitts와 같은 형식으로 1200×630 `og.png`를 새로 만들고(앱 아이콘 + 이름 + 한 줄 소개), `twitter:card`를 `summary_large_image`로, 제목·설명을 한국어로 바꾸고 `og:locale` `ko_KR`을 넣었다.
- **아이폰에서 대답 후 웨이크워드가 다시 안 켜지던 문제**: 소리 수정 뒤 아이폰 Safari에서 대답은 들리지만 그다음 "자비스"에 반응하지 않았다. 추정 원인은 두 가지다. (1) 대답이 끝나면 오디오 세션을 `playback`에서 `auto`로만 돌려서, iOS가 음성 인식을 다시 시작하지 못했다. (2) 재시작이 한 번 `not-allowed`로 실패하면 기존 코드가 웨이크워드를 아예 꺼 버렸다. 이제 웨이크워드나 박수 깨우기가 켜져 있으면 대답 직후 세션을 `play-and-record`로 되돌리고, 인식기를 시작하기 직전에도 `play-and-record`로 맞춘다. `not-allowed`는 한 번도 시작된 적이 없을 때만 진짜 차단으로 보고 끄며, 그 밖의 오류는 로그를 남기고 1.5초 뒤 다시 시도한다. **아이폰에서 확인해 보니 여전히 안 됐다**(첫 대화만 되고, 그 뒤로는 불러도 반응이 없고 마이크 표시도 안 뜸). 원인을 좁히려고 웨이크워드 인식기의 시작 시도(당시 오디오 세션 값)·`onstart`·`onaudiostart`·`onerror`(모든 오류)·`onend`·`start()` 예외를 전부 로그에 남기게 했다. 폰에서는 로그 패널이 기본으로 숨겨져 있으므로 `?debug=1`로 연다.
- **첫 진단 결과(아이폰 Safari)**: 새로 연 페이지에서 웨이크워드를 켜자 `start · session auto` → `listening` → `audio in`까지 찍히고 주소창 마이크 표시도 떴지만, 그 뒤로 "자비스찬"을 불러도 아무 로그가 없었다. 인식기는 켜져 있고 소리도 들어가는데 결과(`onresult`)가 안 오거나 정규식에 안 걸리는 것이다. 둘을 가르려고 인식기가 받아 적은 글자(바뀔 때마다 한 번)와 웨이크워드 감시기가 보는 화면 모드 변화도 로그에 남기게 했다.
- **두 번째 진단 결과와 되돌림**: 웨이크워드로 첫 질문은 녹음·인식·날씨 조회·`tts → 유나 (ko-KR)`까지 정상이고 소리 파형도 움직였지만 **소리가 다시 안 났다.** 대답 뒤에는 웨이크워드도, 마이크 버튼을 탭한 녹음도 말을 못 알아들었다. 처음 소리가 나게 고쳤을 때는 웨이크워드를 켜지 않았고, 그 뒤 추가한 `navigator.audioSession` 전환(`playback`↔`play-and-record`↔`auto`)이 공통 원인으로 보인다. 대화 중에 세션 종류를 바꾸면 iOS가 음성 출력을 묻고 마이크 녹음도 막는다. 그래서 `audioSession` 사용을 전부 뺐다. 또 `releaseMic()`이 `AudioContext`까지 닫아서, 다음 녹음 때 탭 밖에서 새 컨텍스트가 만들어지고 iOS에서 `suspended`로 남아 음량이 0으로 읽혔을 수 있다. 이제 컨텍스트와 분석기는 유지하고 스트림과 소스 노드만 바꾼다. 컨텍스트는 탭할 때마다 만들거나 깨우고, 탭 밖의 `resume()`은 300ms까지만 기다린다. 컨텍스트가 `running`이 아니면 로그에 남긴다.
- **연속 대화는 해결, 소리는 여전히 안 남**: 위 수정으로 아이폰에서 웨이크워드 연속 대화가 된다고 사용자가 확인했다. 하지만 대답 소리는 무음 모드가 아니고 귀에 대도 들리지 않았다. 소리가 났던 버전(`1ec3d74`)과의 남은 차이는 녹음 뒤 `AudioContext`를 닫느냐였다. 마이크 입력이 연결됐던 컨텍스트가 돌고 있으면 iOS 음성 합성이 아예 소리를 안 내는 것으로 보고, 대답하는 동안만 `audioCtx.suspend()`로 멈춘다. 다음 녹음 때 `startMicMeter()`가 마이크를 연 뒤 다시 깨운다. 닫지는 않으므로 연속 대화 쪽 수정은 그대로다. 오디오가 끊긴 뒤 iOS가 음성 엔진을 일시정지 상태로 남기는 경우에 대비해 `speechSynthesis.resume()`도 부르고, 첫 조각의 `onstart`(`tts started`)와 모든 `onerror` 코드를 로그에 남긴다.

---

## 부록 — 파일 원본

아래 블록은 배포본과 **바이트 단위로 같아요.** 손으로 옮기지 말고 §5-1 스크립트로 꺼내세요. 각 블록 위의 `sha256`은 파일 끝 줄바꿈 1개를 포함한 값이에요. **`icons/`의 PNG 5개와 `favicon.ico`·`og.png`도 바이너리라 부록에 없어요** — 저장소의 `jarvischan-vercel/`에서 그대로 쓰세요. **`local-agent/`는 이 부록에 포함되지 않아요** — 별도 프로그램이라 §5-1 추출 스크립트가 다루는 7개 파일 목록 밖에 있고, 원본은 저장소의 `local-agent/` 폴더에 직접 있어요.

| 파일 | 크기 | sha256 (앞 16자) |
|---|---|---|
| `index.html` | 110,968 bytes | `c441a921888002ed…` |
| `api/chat.js` | 31,344 bytes | `2d56f0ef5e63d567…` |
| `api/transcribe.js` | 5,170 bytes | `e035dfdf9da9a24b…` |
| `package.json` | 170 bytes | `36031ccc383c75bf…` |
| `README.md` | 5,085 bytes | `b38472b3eb09b40c…` |
| `manifest.webmanifest` | 568 bytes | `954673f909847f9b…` |
| `.env.example` | 291 bytes | `4dca9d87e66b0f3d…` |

### `index.html`

<!-- FILE: index.html sha256=c441a921888002ed45cb983d43a931a955b16b931ba3a79bbd8ab86f42261c22 -->
````html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Jarvischan</title>
<meta name="description" content="한국어나 영어로 말하면 목소리로 답하는 음성 비서. 날씨·대기질·환율·위키·타이머 같은 실제 도구를 쓰고, 내 컴퓨터의 앱도 열어요.">
<!-- Link previews: messengers (KakaoTalk, iMessage, Slack…) build the card from these.
     Image and page URLs must be absolute; self-deployers swap in their own domain. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Jarvischan">
<meta property="og:title" content="Jarvischan — 말하면 대답하는 음성 비서">
<meta property="og:description" content="한국어나 영어로 말하면 목소리로 답하는 음성 비서. 날씨·대기질·환율·위키·타이머 같은 실제 도구를 쓰고, 내 컴퓨터의 앱도 열어요.">
<meta property="og:url" content="https://jarvischan.vercel.app/">
<meta property="og:image" content="https://jarvischan.vercel.app/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://jarvischan.vercel.app/">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#020810">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Jarvischan">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
      <h1>JARVISCHAN</h1>
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
      <button class="wake-toggle" id="wakeword" aria-pressed="false" title="Say &quot;Jarvischan&quot; / &quot;자비스찬&quot; to start listening, hands-free">
        <span class="cdot" aria-hidden="true"></span>
        <span class="wwlbl">Say "Jarvischan" to wake · off</span>
      </button>
      <button class="wake-toggle" id="localagent" aria-pressed="false" title="Connect to the local agent so Jarvischan can open apps/files on this computer">
        <span class="cdot" aria-hidden="true"></span>
        <span class="lalbl">Local agent · off</span>
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
    <div class="stitle">Jarvischan · Access</div>
    <p class="snote">Enter the access password to bring the core online.</p>
    <label class="sfield"><span>Password</span>
      <input id="gateInput" type="password" placeholder="Enter password" autocomplete="current-password"></label>
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
  // ?debug=1 forces the telemetry log visible even on narrow screens (it's
  // hidden by default there to save space) — useful for reading mic/VAD
  // events live on a phone or tablet instead of needing devtools.
  try{ if(new URLSearchParams(location.search).get("debug")==="1") logEl.style.display="block"; }catch(e){}

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
    cx.fillText("JARVISCHAN · "+String(Math.round(energy*100)).padStart(3,"0"), CXp, CYp-R*3.62);
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
  let audioCtx=null, analyser=null, freqData=null, micStream=null, micSrc=null, rafMic=0, micError="";
  let voiceLo=1, voiceHi=8;   // frequency-bin range the level meter reads, set once the analyser is sized
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
        // autoGainControl off: mobile browsers apply it far more aggressively
        // than desktop, continuously renormalizing level so speech and silence
        // end up reading almost the same — which is exactly what breaks the
        // floor-tracking VAD below on phones/tablets. noiseSuppression and
        // echoCancellation stay on since those help Whisper transcription
        // instead of hurting it (see CLAP-TO-WAKE below for the contrast).
        micStream=await navigator.mediaDevices.getUserMedia({audio:{autoGainControl:false}});
        micError="";
      }
      if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(!analyser){
        analyser=audioCtx.createAnalyser();
        analyser.fftSize=128; analyser.smoothingTimeConstant=0.75;
        freqData=new Uint8Array(analyser.frequencyBinCount);
        // Averaging the whole spectrum (sub-bass hum up through hiss) blurs the
        // gap between "someone's talking" and "the room has background noise".
        // Restricting the level to roughly the voice band (300Hz–3.4kHz, where
        // most of speech's energy sits) gives a much cleaner silence read.
        const binHz=audioCtx.sampleRate/analyser.fftSize;
        voiceLo=Math.max(1,Math.round(300/binHz));
        voiceHi=Math.min(freqData.length-1,Math.round(3400/binHz));
        if(voiceHi<=voiceLo) voiceHi=Math.min(freqData.length-1,voiceLo+1);
      }
      // A new source per stream: releaseMic() stops the old tracks between turns.
      if(!micSrc){ micSrc=audioCtx.createMediaStreamSource(micStream); micSrc.connect(analyser); }
      // outside a tap iOS can leave resume() pending forever, so don't wait on it
      if(audioCtx.state==="suspended") await Promise.race([audioCtx.resume().catch(()=>{}), new Promise(r=>setTimeout(r,300))]);
      if(audioCtx.state!=="running") log("mic meter <span class='rt'>audio "+audioCtx.state+"</span>");
      const tick=()=>{
        if(!analyser) return;
        analyser.getByteFrequencyData(freqData);
        let sum=0; for(let i=voiceLo;i<=voiceHi;i++) sum+=freqData[i];
        S.micLevel=clamp((sum/(voiceHi-voiceLo+1))/140,0,1);
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
  // While a mic track stays live, iOS and Android keep the device in call-audio
  // mode: output is routed to the earpiece or ducked to near silence, so the
  // spoken reply can't be heard. Close the stream once the utterance is captured;
  // the next tap reopens it. The AudioContext is kept: iOS leaves a context
  // created outside a tap suspended, which would read the next recording as
  // silence, so only the stream and its source node are dropped.
  function releaseMic(){
    if(recorder && recorder.state==="recording") return;
    stopMicMeter();
    try{ micSrc && micSrc.disconnect(); }catch(e){}
    try{ micStream && micStream.getTracks().forEach(t=>t.stop()); }catch(e){}
    micStream=null; micSrc=null;
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
  // iPadOS reports as "Macintosh" in the UA string (desktop-class Safari), so it's only
  // distinguishable from real macOS by touch support.
  const isIOS = /iP(hone|od|ad)/.test(UA) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
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
  // iOS Safari and Android Chrome only let speechSynthesis talk once it has been
  // started from inside a user gesture. Replies are spoken after an await (the
  // /api/chat fetch), which is outside any gesture, so on phones and tablets they
  // were silently dropped. Speaking an empty utterance on the first tap unlocks
  // the engine for the rest of the page's life. The shared AudioContext (mic
  // meter, timer beep) is created and resumed on taps for the same reason: iOS
  // keeps a context suspended unless a tap starts it.
  // (navigator.audioSession was tried here too and made things worse on iPhone:
  // switching its type mid-conversation muted replies and blocked the mic after.)
  let ttsUnlocked=false;
  function unlockAudio(){
    try{
      if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==="suspended") audioCtx.resume();
    }catch(e){}
    if(ttsUnlocked || !("speechSynthesis" in window)) return;
    ttsUnlocked=true;
    try{ const u=new SpeechSynthesisUtterance(" "); u.volume=0; speechSynthesis.speak(u); }catch(e){}
  }
  ["pointerdown","touchend","keydown"].forEach(t=>window.addEventListener(t,unlockAudio,true));
  let speakTimer=0;
  function speak(text){
    if(!("speechSynthesis" in window) || !text){ setMode("idle"); return; }
    // Every mic has to be closed while replying, or the phone stays in call-audio
    // mode and the reply is inaudible. The wake-word recognizer already stops
    // itself whenever the core isn't idle; the clap listener's stream is closed
    // here and reopened in done() below.
    releaseMic();
    if(clapOn && clapStream) closeClapMic();
    // On iPhone a running AudioContext that has carried mic input keeps speech
    // synthesis silent (not just quiet, and not the earpiece). Closing it fixed
    // that but broke the next turn's level meter, so it is only suspended while
    // replying; startMicMeter() resumes it once the mic is live again.
    try{ if(audioCtx && audioCtx.state==="running") audioCtx.suspend(); }catch(e){}
    speechSynthesis.cancel();
    // iOS can also leave the engine paused after an audio interruption, with
    // speak() then queuing silently forever.
    try{ speechSynthesis.resume(); }catch(e){}
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
    const done=()=>{ clearInterval(speakTimer); S.speakLevel=0; setMode("idle");
      if(clapOn && !clapStream) startClapWake().then(ok=>{ if(!ok) log("clap-wake <span class='rt'>couldn't reopen mic</span>"); }); };
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
      u.onstart=()=>{ if(i===1) log("tts <span class='ok'>started</span>"); setMode("speaking");
        clearInterval(speakTimer);
        speakTimer=setInterval(()=>{ S.speakLevel=0.35+Math.random()*0.6; },90);
      };
      u.onboundary=()=>{ S.speakLevel=0.7+Math.random()*0.3; };
      u.onend=()=>{ if(!advanced){ advanced=true; clearTimeout(fallback); speakNext(); } };
      u.onerror=ev=>{ log("tts error <b>"+String(ev&&ev.error||"?").replace(/[<>&]/g,"")+"</b>");
        if(!advanced){ advanced=true; clearTimeout(fallback); done(); } };
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
      return {agent:null, body:/안녕|자비스찬|거기|있어/.test(text)
        ? "여기 있어요. 그런데 지금은 두뇌에 연결이 안 돼요. 날씨랑 시스템 점검은 계속 쓸 수 있어요."
        : "지금은 두뇌에 연결할 수 없어서 그건 아직 못 해요. 날씨랑 시스템 점검은 오프라인에서도 돼요."};
    if(/hello|hi |hey|are you there|jarvischan/.test(t))
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
      body:JSON.stringify({password:authPass, messages:messages, tz:userTZ, lang:langPref, localAgent:laConnected})
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
    (out.actions||[]).forEach(a=>{
      if(a && a.type==="timer" && a.seconds>0) startTimer(a.seconds, a.label);
      if(a && a.type==="device") runDeviceAction(a.command, a.args||{});
    });
    if(out.tools && out.tools.length)
      log('tools → <span class="rt">'+out.tools.join(", ").replace(/[<>&]/g,"")+"</span>");
  }

  // Relays a device action (open_app/open_url/open_path/find_files) to the
  // local agent and shows what actually happened — the spoken reply was
  // already generated before this runs (the server can't know the real
  // outcome, only that it dispatched the request), so this is the only place
  // that reports the true result back to the user.
  async function runDeviceAction(command, args){
    log('device → <span class="rt">'+String(command).replace(/[<>&]/g,"")+"</span> "+
      JSON.stringify(args).replace(/[<>&]/g,"").slice(0,120));
    const r=await localAgentSend(command, args);
    if(!r.ok){
      log('device <span style="color:var(--crit)">'+trim(r.error||"failed",80).replace(/[<>&]/g,"")+"</span>");
      banner.textContent = lastLang==="ko"
        ? "로컬 에이전트 명령 실패: "+(r.error||"알 수 없는 오류")
        : "Local agent action failed: "+(r.error||"unknown error");
      return;
    }
    log('device <span class="ok">'+trim(r.message||"done",80).replace(/[<>&]/g,"")+"</span>");
    if(command==="find_files" && Array.isArray(r.results)){
      showResults(lastLang==="ko"?"파일 검색 · "+args.query:"file search · "+args.query,
        r.results.map(p=>({title:p.split(/[\\\/]/).pop(), desc:p})));
    }
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
    const jvBody=bubble("Jarvischan","jv"); jvBody.textContent="…";

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
     Records one utterance, stops after ~0.8 s of silence (or on a second tap),
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
    let floorReady=false, winMin=1, winStart=0, sm=-1;
    recChunks=[];
    recorder.ondataavailable=e=>{ if(e.data && e.data.size) recChunks.push(e.data); };

    // Primary end-of-speech signal: the browser's own SpeechRecognition endpointer
    // (onspeechend) — a far better-tuned "has this person stopped talking" detector
    // than any amplitude threshold we could hand-roll. Its transcript is unused —
    // Whisper still does the real transcription — this instance exists only to
    // tell us when to stop recording. Only onspeechend is trusted: onend alone can
    // fire early on browsers that give up quickly when they don't recognize a wake
    // phrase, which would cut someone off before they'd even started talking. The
    // amplitude VAD above keeps running underneath as a fallback for browsers
    // without SpeechRecognition, or in case this endpointer never fires.
    //
    // Skipped entirely on iOS: it starts fine there but never fires onspeechend
    // OR onerror (confirmed live — neither log line below ever appears on an
    // iPad), so it's dead weight at best. At worst, iOS only grants one app
    // exclusive access to the mic input at a time, so a second recognition
    // session opening its own capture on top of the already-open recording
    // stream can starve the original stream's analyser — silently breaking the
    // amplitude VAD fallback too, which is the actual symptom reported (auto-stop
    // just doesn't happen on iPad, same before/after the autoGainControl fix).
    let endRec=null;
    if(SR && !isIOS){
      try{
        endRec=new SR();
        endRec.lang=srLang(); endRec.interimResults=false; endRec.continuous=false;
        endRec.onspeechend=()=>{ log("speech-end <span class='ok'>detected</span>"); stopWhisper("onspeechend"); };
        // Logged (not silently swallowed) because on phones/tablets this endpointer
        // is the flaky part — a second concurrent recognition session on top of the
        // already-open recording stream can error out or just never fire. When that
        // happens the amplitude VAD above is the only thing left stopping the
        // recording, so knowing it failed matters for diagnosing "doesn't stop" reports.
        endRec.onerror=(ev)=>{ log("speech-end <span style='color:var(--crit)'>endpointer error ("+(ev&&ev.error||"?")+")</span>"); };
        endRec.start();
      }catch(e){ endRec=null; log("speech-end <span style='color:var(--crit)'>endpointer unavailable</span>"); }
    } else {
      log("speech-end <span class='rt'>no browser endpointer — VAD only</span>");
    }

    recorder.onstop=()=>{
      clearInterval(vadIv);
      if(endRec){ try{ endRec.onspeechend=null; endRec.onerror=null; endRec.stop(); }catch(e){} endRec=null; }
      finishWhisper(mime, t0);
    };
    recorder.start(250);
    setMode("listening","Speak now — tap again to stop");
    log("mic <b>open</b> · whisper");
    // voice-activity detection on the analyser level, relative to the room's noise floor.
    // The floor isn't just a one-time snapshot: every ~0.7s it's re-anchored to the
    // quietest reading seen in that window. Real speech still has brief gaps (between
    // words, breaths) that read near-true-ambient, so this doesn't get fooled by
    // someone talking continuously — but steady background noise (traffic, AC hum),
    // which stays at roughly the same level the whole window, gets folded into the
    // floor so it stops being mistaken for "still talking" once the person goes quiet.
    vadIv=setInterval(()=>{
      const raw=S.micLevel, t=Date.now()-t0;
      // Reading only the voice-band bins (see startMicMeter) makes each single
      // reading noisier (fewer bins averaged), which kept re-triggering "still
      // loud" on stray spikes and made the quiet timer take many retries
      // to land — so the VAD works off a lightly smoothed level, not the raw one.
      sm = sm<0 ? raw : sm*0.55+raw*0.45;
      const lv=sm;
      if(t<300){ floorSum+=lv; floorN++; return; }
      // The 0.1 ceiling here used to be safe because autoGainControl kept a quiet
      // room's true ambient reading near zero on every device tested. With AGC off
      // (needed for the VAD to work at all on iOS — see startMicMeter) a raw,
      // unprocessed ambient level can legitimately sit well above 0.1 depending on
      // device/room — confirmed live on an iPad where it pinned at the 0.1 cap and
      // never let the "quiet" threshold become reachable, so recording only ever
      // ended on the 20s hard cap. Capped higher (0.7) purely as a sanity bound
      // against a runaway reading, not because ambient is expected to get there.
      if(!floorReady){ floor=Math.min(0.7, floorN?floorSum/floorN:0.04); floorReady=true; winStart=t; }
      if(lv<winMin) winMin=lv;
      // 700ms windows (first cut to 1.2s, then trimmed further to keep pace with a
      // laptop's browser endpointer), floor snapping straight to that window's minimum (no more
      // blending half the old floor in): confirmed live that blending made floor
      // climb toward a noisier-than-expected real ambient at half the gap per
      // 3s window, so on one iPad it took 5-6 windows (15s+) to become reachable
      // at all — recording sat there waiting long after the person had gone quiet.
      // A window this short still holds up against being fooled by a mid-word gap
      // reading as the new floor, since "heard" only fires on 3 consecutive
      // above-floor readings and "quiet" needs sustained silence — a lone dip
      // can't trip either on its own.
      if(t-winStart>700){
        floor=Math.min(0.7, winMin);
        winMin=1; winStart=t;
      }
      if(lv>floor+0.08){
        if(++loud>=3 && !heard){ heard=true; log("voice <span class='ok'>detected</span> (lvl "+lv.toFixed(3)+" · floor "+floor.toFixed(3)+")"); }
        quietSince=0;
      }
      else{
        loud=0;
        // 800ms, down from the original 1.2s: on iOS this quiet timer is the only
        // stop signal there is (no onspeechend), and the full 1.2s plus the time
        // for the floor above to converge was landing noticeably behind a
        // laptop's near-instant browser endpointer. Still long enough to not
        // trip on a mid-sentence breath.
        if(heard && lv<floor+0.035){ if(!quietSince) quietSince=t; else if(t-quietSince>800) stopWhisper("vad-quiet"); }
      }
      // Once-a-second raw level readout while debugging — cheap visibility into
      // whether the analyser is seeing any signal at all on a given device,
      // without flooding the log at the VAD's 100ms poll rate.
      if(t%1000<100) log("lvl "+lv.toFixed(3)+" · floor "+floor.toFixed(3)+" · heard "+(heard?"y":"n"));
      if(!heard && t>7000) stopWhisper("no-speech-7s");      // nothing said
      if(t>20000) stopWhisper("hard-cap-20s");               // hard cap keeps uploads small
    },100);
    return true;
  }
  function stopWhisper(reason){
    if(recorder && recorder.state==="recording"){
      log("stop → <b>"+(reason||"manual")+"</b>");
      try{ recorder.stop(); }catch(e){}
    }
  }

  async function finishWhisper(mime, t0){
    recorder=null; releaseMic();
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
    if(recorder && recorder.state==="recording"){ stopWhisper("manual-tap"); return; }
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
        Whisper recording stream now also disables autoGainControl for
        the same reason (see startMicMeter above), but keeps noise
        suppression and echo cancellation on since those help
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
     WAKE WORD — say "Jarvischan" (or "자비스찬") from anywhere in the
     room to start listening, no clap or button needed.

     Reuses the browser's own continuous speech recognizer (the same
     SR used as the Whisper fallback), so it costs nothing extra and
     works wherever that fallback already works. It only runs while
     the core is idle: a small watcher stops it the moment a real
     conversation starts and restarts it once back at idle, so it
     never mishears Jarvischan's own reply (which often contains the
     word "Jarvischan") as a fresh wake.
     ========================================================== */
  const wwBtn=$("wakeword"), wwLbl=wwBtn.querySelector(".wwlbl");
  // Matching just the "jarvis"/"자비스" core instead of the full invented name:
  // "자비스찬" has no dictionary entry, so Google's ASR often mishears the back
  // half ("찬" → "잔"/"한"/a dropped syllable) unless it's enunciated very
  // precisely — which was exactly the reported symptom. "자비스"/"jarvis" is
  // the distinctive, hard-to-confuse chunk and is vanishingly unlikely to show
  // up in normal conversation on its own, so loosening to it trades a little
  // precision for a lot of recall.
  const WAKE_RE=/\bjarvis\b|자비스/i;
  let wwLastMode="";
  let wwOn=false, wwRec=null, wwActive=false, wwWatch=0, wwStarted=0, wwEverStarted=false, wwRetryAt=0, wwLastHeard="";

  function stopWakeWordRec(){
    if(wwRec){ try{ wwRec.onresult=null; wwRec.onerror=null; wwRec.onend=null; wwRec.stop(); }catch(e){} }
    wwRec=null; wwActive=false;
  }
  function startWakeWordRec(){
    if(wwActive || !SR) return;
    wwRec=new SR();
    wwRec.continuous=true; wwRec.interimResults=true; wwRec.lang=srLang(); wwRec.maxAlternatives=3;
    wwRec.onresult=e=>{
      // Checking every alternative, not just the top guess: the #1 hypothesis
      // is often a real dictionary word that merely sounds similar, while the
      // wake word shows up a rank or two down.
      const alts=e.results[e.results.length-1];
      // debug: show what the recognizer actually heard, once per change
      const top=String((alts[0]&&alts[0].transcript)||"").trim();
      if(top && top!==wwLastHeard){ wwLastHeard=top;
        log("wake-word heard <b>\""+top.slice(-40).replace(/[<>&]/g,"")+"\"</b>"+(alts.isFinal?" · final":"")); }
      let said="";
      for(let i=0;i<alts.length;i++){ if(WAKE_RE.test(alts[i].transcript||"")){ said=alts[i].transcript; break; } }
      if(said){
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
    wwRec.onstart=()=>{ wwEverStarted=true; log("wake-word <span class='ok'>listening</span>"); };
    wwRec.onaudiostart=()=>{ log("wake-word <span class='ok'>audio in</span>"); };
    wwRec.onerror=err=>{
      // Only a refusal on the very first start means the mic is really blocked.
      // iOS Safari also reports not-allowed when a restart after a reply races
      // the audio session switching back, so once it has worked, just retry.
      if((err.error==="not-allowed" || err.error==="service-not-allowed") && !wwEverStarted){
        log("wake-word <span style='color:var(--crit)'>mic blocked</span>");
        turnWakeWordOff(); return;
      }
      log("wake-word error <b>"+String(err.error||"?").replace(/[<>&]/g,"")+"</b>");
      if(err.error!=="no-speech" && err.error!=="aborted"){
        log("wake-word <span class='rt'>"+String(err.error||"?").replace(/[<>&]/g,"")+" · retrying</span>");
        wwRetryAt=Date.now()+1500;
      }
      // the watcher below restarts it
    };
    wwRec.onend=()=>{ wwActive=false; log("wake-word <span class='rt'>ended</span>"); };
    log("wake-word start");
    try{ wwRec.start(); wwActive=true; wwStarted=Date.now(); }
    catch(e){ wwActive=false; wwRetryAt=Date.now()+1500; log("wake-word <span class='rt'>start threw "+String(e&&e.name||e).replace(/[<>&]/g,"")+" · retrying</span>"); }
  }
  function turnWakeWordOff(){
    wwOn=false; wwEverStarted=false; wwRetryAt=0; clearInterval(wwWatch); stopWakeWordRec();
    wwBtn.setAttribute("aria-pressed","false");
    wwLbl.textContent='Say "Jarvischan" to wake · off';
  }
  wwBtn.addEventListener("click", ()=>{
    if(wwOn){ turnWakeWordOff(); return; }
    if(!SR){ banner.textContent='This browser can\'t listen continuously for a wake word — try Chrome, or use Clap ×2.'; return; }
    if(clapOn){ clapOn=false; clearInterval(clapTimer); closeClapMic(); clapBtn.setAttribute("aria-pressed","false"); clapLbl.textContent="Clap ×2 to wake · off"; }
    wwOn=true;
    wwBtn.setAttribute("aria-pressed","true");
    wwLbl.textContent='Listening for "Jarvischan"';
    banner.textContent="";
    log("wake-word <span class='ok'>armed</span>");
    clearInterval(wwWatch);
    wwWatch=setInterval(()=>{
      if(!wwOn) return;
      const shouldListen = S.mode==="idle" && !recActive;
      // Chrome's continuous recognizer gets quietly less accurate the longer a
      // single session stays open — reported as "recognizes fine at first,
      // then stops picking it up." Cycling to a fresh session every 15s (well
      // under where that degradation was showing up) keeps it as sharp as it
      // was right after arming. stopWakeWordRec() clears wwActive immediately,
      // so the very next tick's startWakeWordRec() below picks it back up.
      if(shouldListen && wwActive && Date.now()-wwStarted>15000) stopWakeWordRec();
      if(shouldListen && !wwActive && Date.now()>=wwRetryAt) startWakeWordRec();
      if(S.mode!==wwLastMode){ wwLastMode=S.mode; log("wake-word sees mode <b>"+S.mode+"</b>"+(recActive?" · rec":"")); }
      if(!shouldListen && wwActive) stopWakeWordRec();
    },400);
    startWakeWordRec();
  });

  /* ==========================================================
     LOCAL AGENT — a small companion program the user runs on this
     computer (separate from this web page) that Jarvischan talks to
     over a plain WebSocket to open apps, URLs, files/folders, and
     search for files. The Vercel server can't do any of this itself —
     it's a stateless cloud function with no route to the user's own
     machine — so the browser connects straight to ws://localhost and
     the LLM's tool calls get relayed here instead of running server-side
     (see askBrain/handleTools below for the "device" action type).

     A pairing token (printed once by the agent on first run, pasted into
     this page and kept in localStorage) stops any other page or process
     from issuing commands to it — this is a personal single-user tool,
     not a hardened multi-tenant service.
     ========================================================== */
  const laBtn=$("localagent"), laLbl=laBtn.querySelector(".lalbl");
  const LA_URL="ws://localhost:8765";
  let laOn=false, laWS=null, laConnected=false, laPending=new Map(), laSeq=0, laReconnectTimer=0;
  let laToken=""; try{ laToken=localStorage.getItem("jarvis_agent_token")||""; }catch(e){}

  function setLocalAgentUI(){
    laBtn.setAttribute("aria-pressed", laConnected?"true":"false");
    laLbl.textContent = laConnected ? "Local agent · connected" : (laOn ? "Local agent · connecting…" : "Local agent · off");
  }
  function localAgentSend(command, args){
    return new Promise((resolve)=>{
      if(!laConnected || !laWS){ resolve({ok:false, error:"local agent not connected"}); return; }
      const id="c"+(++laSeq);
      laPending.set(id, resolve);
      // If the agent never answers (app hung, action stalled), don't leave
      // the caller hanging forever — resolve with a timeout error instead.
      setTimeout(()=>{ if(laPending.has(id)){ laPending.delete(id); resolve({ok:false, error:"timed out"}); } }, 8000);
      try{ laWS.send(JSON.stringify({type:"cmd", id, command, args})); }
      catch(e){ laPending.delete(id); resolve({ok:false, error:"send failed"}); }
    });
  }
  function connectLocalAgent(){
    if(!laToken){
      laToken=(prompt("Paste the pairing token shown by the local agent (printed once when you run it with npm start):")||"").trim();
      if(!laToken) return;
      try{ localStorage.setItem("jarvis_agent_token", laToken); }catch(e){}
    }
    try{ laWS=new WebSocket(LA_URL); }catch(e){ log("local agent <span style='color:var(--crit)'>can't connect</span>"); return; }
    laWS.onopen=()=>{ try{ laWS.send(JSON.stringify({type:"auth", token:laToken})); }catch(e){} };
    laWS.onmessage=(ev)=>{
      let msg; try{ msg=JSON.parse(ev.data); }catch(e){ return; }
      if(msg.type==="auth"){
        laConnected=!!msg.ok;
        log(laConnected ? "local agent <span class='ok'>paired</span>"
          : "local agent <span style='color:var(--crit)'>bad token — click again to re-enter it</span>");
        if(!laConnected){
          // Reset all the way to "off" instead of leaving laOn true with
          // nothing connected — otherwise the button gets stuck showing
          // "connecting…" forever, and re-entering a token needs an extra
          // click to turn it off first before a click can prompt again.
          try{ localStorage.removeItem("jarvis_agent_token"); }catch(e){} laToken="";
          laOn=false; try{ laWS.close(); }catch(e){} laWS=null;
        }
        setLocalAgentUI();
        return;
      }
      if(msg.type==="result" && laPending.has(msg.id)){
        laPending.get(msg.id)(msg); laPending.delete(msg.id);
      }
    };
    laWS.onerror=()=>{};
    laWS.onclose=()=>{
      laConnected=false; laWS=null; setLocalAgentUI();
      // laOn is only still true here for an *unexpected* drop (agent
      // restarted, laptop woke from sleep, brief network blip) — a
      // deliberate turn-off or a bad-token reset both already set it false
      // before closing. Keep retrying quietly in the background instead of
      // making the user notice and click the button again every time.
      if(laOn){
        log("local agent <span class='rt'>disconnected — retrying…</span>");
        clearTimeout(laReconnectTimer);
        laReconnectTimer=setTimeout(()=>{ if(laOn && !laConnected) connectLocalAgent(); }, 5000);
      }
    };
    setLocalAgentUI();
  }
  laBtn.addEventListener("click", ()=>{
    if(laOn){
      laOn=false; laConnected=false;
      clearTimeout(laReconnectTimer);
      if(laWS){ try{ laWS.close(); }catch(e){} laWS=null; }
      setLocalAgentUI();
      log("local agent <span class='rt'>off</span>");
      return;
    }
    laOn=true; setLocalAgentUI();
    connectLocalAgent();
  });
  // Reconnect automatically on page load if we already have a saved token
  // from a previous successful pairing — otherwise "hands-free" still meant
  // clicking a button and nothing else every single time the page opened.
  if(laToken){ laOn=true; setLocalAgentUI(); connectLocalAgent(); }

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

<!-- FILE: api/chat.js sha256=2d56f0ef5e63d567e961aac1422b78472c301c6bb3249a1e937ebf28221468fc -->
````js
// Vercel serverless function — Jarvischan brain proxy.
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
  "You are JARVISCHAN, the voice of a personal AI command center for a solo founder.",
  "Reply as JARVISCHAN: warm, crisp, confident, a touch cinematic — never robotic.",
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
  "WHAT YOU CANNOT DO YET: web search, reading or sending email, calendars, Notion, social media, long-term memory (you forget everything when the page reloads). Acting on the user's own computer (opening apps/URLs/files, searching for files) only works when a local agent line below says it is connected right now — otherwise say it needs that connected first.",
  "Never claim you did, queued, drafted, scheduled or saved something unless a tool result confirms it. If asked for something you cannot do, say so plainly in one sentence and offer the closest thing you can do.",
  "When asked what you can do, name three or four of the real abilities above in one or two sentences — never invent others.",
  "Use tool results as the only source for live facts. If a tool returns an error, say what failed in plain words.",
  "If the user gives no city, use Seoul. Use the current date and time given below for anything time-related.",
  "",
  'FORMAT: on the FIRST line output exactly "ROUTE: <AgentName>" choosing one of Strategist, Researcher, Chief of Staff, Finance, Editor, Memory, Design, Engineering, Calendar, Email, Social, Ops, Marketing, Sales, Developer (or "ROUTE: none"). This only lights a node on screen. Then a blank line, then the spoken reply.'
].join("\n");

const UA = "jarvischan/1.0 (personal voice assistant on Vercel)";
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

// Only offered when the browser reports its local agent is connected (see
// module.exports below) — these dispatch to that agent and run for real on
// the user's own computer, they don't execute here on the server.
const DEVICE_TOOLS = [
  fn("open_app", "Open an application on the user's computer by name.", {
    app: { type: "string", description: "Friendly app name from the user's allow-list, e.g. chrome, notepad, calculator, explorer, vscode, spotify" }
  }, ["app"]),
  fn("close_app", "Close/quit an application on the user's computer by name. Tries a normal close first, which lets the app prompt to save unsaved changes — set force only if the user explicitly says to force/kill it, since that skips any save prompt. Refuses explorer (the Windows desktop shell) and anything not in the allow-list.", {
    app: { type: "string", description: "Friendly app name, same set as open_app" },
    force: { type: "boolean", description: "true only if the user explicitly asked to force-close/kill it. Default false." }
  }, ["app"]),
  fn("open_url", "Open a URL in the default browser on the user's computer.", {
    url: { type: "string", description: "Full URL starting with http:// or https://" }
  }, ["url"]),
  fn("open_path", "Open a file or folder on the user's computer with its default app (a folder opens in File Explorer). Accepts a friendly folder name (desktop, downloads, documents, pictures) or an absolute path.", {
    path: { type: "string", description: "e.g. downloads, desktop, or an absolute path like C:\\Users\\me\\Documents\\report.docx" }
  }, ["path"]),
  fn("find_files", "Search the user's Desktop, Documents and Downloads folders for files whose name contains a query.", {
    query: { type: "string", description: "Filename substring to search for" }
  }, ["query"]),
  fn("lock_screen", "Lock the user's computer screen immediately.", {}, []),
  fn("take_screenshot", "Capture the user's screen and save it as a PNG to their Desktop.", {}, []),
  fn("set_clipboard", "Copy text to the user's clipboard so they can paste it elsewhere.", {
    text: { type: "string", description: "The text to copy" }
  }, ["text"]),
  fn("adjust_volume", "Change the user's system volume by simulating the hardware volume keys.", {
    direction: { type: "string", enum: ["up", "down", "mute"], description: "up, down, or mute (toggles mute)" },
    steps: { type: "integer", description: "How many key-presses, roughly 2% each. Default 5. Ignored for mute." }
  }, ["direction"])
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
  },

  // These four don't do anything here — the server has no route to the
  // user's own machine. They just hand the request to the browser as a
  // "device" action; handleTools()/runDeviceAction() there relay it to the
  // local agent over its own WebSocket and report what actually happened.
  async open_app({ app }) {
    const a = String(app || "").trim().slice(0, 40);
    if (!a) return { result: { error: "no app name given" } };
    return { result: { queued: true, app: a }, action: { type: "device", command: "open_app", args: { app: a } } };
  },

  async close_app({ app, force }) {
    const a = String(app || "").trim().slice(0, 40);
    if (!a) return { result: { error: "no app name given" } };
    return { result: { queued: true, app: a }, action: { type: "device", command: "close_app", args: { app: a, force: !!force } } };
  },

  async open_url({ url }) {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return { result: { error: "url must start with http:// or https://" } };
    return { result: { queued: true, url: u }, action: { type: "device", command: "open_url", args: { url: u.slice(0, 500) } } };
  },

  async open_path({ path }) {
    const p = String(path || "").trim().slice(0, 300);
    if (!p) return { result: { error: "no path given" } };
    return { result: { queued: true, path: p }, action: { type: "device", command: "open_path", args: { path: p } } };
  },

  async find_files({ query }) {
    const q = String(query || "").trim().slice(0, 100);
    if (!q) return { result: { error: "no search query given" } };
    return { result: { queued: true, query: q,
      note: "Results aren't known yet — they'll show up in the user's results panel. Don't invent filenames." },
      action: { type: "device", command: "find_files", args: { query: q } } };
  },

  async lock_screen() {
    return { result: { queued: true }, action: { type: "device", command: "lock_screen", args: {} } };
  },

  async take_screenshot() {
    return { result: { queued: true, note: "Saved to the user's Desktop once it completes." },
      action: { type: "device", command: "screenshot", args: {} } };
  },

  async set_clipboard({ text }) {
    const t = String(text == null ? "" : text).slice(0, 5000);
    if (!t) return { result: { error: "no text given" } };
    return { result: { queued: true }, action: { type: "device", command: "set_clipboard", args: { text: t } } };
  },

  async adjust_volume({ direction, steps }) {
    const d = String(direction || "").toLowerCase();
    if (!["up", "down", "mute"].includes(d)) return { result: { error: "direction must be up, down, or mute" } };
    const n = Math.max(1, Math.min(20, parseInt(steps, 10) || 5));
    return { result: { queued: true, direction: d, steps: n },
      action: { type: "device", command: "adjust_volume", args: { direction: d, steps: n } } };
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
  const localAgentOn = !!body.localAgent;
  const localAgentLine = "\n" + (localAgentOn
    ? "LOCAL AGENT: connected right now. open_app/open_url/open_path/find_files really run on the user's computer."
    : "LOCAL AGENT: not connected. Don't offer or call open_app/open_url/open_path/find_files — tell the user to connect it first if they ask for this.");
  const system = SYSTEM + "\n" + clockLine(body.tz) + langLine + localAgentLine;
  const messages = [{ role: "system", content: system }, ...history];
  const activeTools = localAgentOn ? TOOLS.concat(DEVICE_TOOLS) : TOOLS;
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
      if (!lastRound) { payload.tools = activeTools; payload.tool_choice = "auto"; }

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

<!-- FILE: api/transcribe.js sha256=e035dfdf9da9a24b7ed881ad5df4d9161d1866916c8f299543aa058dc0570cce -->
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
      fd.append("prompt", lang === "ko" ? "자비스찬에게 하는 짧은 음성 명령." : "A short voice command to Jarvischan.");
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

<!-- FILE: package.json sha256=36031ccc383c75bf345c63e6fc69e4c9fdc0a8f92f22f2fccefc311c830cde76 -->
````json
{
  "name": "jarvischan-voice",
  "version": "1.0.0",
  "private": true,
  "description": "Jarvischan voice command center — static page + Groq brain proxy (Vercel)"
}
````

### `README.md`

<!-- FILE: README.md sha256=b38472b3eb09b40ce582b2dde03235a7cd063ed7420d868e28667136ead844cb -->
````markdown
# Jarvischan (Vercel)

공개 주소에 배포할 수 있는 음성 중심의 "Jarvischan" 커맨드 센터예요.
말을 걸면 소리 내어 대답하고, 실시간 날씨와 검색 결과 같은 카드를 보여주고,
진짜 LLM 두뇌로 돌아가요 — 전부 Groq 무료 등급으로 **0원**이에요.
모르는 사람이 무료 사용량을 써버리지 못하게 **비밀번호**로 잠겨 있어요.

- **음성 입력·대답 + 박수 웨이크 + 웨이크워드** — "자비스찬" / "Jarvischan"이라고
  부르면 손 안 대고 듣기 시작하고, 박수를 두 번 치거나 마이크를 눌러도 돼요.
  https로 배포하면 매끄럽게 동작해요(마이크 권한을 한 번 허용하면 브라우저가
  기억해요).
- **두뇌** — Groq(무료, 빠른 오픈 모델). API 키는 서버에만 있어요.
- **날씨** — open-meteo로 실시간 조회(키 필요 없음).
- **내 컴퓨터 조작** — 선택 사항인 로컬 에이전트(아래 §5)를 켜면 앱·웹 주소·파일
  열기, 스크린샷, 볼륨 조절 같은 걸 할 수 있어요.
- 포함 안 된 것: 개인 캘린더·Gmail·Notion 연동(claude.ai 아티팩트 버전에서만
  동작해요).

## 1. 무료 Groq 키 받기 (카드 등록 없음)
1. https://console.groq.com 에 들어가서 로그인해요.
2. **API Keys → Create API Key** → 키를 복사해요(`gsk_...`로 시작해요).

## 2. Vercel에 배포하기

**방법 A — 드래그 앤 드롭 / Git (가장 쉬움)**
1. 이 폴더를 GitHub 저장소에 올려요(또는 Vercel의 "deploy folder"를 써요).
2. https://vercel.com → **Add New → Project** → 저장소를 가져와요(import).
3. Framework preset은 **Other**. 이 저장소를 통째로 가져왔다면 **Root
   Directory**를 `jarvischan-vercel`로 지정해요. 그리고 Deploy.

**방법 B — CLI**
```bash
npm i -g vercel
cd jarvischan-vercel
vercel        # 안내에 따라 진행
vercel --prod # 프로덕션에 배포
```

## 3. 환경변수 설정 (Vercel → Project → Settings → Environment Variables)
| 이름 | 값 |
| --- | --- |
| `GROQ_API_KEY` | 발급받은 `gsk_...` 키 |
| `JARVIS_PASSWORD` | 직접 정한 비밀번호 |
| `GROQ_MODEL` | *(선택)* `openai/gpt-oss-120b` 같은 모델로 고정. 비워두면 서버가 내 키로 쓸 수 있는 첫 번째 모델을 골라요(`api/chat.js`의 `PREFERRED`). |

넣은 다음에는 **다시 배포**해야(Deployments → ⋯ → Redeploy) 서버 함수가 값을 읽어요.

## 4. 사용하기
- `https://<프로젝트>.vercel.app` 주소를 열어요.
- 비밀번호를 한 번 입력해요.
- 마이크를 누르고(마이크 권한은 한 번만 허용) 한국어나 영어로 말해요 — Groq
  Whisper가 어느 언어인지 알아내고, Jarvischan도 같은 언어로 대답해요. **Lang**
  메뉴에서 한 언어로 고정할 수도 있어요.
- 이렇게 해보세요: *"뭐 할 수 있어?"*, *"시스템 점검"*, *"부산 날씨"*,
  *"오늘 미세먼지 어때?"*, *"100달러 원화로"*, *"샘 올트먼이 누구야?"*,
  *"다음 공휴일"*, *"기술 뉴스"*, *"25분 타이머 맞춰줘"*, 아니면 그냥 대화.
  영어로도 돼요: *"what can you do?"*, *"weather in Busan"*, *"timer 25 minutes"*.
- 두뇌는 서버에서 실제 도구를 불러요(`api/chat.js` → `IMPL`): Open-Meteo 날씨와
  대기질, Frankfurter(ECB) 환율, 위키백과, Nager.Date 공휴일, Hacker News,
  그리고 브라우저 타이머. 전부 키가 필요 없어요.
- **Clap ×2 to wake**를 켜면 박수 두 번으로, **Say "Jarvischan" to wake**를 켜면
  이름을 불러서 손 안 대고 듣기를 시작해요.

## 5. 선택: 내 컴퓨터 조작하기 (로컬 에이전트)

위의 도구는 전부 Vercel 서버에서 돌아가고, 서버는 공개 인터넷에만 닿을 수 있어요 —
*내* 컴퓨터의 앱을 열 방법이 없어요. 그래서 내 컴퓨터에서 따로 실행하는 작은
프로그램이 있어요:
[`../local-agent/README.md`](../local-agent/README.md)를 보세요. 실행하고
페어링하면(클릭 한 번, 토큰 붙여넣기 한 번) "크롬 열어줘", "스크린샷 찍어줘",
"화면 잠가줘"라고 했을 때 내 컴퓨터에서 실제로 그렇게 돼요. 지금은 윈도우 전용이에요.

## 참고
- **비용:** Vercel Hobby 무료, Groq 무료 등급 무료. 결제 수단을 연결하지 않아요.
- **한도:** 무료 모델은 분당·일당 한도가 있어요(혼자 쓰기엔 충분하지만, 널리
  공유하면 걸릴 수 있어요 — 걸려도 대답이 잠깐 멈출 뿐 요금은 안 나가요).
- 음성 입력은 Groq Whisper(`api/transcribe.js`)를 거쳐서, 녹음만 되면 어느
  브라우저에서든 동작해요. 크롬의 내장 음성 인식은 대체 수단이에요.
  한국어 대답은 한국어 목소리로 읽어요 — 크롬의 "Google 한국의"가 제일 자연스러워요.
- 에이전트 이름이나 말투는 `api/chat.js`(`SYSTEM` 프롬프트)와 `index.html`
  (`AGENTS` 배열)에서 내 방식대로 바꿀 수 있어요.
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

### `manifest.webmanifest`

<!-- FILE: manifest.webmanifest sha256=954673f909847f9bb5e835981ab6bd8fc75e42b10a263bbfd6a61841ec020e58 -->
````json
{
  "name": "Jarvischan",
  "short_name": "Jarvischan",
  "description": "Jarvischan voice command center",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#020810",
  "theme_color": "#020810",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
````
