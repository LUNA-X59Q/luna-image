import { isPng, readPngTextChunks } from './png.js';
import { isJpeg, isWebp, readJpegMetadata, readWebpMetadata } from './exif.js';
import { getImageData, readStealthInfo } from './stealth-pnginfo.js';
import { getNaiDict, tryParseJson, RESULT } from './nai-dict.js';
import { splitTags } from './tags.js';

const $ = (id) => document.getElementById(id);

const el = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  placeholder: $('placeholder'),
  preview: $('preview'),
  previewImg: $('previewImg'),
  previewInfo: $('previewInfo'),
  status: $('status'),
  result: $('result'),
  sourceBadge: $('sourceBadge'),
  clearBtn: $('clearBtn'),
  cardPrompt: $('cardPrompt'),
  promptTags: $('promptTags'),
  promptRaw: $('promptRaw'),
  tagCount: $('tagCount'),
  cardChars: $('cardChars'),
  charList: $('charList'),
  charCount: $('charCount'),
  negativeTags: $('negativeTags'),
  negativeRaw: $('negativeRaw'),
  negCount: $('negCount'),
  cardNegative: $('cardNegative'),
  optionList: $('optionList'),
  cardOption: $('cardOption'),
  etcList: $('etcList'),
  cardEtc: $('cardEtc'),
  etcCount: $('etcCount'),
  rawText: $('rawText'),
  cardRaw: $('cardRaw'),
  toast: $('toast'),
};

const OPTION_LABELS = {
  steps: '스텝',
  width: '너비',
  height: '높이',
  size: '크기',
  scale: 'CFG 스케일',
  seed: '시드',
  sampler: '샘플러',
  schedule_type: '스케줄러',
  n_samples: '이미지 수',
  sm: 'SMEA',
  sm_dyn: 'SMEA DYN',
  clip_skip: 'CLIP Skip',
  model: '모델',
  model_hash: '모델 해시',
  denoising_strength: '디노이즈 강도',
};

const OPTION_ORDER = Object.keys(OPTION_LABELS);

// 원문이 이미지에 저장된 그대로라 먼저 보여주고, 태그 보기는 필요할 때 고른다.
const DEFAULT_VIEW = { prompt: 'raw', negative: 'raw', chars: 'raw' };

let current = { objectUrl: null, naiDict: null, raw: null, view: { ...DEFAULT_VIEW } };

// ── 메타데이터 추출 ────────────────────────────────────────

async function extractCandidates(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let info = {};
  let format = blob.type || '알 수 없는 형식';
  if (isPng(bytes)) {
    info = await readPngTextChunks(bytes);
    format = 'PNG';
  } else if (isWebp(bytes)) {
    info = readWebpMetadata(bytes);
    format = 'WebP';
  } else if (isJpeg(bytes)) {
    info = readJpegMetadata(bytes);
    format = 'JPEG';
  }

  // 숨겨진 정보는 픽셀에서 읽어야 하므로 캔버스를 거친다.
  let stealth = null;
  try {
    const text = await readStealthInfo(await getImageData(blob));
    if (text) {
      const parsed = tryParseJson(text);
      stealth = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : { parameters: text };
    }
  } catch (err) {
    console.warn('Stealth PNG Info 를 읽지 못했습니다:', err);
  }

  return {
    format,
    candidates: [
      { label: 'EXIF', info },
      { label: 'Stealth PNG Info', info: stealth },
    ],
  };
}

// ── 파일 불러오기 ──────────────────────────────────────────

async function loadBlob(blob, name) {
  if (!blob.type.startsWith('image/') && !/\.(png|webp|jpe?g)$/i.test(name || '')) {
    setStatus('이미지 파일이 아닙니다.', 'error');
    return;
  }

  setStatus('메타데이터를 읽는 중…');
  showPreview(blob, name);

  try {
    const { format, candidates } = await extractCandidates(blob);
    const result = getNaiDict(candidates);
    render(result, format);
  } catch (err) {
    console.error(err);
    setStatus(`이미지를 처리하지 못했습니다: ${err.message}`, 'error');
  }
}

function showPreview(blob, name) {
  if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
  current.objectUrl = URL.createObjectURL(blob);

  el.previewImg.src = current.objectUrl;
  el.previewImg.onload = () => {
    const { naturalWidth: w, naturalHeight: h } = el.previewImg;
    el.previewInfo.textContent = [name, `${w}×${h}`, formatBytes(blob.size)]
      .filter(Boolean)
      .join(' · ');
  };
  el.preview.hidden = false;
  el.placeholder.hidden = true;
}

async function loadFromUrl(url) {
  setStatus('이미지를 내려받는 중…');
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await loadBlob(blob, decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''));
  } catch (err) {
    setStatus(
      `이미지를 불러오지 못했습니다 (${err.message}). ` +
      '해당 사이트가 외부 접근을 막고 있을 수 있습니다. 파일로 저장한 뒤 올려보세요.',
      'error',
    );
  }
}

// ── 렌더링 ────────────────────────────────────────────────

function render(result, format) {
  const { naiDict, status, source, raw, notes } = result;
  current.naiDict = naiDict;
  current.raw = raw;

  if (status === RESULT.NONE) {
    el.result.hidden = true;
    setStatus(
      `${format} 이미지에서 메타데이터를 찾지 못했습니다. ` +
      '메타데이터가 제거되었거나 지원하지 않는 형식일 수 있습니다.',
      'warn',
    );
    return;
  }

  el.result.hidden = false;
  el.sourceBadge.textContent = `${format} · ${source}`;
  el.cardRaw.hidden = false;
  el.rawText.textContent = JSON.stringify(raw, null, 2);

  if (!naiDict) {
    setStatus(
      '프롬프트 형식을 알아보지 못했습니다. 아래 원본 메타데이터를 확인해 주세요.',
      'warn',
    );
    el.cardRaw.open = true;
    for (const card of [el.cardPrompt, el.cardChars, el.cardNegative, el.cardOption, el.cardEtc]) {
      card.hidden = true;
    }
    return;
  }

  // 한 파일에 생성 정보가 두 벌 들어있는 등, 보이는 값이 이 이미지의 것이 아닐 수
  // 있는 경우를 알린다. 조용히 하나만 고르면 프롬프트가 그림과 안 맞아도 알 수 없다.
  if (notes?.length) {
    setStatus(notes.join(' · '), 'warn');
    el.cardRaw.open = true;
  } else {
    setStatus('', null);
  }
  el.cardPrompt.hidden = false;
  el.cardNegative.hidden = false;
  renderText('prompt');
  renderText('negative');
  renderCharacters(naiDict.characters);

  const optionEntries = sortOptions(naiDict.option);
  el.cardOption.hidden = optionEntries.length === 0;
  renderKeyValues(el.optionList, optionEntries, (key) => OPTION_LABELS[key] || key);

  const etcEntries = Object.entries(naiDict.etc || {});
  el.cardEtc.hidden = etcEntries.length === 0;
  el.cardEtc.open = false;
  el.etcCount.textContent = etcEntries.length ? `${etcEntries.length}개` : '';
  renderKeyValues(el.etcList, etcEntries, (key) => key);
}

/** 프롬프트와 네거티브 프롬프트는 보기 방식이 같아서 한 곳에서 그린다. */
const TEXT_PANELS = {
  prompt: { source: (d) => d?.prompt, tags: 'promptTags', raw: 'promptRaw', count: 'tagCount', copy: 'prompt' },
  negative: { source: (d) => d?.negative_prompt, tags: 'negativeTags', raw: 'negativeRaw', count: 'negCount', copy: 'negative' },
};

/** 빈 태그와 줄바꿈을 걷어내 그림 생성기에 그대로 붙여넣을 수 있는 형태로 만든다. */
function tidyPrompt(text) {
  return splitTags(text).join(', ');
}

/**
 * 현재 보기 방식을 반영한 텍스트. 복사할 때도 이 값을 쓴다.
 * 태그 보기는 화면에 보이는 칩 그대로, 원문 보기는 손대지 않은 원본을 준다.
 */
function textForView(target) {
  return forView(TEXT_PANELS[target].source(current.naiDict), current.view[target]);
}

/** 보기 방식 하나에 텍스트 하나. 카드마다 같은 규칙을 쓴다. */
function forView(text, view) {
  return view === 'raw' ? (text || '') : tidyPrompt(text);
}

const COPY_HINTS = {
  tags: '줄바꿈과 빈 태그를 정리해 바로 쓸 수 있는 형태로 복사합니다',
  raw: '이미지에 저장된 원문 그대로 복사합니다',
};

function renderText(target) {
  const panel = TEXT_PANELS[target];
  const text = panel.source(current.naiDict) || '';
  el[panel.count].textContent = countLabel(text);

  const copyButton = document.querySelector(`[data-copy="${panel.copy}"]`);
  if (copyButton) copyButton.title = COPY_HINTS[current.view[target]];

  if (current.view[target] === 'tags') {
    el[panel.tags].hidden = false;
    el[panel.raw].hidden = true;
    renderTags(el[panel.tags], text, '(비어 있음)');
  } else {
    el[panel.tags].hidden = true;
    el[panel.raw].hidden = false;
    el[panel.raw].textContent = textForView(target) || '(비어 있음)';
  }
}

function renderCharacters(characters) {
  if (!characters || characters.length === 0) {
    el.cardChars.hidden = true;
    return;
  }
  el.cardChars.hidden = false;
  el.charCount.textContent = `${characters.length}명`;

  const copyButton = document.querySelector('[data-copy="chars"]');
  if (copyButton) copyButton.title = CHAR_COPY_HINTS[current.view.chars];

  el.charList.replaceChildren(
    ...characters.map((character, i) => {
      const box = document.createElement('div');
      box.className = 'charlist__item';

      const title = document.createElement('h3');
      title.textContent = `캐릭터 ${i + 1}`;
      box.append(
        sectionHead(title, charText(character.prompt), `캐릭터 ${i + 1} 프롬프트를 복사했습니다`),
        charBody(character.prompt, '(비어 있음)'),
      );

      if (character.negative_prompt) {
        const label = document.createElement('p');
        label.className = 'charlist__label';
        label.textContent = '네거티브';
        box.append(
          sectionHead(label, charText(character.negative_prompt), `캐릭터 ${i + 1} 네거티브를 복사했습니다`),
          charBody(character.negative_prompt, ''),
        );
      }
      return box;
    }),
  );
}

const CHAR_COPY_HINTS = {
  tags: '캐릭터별로 정리한 프롬프트를 이름표와 함께 복사합니다',
  raw: '캐릭터별로 원문 프롬프트를 이름표와 함께 복사합니다',
};

/** 캐릭터 프롬프트도 프롬프트 카드와 같은 보기 방식을 따른다. */
function charText(text) {
  return forView(text, current.view.chars);
}

/** 보기 방식에 맞는 본문. 태그 보기는 칩, 원문 보기는 저장된 그대로. */
function charBody(text, emptyLabel) {
  if (current.view.chars === 'tags') {
    const tags = document.createElement('div');
    tags.className = 'tags';
    renderTags(tags, text, emptyLabel);
    return tags;
  }
  const pre = document.createElement('pre');
  pre.className = 'pre';
  pre.textContent = (text || '').trim() || emptyLabel;
  return pre;
}

/** 제목과 복사 버튼을 한 줄로 묶는다. */
function sectionHead(titleNode, text, message) {
  const head = document.createElement('div');
  head.className = 'charlist__head';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--copy';
  button.textContent = '복사';
  button.addEventListener('click', () => copy(text, message));

  head.append(titleNode, button);
  return head;
}

function renderTags(container, text, emptyLabel) {
  const tags = splitTags(text);
  if (tags.length === 0) {
    container.replaceChildren();
    if (emptyLabel) {
      const empty = document.createElement('span');
      empty.className = 'tags__empty';
      empty.textContent = emptyLabel;
      container.append(empty);
    }
    return;
  }

  container.replaceChildren(
    ...tags.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag';
      chip.textContent = tag;
      chip.title = '클릭하면 이 태그만 복사합니다';
      chip.addEventListener('click', () => copy(tag, `"${tag}" 복사됨`));
      return chip;
    }),
  );
}

function sortOptions(option) {
  const entries = Object.entries(option || {});
  return entries.sort(([a], [b]) => {
    const ia = OPTION_ORDER.indexOf(a);
    const ib = OPTION_ORDER.indexOf(b);
    return (ia === -1 ? OPTION_ORDER.length : ia) - (ib === -1 ? OPTION_ORDER.length : ib);
  });
}

function renderKeyValues(container, entries, labelOf) {
  container.replaceChildren(
    ...entries.flatMap(([key, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = labelOf(key);
      dt.title = key;

      const dd = document.createElement('dd');
      dd.textContent = formatValue(value);
      dd.addEventListener('click', () => copy(dd.textContent, '값을 복사했습니다'));
      dd.title = '클릭하면 값을 복사합니다';
      return [dt, dd];
    }),
  );
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '켜짐' : '꺼짐';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function countLabel(text) {
  const count = splitTags(text).length;
  return count ? `${count}개` : '';
}

// ── 복사 · 알림 ───────────────────────────────────────────

const COPY_SOURCES = {
  prompt: () => textForView('prompt'),
  negative: () => textForView('negative'),
  // 태그만 이어 붙이면 어디까지가 누구 것인지 알 수 없어서 캐릭터마다 이름표를 붙인다.
  chars: () =>
    (current.naiDict?.characters || [])
      .map((character, i) => {
        const lines = [`캐릭터 ${i + 1}`, `프롬프트: ${charText(character.prompt)}`];
        const negative = charText(character.negative_prompt);
        if (negative) lines.push(`네거티브 프롬프트: ${negative}`);
        return lines.join('\n');
      })
      .join('\n\n'),
  option: () =>
    sortOptions(current.naiDict?.option)
      .map(([key, value]) => `${key}: ${formatValue(value)}`)
      .join('\n'),
  raw: () => el.rawText.textContent,
};

async function copy(text, message) {
  if (!text) {
    toast('복사할 내용이 없습니다');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('복사에 실패했습니다');
  }
}

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 1800);
}

function setStatus(message, kind) {
  el.status.textContent = message;
  el.status.hidden = !message;
  el.status.className = `status${kind ? ` status--${kind}` : ''}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function reset() {
  if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
  current = { objectUrl: null, naiDict: null, raw: null, view: current.view };
  el.previewImg.removeAttribute('src');
  el.preview.hidden = true;
  el.placeholder.hidden = false;
  el.result.hidden = true;
  el.fileInput.value = '';
  setStatus('', null);
}

// ── 이벤트 연결 ───────────────────────────────────────────

el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    el.fileInput.click();
  }
});
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (file) loadBlob(file, file.name);
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'dragend']) {
  document.addEventListener(type, (event) => {
    if (event.relatedTarget) return;
    el.dropzone.classList.remove('is-over');
  });
}

document.addEventListener('drop', (event) => {
  event.preventDefault();
  el.dropzone.classList.remove('is-over');

  const transfer = event.dataTransfer;
  const file = transfer?.files?.[0];
  if (file) {
    loadBlob(file, file.name);
    return;
  }

  // 웹페이지에서 끌어온 이미지는 파일 대신 주소로 전달된다.
  let url = transfer?.getData('text/uri-list') || transfer?.getData('text/plain') || '';
  if (!url) {
    const html = transfer?.getData('text/html') || '';
    url = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
  }
  if (url) loadFromUrl(url.split('\n')[0].trim());
});

document.addEventListener('paste', (event) => {
  const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) {
    event.preventDefault();
    loadBlob(file, file.name || '붙여넣은 이미지');
  }
});

el.clearBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  reset();
});

for (const button of document.querySelectorAll('.seg__btn')) {
  button.addEventListener('click', () => {
    const target = button.parentElement.dataset.target;
    current.view[target] = button.dataset.view;
    for (const sibling of button.parentElement.children) {
      sibling.classList.toggle('is-on', sibling === button);
    }
    if (!current.naiDict) return;
    if (target === 'chars') renderCharacters(current.naiDict.characters);
    else renderText(target);
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    copy(COPY_SOURCES[button.dataset.copy]?.(), '복사했습니다');
  });
}
