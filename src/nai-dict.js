// 이미지에서 뽑아낸 원시 메타데이터를 프롬프트 / 네거티브 / 옵션 / 기타로 정리한다.
// 원본 NaiDictGetter.py 의 이식본.

import { comfyToExifDict, isComfyGraph } from './comfy.js';

export const TARGETKEY_NAIDICT_OPTION = [
  'steps', 'height', 'width',
  'scale', 'seed', 'sampler', 'n_samples', 'sm', 'sm_dyn',
  'cfg scale', 'cfg_scale', 'clip skip', 'clip_skip', 'schedule type', 'schedule_type',
  'size', 'model', 'model hash', 'model_hash', 'denoising strength', 'denoising_strength',
];

export const WEBUI_OPTION_MAPPING = {
  'cfg scale': 'scale',
  'cfg_scale': 'scale',
  'clip skip': 'clip_skip',
  'clip_skip': 'clip_skip',
  'schedule type': 'schedule_type',
  'schedule_type': 'schedule_type',
  'model hash': 'model_hash',
  'model_hash': 'model_hash',
  'denoising strength': 'denoising_strength',
  'denoising_strength': 'denoising_strength',
};

/** 추출 결과 상태값. 원본의 반환 코드와 같다. */
export const RESULT = {
  NONE: 0,        // 메타데이터 없음
  RAW_ONLY: 1,    // 문자열은 있으나 구조화 실패
  UNPARSED: 2,    // 사전 형태는 얻었으나 프롬프트 해석 실패
  PARSED: 3,      // 정상 해석
};

const OPTION_KEY_SET = new Set(TARGETKEY_NAIDICT_OPTION.map((k) => k.toLowerCase()));

const NEGATIVE_MARK = 'Negative prompt:';

/**
 * 옵션 줄의 `키: 값` 규칙. WebUI 가 쓰는 것과 같은 규칙이라
 * `Lora hashes: "a: 1, b: 2"` 처럼 따옴표 안에 든 쉼표도 갈라지지 않는다.
 */
const WEBUI_PARAM = /\s*(\w[\w \-/]+):\s*("(?:\\.|[^\\"])+"|[^,]*)(?:,|$)/g;

function readParams(line) {
  return [...line.matchAll(WEBUI_PARAM)];
}

/**
 * 마지막 줄이 옵션 줄인지 본다. 프롬프트에도 `(bad hands:1.2), (bad anatomy:1.3)` 처럼
 * 콜론이 들어가므로, 줄 첫머리부터 `키: 값` 으로 시작하면서 아는 옵션 이름을 하나는
 * 들고 있어야 옵션으로 인정한다.
 */
function isOptionLine(line) {
  const params = readParams(line);
  if (params.length === 0 || params[0].index !== 0) return false;

  const hasKnownKey = params.some(([, rawKey]) => {
    const key = rawKey.trim().toLowerCase();
    return OPTION_KEY_SET.has(WEBUI_OPTION_MAPPING[key] ?? key);
  });
  return hasKnownKey || params.length >= 3;
}

/** WebUI 의 `parameters` 문자열을 파싱한다. */
export function parseWebuiExif(parametersStr) {
  const lines = String(parametersStr).trim().split(/\r?\n/);

  // 옵션은 언제나 마지막 한 줄이다. 옵션 줄로 보이지 않으면 프롬프트로 돌려보낸다.
  // 이렇게 해야 여러 줄에 걸친 네거티브 프롬프트의 둘째 줄부터가 옵션으로 새지 않는다.
  let optionLine = lines.pop() ?? '';
  if (!isOptionLine(optionLine)) {
    lines.push(optionLine);
    optionLine = '';
  }

  // `Negative prompt:` 를 만난 뒤로는 옵션 줄 전까지 전부 네거티브 프롬프트다.
  const promptLines = [];
  const negativeLines = [];
  let target = promptLines;
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (line.startsWith(NEGATIVE_MARK)) {
      target = negativeLines;
      line = line.slice(NEGATIVE_MARK.length).trim();
    }
    target.push(line);
  }

  const prompt = promptLines.join('\n').trim();
  const negativePrompt = negativeLines.join('\n').trim();

  const options = {};
  const etc = {};

  for (const [, rawKey, rawValue] of readParams(optionLine)) {
    const key = rawKey.trim().toLowerCase();

    let text = rawValue.trim();
    if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
      text = tryParseJson(text) ?? text.slice(1, -1);
    }
    const num = Number(text);
    const value = text !== '' && Number.isFinite(num) ? num : text;

    const mapped = WEBUI_OPTION_MAPPING[key] ?? key;
    if (OPTION_KEY_SET.has(mapped.toLowerCase())) options[mapped] = value;
    else etc[mapped] = value;
  }

  // 프롬프트는 맨 뒤에 둔다. 옵션 줄에 같은 이름의 키가 있어도 덮어쓰지 못하게.
  return { ...options, ...etc, prompt, uc: negativePrompt, negative_prompt: negativePrompt };
}

/** 평평한 메타데이터 사전을 {prompt, negative_prompt, option, etc} 로 정리한다. */
export function buildNaiDict(exifDict) {
  if (!exifDict || typeof exifDict !== 'object') return null;

  const naiDict = {};
  naiDict.prompt = String(exifDict.prompt ?? '').trim();

  if (exifDict.uc != null) naiDict.negative_prompt = String(exifDict.uc).trim();
  else if (exifDict.negative_prompt != null) naiDict.negative_prompt = String(exifDict.negative_prompt).trim();
  else naiDict.negative_prompt = '';

  const option = {};
  for (const key of TARGETKEY_NAIDICT_OPTION) {
    if (exifDict[key] != null) option[key] = exifDict[key];
  }
  for (const [webuiKey, naiKey] of Object.entries(WEBUI_OPTION_MAPPING)) {
    if (exifDict[webuiKey] != null) option[naiKey] = exifDict[webuiKey];
  }
  naiDict.option = option;

  const excluded = new Set([
    ...TARGETKEY_NAIDICT_OPTION,
    ...Object.keys(WEBUI_OPTION_MAPPING),
    'prompt', 'uc', 'negative_prompt',
  ]);
  const etc = {};
  for (const key of Object.keys(exifDict)) {
    if (!excluded.has(key)) etc[key] = exifDict[key];
  }
  // NAI v4 이후의 캐릭터별 프롬프트는 v4_prompt 안에 들어있다.
  naiDict.characters = readCharacterPrompts(exifDict);
  // 전용 카드로 따로 보여주므로 기타 정보에서는 뺀다. 원본 JSON 에는 그대로 남는다.
  if (naiDict.characters.length > 0) {
    delete etc.v4_prompt;
    delete etc.v4_negative_prompt;
  }

  naiDict.etc = etc;

  return naiDict;
}

function readCharacterPrompts(exifDict) {
  const positives = exifDict?.v4_prompt?.caption?.char_captions;
  if (!Array.isArray(positives) || positives.length === 0) return [];
  const negatives = exifDict?.v4_negative_prompt?.caption?.char_captions ?? [];

  return positives
    .map((entry, i) => ({
      prompt: String(entry?.char_caption ?? '').trim(),
      negative_prompt: String(negatives[i]?.char_caption ?? '').trim(),
      centers: entry?.centers ?? null,
    }))
    .filter((character) => character.prompt || character.negative_prompt);
}

/**
 * 생성 결과를 이해하는 데 도움이 되지 않는 내부 플래그들.
 * 원본 JSON 에는 그대로 남으므로 필요하면 거기서 확인할 수 있다.
 */
const ETC_NOISE_KEYS = new Set([
  'signed_hash', 'stream', 'request_type', 'legacy_v3_extend',
  'deliberate_euler_ancestral_bug', 'prefer_brownian', 'cfg_sched_eligibility',
  'explike_fine_detail', 'minimize_sigma_inf', 'uncond_per_vibe',
  'wonky_vibe_correlation', 'extra_passthrough_testing',
  'skip_cfg_above_sigma', 'skip_cfg_below_sigma',
  'dynamic_thresholding_percentile', 'dynamic_thresholding_mimic_scale',
  'controlnet_strength', 'reference_information_extracted_multiple',
  'reference_strength_multiple', 'lora_unet_weights', 'lora_clip_weights',
]);
const ETC_NOISE_PREFIX = /^director_reference_/;

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** 기타 정보에서 내부 플래그, 빈 값, 프롬프트와 똑같은 값을 걷어낸다. */
function pruneEtc(naiDict) {
  const duplicates = new Set(
    [naiDict.prompt, naiDict.negative_prompt, ...naiDict.characters.map((c) => c.prompt)]
      .filter(Boolean),
  );

  const etc = {};
  for (const [key, value] of Object.entries(naiDict.etc ?? {})) {
    if (ETC_NOISE_KEYS.has(key) || ETC_NOISE_PREFIX.test(key)) continue;
    if (isEmptyValue(value)) continue;
    if (typeof value === 'string' && duplicates.has(value.trim())) continue;
    etc[key] = value;
  }
  naiDict.etc = etc;
  return naiDict;
}

function hasPrompt(naiDict) {
  return Boolean(naiDict && (naiDict.prompt || naiDict.negative_prompt || naiDict.characters?.length));
}

/** `Comment` 안의 JSON 을 쓰는 NAI 이미지인지 확인한다. */
function isNaiInfo(info) {
  return Boolean(info && typeof info === 'object' && info.Comment != null);
}

/** 평평한 사전으로 정규화. WebUI 는 `parameters`, NAI 는 `Comment` 를 쓴다. */
function toExifDict(info) {
  if (!info || typeof info !== 'object') return null;
  if (info.parameters != null) return parseWebuiExif(info.parameters);
  if (info.Comment != null) return null; // NAI 는 위쪽 경로에서 따로 처리한다
  if (info.UserComment != null) {
    const parsed = tryParseJson(info.UserComment);
    if (parsed && typeof parsed === 'object') return parsed;
    if (/^Negative prompt:/m.test(info.UserComment)) return parseWebuiExif(info.UserComment);
  }
  // ComfyUI 의 prompt 는 노드 그래프라 프롬프트 문자열로 쓰면 안 된다.
  // 위쪽 경로에서 못 읽어냈다면 원본 JSON 만 보여주는 편이 낫다.
  if (isComfyGraph(tryParseJson(info.prompt))) return null;
  return info;
}

export function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 메타데이터 후보들을 순서대로 시도해 가장 잘 해석된 결과를 돌려준다.
 * @param {Array<{label: string, info: object|null, raw?: string|null}>} candidates
 * @returns {{naiDict: object|null, status: number, source: string|null, raw: object|null}}
 */
export function getNaiDict(candidates) {
  const usable = candidates.filter((c) => c.info && Object.keys(c.info).length > 0);
  if (usable.length === 0) return { naiDict: null, status: RESULT.NONE, source: null, raw: null };

  // 1순위: NAI 방식 — Comment 키에 담긴 JSON
  for (const candidate of usable) {
    if (!isNaiInfo(candidate.info)) continue;
    const naiExif = tryParseJson(candidate.info.Comment);
    if (!naiExif || typeof naiExif !== 'object') continue;

    const naiDict = buildNaiDict(naiExif);
    if (hasPrompt(naiDict)) {
      // Comment 바깥의 Description·Software 같은 값도 기타 정보로 함께 보여준다.
      for (const [key, value] of Object.entries(candidate.info)) {
        if (key !== 'Comment' && !(key in naiDict.etc)) naiDict.etc[key] = value;
      }
      return { naiDict: pruneEtc(naiDict), status: RESULT.PARSED, source: candidate.label, raw: candidate.info };
    }
  }

  // 2순위: ComfyUI — prompt 키에 노드 그래프가 통째로 들어있다
  for (const candidate of usable) {
    const graph = tryParseJson(candidate.info.prompt);
    if (!isComfyGraph(graph)) continue;
    const exifDict = comfyToExifDict(graph);
    if (!exifDict) continue;

    const naiDict = buildNaiDict(exifDict);
    if (hasPrompt(naiDict)) {
      return {
        naiDict: pruneEtc(naiDict),
        status: RESULT.PARSED,
        source: `${candidate.label} · ComfyUI`,
        raw: candidate.info,
      };
    }
  }

  // 3순위: WebUI parameters 또는 평평한 사전
  for (const candidate of usable) {
    const exifDict = toExifDict(candidate.info);
    if (!exifDict) continue;
    const naiDict = buildNaiDict(exifDict);
    if (hasPrompt(naiDict)) {
      return { naiDict: pruneEtc(naiDict), status: RESULT.PARSED, source: candidate.label, raw: candidate.info };
    }
  }

  // 해석은 못 했지만 보여줄 원본은 있는 경우
  return { naiDict: null, status: RESULT.RAW_ONLY, source: usable[0].label, raw: usable[0].info };
}
