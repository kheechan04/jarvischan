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
- **아이폰·아이패드:** 페이지를 연 뒤 처음 마이크·웨이크워드·박수 버튼을 누르면
  "네." 같은 짧은 확인 음성이 먼저 나오고 그다음에 마이크가 켜져요. iOS는 음성이
  마이크보다 먼저 한 번 재생돼야 이후 대답 소리가 나기 때문이에요. 처음 한 번만 나와요.
- **다른 주소로 배포할 때:** `index.html` `<head>`의 링크 미리보기 태그(`og:url`,
  `og:image`, `canonical`)가 `https://jarvischan.vercel.app`을 가리켜요. 내 주소로
  바꿔야 메신저에 공유했을 때 내 사이트의 카드가 떠요.
- 에이전트 이름이나 말투는 `api/chat.js`(`SYSTEM` 프롬프트)와 `index.html`
  (`AGENTS` 배열)에서 내 방식대로 바꿀 수 있어요.
