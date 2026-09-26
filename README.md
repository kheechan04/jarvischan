# Jarvischan

브라우저에서 돌아가는 영화 속 자비스 스타일의 음성 비서예요. 한국어나 영어로
말하면 소리 내어 대답하고, 실제 도구를 불러 쓰고, 선택 사항인 로컬 에이전트를
켜두면 내 컴퓨터의 앱까지 조작해요.

**실행 중인 사이트:** https://jarvischan.vercel.app (비밀번호로 보호됨) ·
**프로젝트 기록:** https://kheechan04.github.io/jarvischan/

## 할 수 있는 것

- **음성 입력과 음성 대답** — 마이크를 누르거나, 박수를 두 번 치거나,
  "자비스찬" / "Jarvischan"이라고 부르면 듣기 시작해요. 받아쓰기는 Groq
  Whisper가 한국어·영어를 알아서 구분하고, 대답도 같은 언어로 해요.
- **실제 도구** — 날씨와 미세먼지, 환율, 위키백과, 공휴일, 기술 뉴스 헤드라인,
  타이머. 모두 API 키 없이 동작해요.
- **로컬 에이전트 (선택, 윈도우 전용)** — 내 컴퓨터에서 앱·웹 주소·파일을
  열고 닫고, 스크린샷을 찍고, 볼륨을 바꾸고, 화면을 잠가요.
- **앱처럼 설치** — 크롬에서 PWA로 설치하거나 아이폰 홈 화면에 추가할 수 있어요.
  아이폰·아이패드 Safari에서도 음성 대화와 웨이크워드가 이어서 동작해요.
- **운영비 0원** — Vercel Hobby 플랜과 Groq 무료 등급만으로 돌아가요.

## 저장소 구성

| 경로 | 내용 |
| --- | --- |
| [`jarvischan-vercel/`](jarvischan-vercel/) | Vercel에 배포되는 웹앱. `index.html` 한 장과 서버 함수 두 개(`api/chat.js`, `api/transcribe.js`)가 전부예요. 빌드 과정도 npm 의존성도 없어요. |
| [`local-agent/`](local-agent/) | 웹 페이지가 내 컴퓨터를 조작할 수 있게 해주는 작은 Node.js 프로그램. localhost에서만 받고, 접속한 페이지 주소(Origin)를 확인하고, 페어링 토큰으로 인증하고, 허용 목록에 있는 명령만 실행해요. |
| [`JARVISCHAN_BUILD_GUIDE.md`](JARVISCHAN_BUILD_GUIDE.md) | 처음부터 만들어서 배포하는 전체 가이드. 모든 파일의 원본과 개발하면서 겪은 문제·해결이 들어 있어요. |

## 직접 배포하기

1. https://console.groq.com 에서 무료 Groq API 키를 발급받아요.
2. 이 저장소를 Vercel로 가져오고(import), **Root Directory**를
   `jarvischan-vercel`로 지정해요.
3. 환경변수 `GROQ_API_KEY`와 `JARVIS_PASSWORD`를 넣고 다시 배포해요.

자세한 내용은 [`jarvischan-vercel/README.md`](jarvischan-vercel/README.md)를,
로컬 에이전트 설정은 [`local-agent/README.md`](local-agent/README.md)를 참고하세요. 직접 배포한 주소에서 로컬 에이전트를 쓰려면 `local-agent/agent.js`의 `ALLOWED_ORIGINS`에 그 주소를 추가해야 해요. 메신저 링크 미리보기도 `jarvischan-vercel/index.html`의 `og:url`·`og:image`·`canonical`을 내 주소로 바꿔야 제대로 떠요.

## 라이선스

[MIT](LICENSE)
