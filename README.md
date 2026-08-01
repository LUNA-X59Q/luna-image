# NAI Tag Viewer Web

이미지를 올리면 프롬프트 · 네거티브 프롬프트 · 생성 옵션 · 기타 정보가 아래에 표시되는 웹앱입니다.

빌드 도구나 서버가 필요 없는 정적 사이트라서 GitHub Pages 에 그대로 올릴 수 있고,
**이미지는 어디에도 전송되지 않습니다.** 파일을 읽고 해석하는 일은 전부 브라우저 안에서만 일어납니다.

## 기능

- **메타데이터 추출**
  - PNG 텍스트 청크 (`tEXt` · `zTXt` · `iTXt`)
  - Stealth PNG Info — 알파/RGB 채널 최하위 비트에 숨겨진 정보 (gzip 압축본 포함)
  - JPEG · WebP 의 EXIF (`UserComment`, `ImageDescription`, `Software` 등) 와 XMP
- **형식 자동 인식**
  - NovelAI 방식 — `Comment` 키에 들어있는 JSON
  - Stable Diffusion WebUI 방식 — `parameters` 문자열
  - ComfyUI 방식 — `prompt` 에 담긴 노드 그래프를 따라가 실제 프롬프트만 추출
  - NAI v4 이후의 캐릭터별 프롬프트(`v4_prompt`)는 별도 카드로 표시
- **보기 방식**
  - 태그 단위로 쪼갠 칩 목록 (칩을 누르면 그 태그만 복사). NAI V4 의 `1.5::태그, 태그::` 가중치 묶음은 쪼개지 않고 한 덩어리로 둡니다
  - 복사 결과는 보기 방식을 따라갑니다. **태그** 보기는 줄바꿈 · 빈 태그 · 중복 쉼표를 정리해 그림 생성기에 바로 붙여넣을 수 있는 형태로, **원문** 보기는 이미지에 저장된 그대로 복사합니다
  - 기타 정보에서는 내부 플래그와 빈 값, 프롬프트와 중복된 값을 걷어내고 접어 둡니다 (원본 JSON 에는 그대로 남습니다)
  - 원문 보기
  - **WebUI 변환** — NAI 의 `{}` · `[]` 중첩 강조를 `(태그:가중치)` 형식으로 변환
  - 원본 메타데이터 JSON 그대로 보기
- **불러오는 방법** — 클릭해서 선택 · 드래그 앤 드롭 · 웹페이지의 이미지를 그대로 끌어다 놓기 · <kbd>Ctrl</kbd>+<kbd>V</kbd> 붙여넣기
- 다크/라이트 테마 자동 전환, 모바일 대응

## GitHub Pages 로 게시하기

저장소 **Settings → Pages** 에서 둘 중 하나를 고르면 됩니다.

**1. 브랜치에서 바로 배포 (가장 간단)**

- Source 를 `Deploy from a branch` 로 두고, 브랜치와 `/ (root)` 를 선택합니다.
- 빌드 과정이 없으므로 푸시하면 몇십 초 안에 반영됩니다.

**2. GitHub Actions 로 배포**

- `.github/workflows/pages.yml` 이 `main` 에 푸시될 때마다 배포합니다.
- 설정에서 Pages 를 미리 켜두지 않아도 워크플로가 알아서 활성화합니다 (`configure-pages` 의 `enablement`).
- Actions 탭에서 `Deploy to GitHub Pages` 를 수동으로 돌릴 수도 있습니다.
- 배포는 기본 브랜치에서만 됩니다. `github-pages` 환경이 다른 브랜치의 배포를 막기 때문에, 작업 브랜치에서 돌리면 실패로만 남습니다.

주소는 `https://<사용자명>.github.io/<저장소명>/` 형태가 됩니다.
경로를 모두 상대 경로로 적어 두어서 하위 경로에 올려도 그대로 동작합니다.

## 로컬에서 실행하기

ES 모듈을 쓰기 때문에 `index.html` 을 파일로 직접 열면 브라우저가 막습니다. 간단한 정적 서버를 띄워 주세요.

```sh
npx http-server -p 8080 -c-1
# 또는
python3 -m http.server 8080
```

프롬프트 · 네거티브 분리와 태그 쪼개기는 의존성 없는 테스트로 지켜 둡니다.

```sh
node --test
```

## 구조

```
index.html                 화면 구조
site.webmanifest           홈화면 추가용 정보
assets/style.css           스타일
assets/icon.svg            앱 아이콘 (파비콘 · 홈화면), PNG 는 여기서 뽑아낸 것
assets/icon-maskable.svg   안드로이드 마스크 대응 아이콘
src/app.js                 파일 입력 · 화면 그리기
src/tags.js                프롬프트 문자열 → 태그 쪼개기
src/png.js                 PNG 텍스트 청크 파서
src/exif.js                JPEG · WebP 의 EXIF / XMP 파서
src/stealth-pnginfo.js     Stealth PNG Info 디코더
src/nai-dict.js            메타데이터 → 프롬프트 / 옵션 / 기타 정리
src/comfy.js               ComfyUI 노드 그래프에서 프롬프트 추출
src/prompt-converter.js    NAI → WebUI 가중치 변환
test/prompt-split.test.mjs 프롬프트 / 네거티브 분리 회귀 테스트
test/split-tags.test.mjs   태그 쪼개기 회귀 테스트
```

## 알려진 제약

- 웹페이지에서 끌어다 놓은 이미지는 그 사이트가 외부 접근(CORS)을 허용할 때만 읽을 수 있습니다. 막혀 있으면 파일로 저장한 뒤 올려 주세요.
- Stealth PNG Info 는 픽셀을 그대로 읽어야 해서 손실 압축(JPEG, 손실 WebP)된 이미지에서는 복원되지 않습니다.
- `DecompressionStream` 을 쓰므로 최신 브라우저(Chrome/Edge 80+, Firefox 113+, Safari 16.4+)가 필요합니다.

## 참고

메타데이터 해석 방식은 아래 프로젝트들을 참고했습니다.

- [DCP-arca/NAI-Tag-Viewer](https://github.com/DCP-arca/NAI-Tag-Viewer) — NAI · WebUI 메타데이터 해석과 프롬프트 가중치 변환
- [neggles/sd-webui-stealth-pnginfo](https://github.com/neggles/sd-webui-stealth-pnginfo) — Stealth PNG Info 알고리즘
