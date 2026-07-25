# NAI Tag Viewer Web

[DCP-arca/NAI-Tag-Viewer](https://github.com/DCP-arca/NAI-Tag-Viewer) 를 브라우저에서 그대로 쓸 수 있게 옮긴 웹앱입니다.
이미지를 올리면 프롬프트 · 네거티브 프롬프트 · 생성 옵션 · 기타 정보가 아래에 표시됩니다.

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
  - NAI v4 이후의 캐릭터별 프롬프트(`v4_prompt`)는 별도 카드로 표시
- **보기 방식**
  - 태그 단위로 쪼갠 칩 목록 (칩을 누르면 그 태그만 복사)
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

- Source 를 `GitHub Actions` 로 바꾸면 `.github/workflows/pages.yml` 이 푸시할 때마다 배포합니다.
- Actions 탭에서 `Deploy to GitHub Pages` 를 수동으로 돌릴 수도 있습니다.

주소는 `https://<사용자명>.github.io/<저장소명>/` 형태가 됩니다.
경로를 모두 상대 경로로 적어 두어서 하위 경로에 올려도 그대로 동작합니다.

## 로컬에서 실행하기

ES 모듈을 쓰기 때문에 `index.html` 을 파일로 직접 열면 브라우저가 막습니다. 간단한 정적 서버를 띄워 주세요.

```sh
npx http-server -p 8080 -c-1
# 또는
python3 -m http.server 8080
```

## 구조

```
index.html                 화면 구조
site.webmanifest           홈화면 추가용 정보
assets/style.css           스타일
assets/icon.svg            앱 아이콘 (파비콘 · 홈화면), PNG 는 여기서 뽑아낸 것
assets/icon-maskable.svg   안드로이드 마스크 대응 아이콘
src/app.js                 파일 입력 · 화면 그리기
src/png.js                 PNG 텍스트 청크 파서
src/exif.js                JPEG · WebP 의 EXIF / XMP 파서
src/stealth-pnginfo.js     Stealth PNG Info 디코더
src/nai-dict.js            메타데이터 → 프롬프트 / 옵션 / 기타 정리
src/prompt-converter.js    NAI → WebUI 가중치 변환
```

## 알려진 제약

- 웹페이지에서 끌어다 놓은 이미지는 그 사이트가 외부 접근(CORS)을 허용할 때만 읽을 수 있습니다. 막혀 있으면 파일로 저장한 뒤 올려 주세요.
- Stealth PNG Info 는 픽셀을 그대로 읽어야 해서 손실 압축(JPEG, 손실 WebP)된 이미지에서는 복원되지 않습니다.
- `DecompressionStream` 을 쓰므로 최신 브라우저(Chrome/Edge 80+, Firefox 113+, Safari 16.4+)가 필요합니다.

## 크레딧

- 원작 — [DCP-arca/NAI-Tag-Viewer](https://github.com/DCP-arca/NAI-Tag-Viewer)
- Stealth PNG Info 알고리즘 — [neggles/sd-webui-stealth-pnginfo](https://github.com/neggles/sd-webui-stealth-pnginfo)
