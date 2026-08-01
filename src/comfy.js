// ComfyUI 는 PNG 의 prompt 청크에 노드 그래프를 통째로 넣는다.
// 그래프를 따라가 실제 프롬프트 문자열과 주요 생성 옵션만 끄집어낸다.

/** 프롬프트 문자열이 들어있을 만한 입력 이름. 앞쪽이 우선한다. */
const TEXT_KEYS = [
  'text', 'text_g', 'text_l', 't5xxl', 'clip_l',
  'string', 'value', 'prompt', 'prompt_text', 'populated_text', 'wildcard_text',
];

/** 샘플러에서 가져올 옵션과 앱에서 쓰는 이름의 대응. */
const SAMPLER_OPTIONS = {
  steps: 'steps',
  cfg: 'scale',
  seed: 'seed',
  noise_seed: 'seed',
  sampler_name: 'sampler',
  scheduler: 'schedule_type',
  denoise: 'denoising_strength',
};

const MODEL_KEYS = ['ckpt_name', 'unet_name', 'model_name'];
const NEGATIVE_TITLE = /negative|네거티브|부정/i;
/** 입력 이름이 텍스트를 담을 법한가. */
const TEXTY_KEY = /text|string|prompt|caption|description/i;
/** 입력 이름에 붙은 극성 표시. `text_negative` 처럼 이름만으로 어느 쪽인지 알 수 있다. */
const NEGATIVE_KEY = /(^|[^a-z])(neg|negative|uc)([^a-z]|$)/i;
const POSITIVE_KEY = /(^|[^a-z])(pos|positive)([^a-z]|$)/i;

/** 생성 크기가 들어있는 입력 이름 짝. 앞쪽이 우선한다. */
const SIZE_KEY_PAIRS = [['image_width', 'image_height'], ['width', 'height']];
/** 불러온 참고 이미지의 크기는 생성 크기가 아니다. */
const INPUT_IMAGE_CLASS = /load\s*image|image\s*load/i;
const LATENT_CLASS = /latent|empty|resolution|size/i;
const SAMPLER_CLASS = /sampler/i;

/** ComfyUI 노드 그래프인지 확인한다. */
export function isComfyGraph(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const nodes = Object.values(value);
  if (nodes.length === 0) return false;
  const typed = nodes.filter((n) => n && typeof n === 'object' && typeof n.class_type === 'string');
  return typed.length > 0 && typed.length >= nodes.length / 2;
}

/** 프롬프트를 담고 있을 만한 입력 이름. 알려진 이름이 앞서고, 나머지는 이름 생김새로 고른다. */
function textInputKeys(inputs) {
  const known = TEXT_KEYS.filter((key) => key in inputs);
  const extra = Object.keys(inputs).filter((key) => !known.includes(key) && TEXTY_KEY.test(key));
  return { known, extra };
}

/**
 * 한 노드가 positive · negative 텍스트를 함께 들고 있으면 이름으로 갈라낸다.
 * 프롬프트 스타일러처럼 출력이 둘인 노드는 양쪽 링크가 같은 노드를 가리키는데,
 * 이걸 구분하지 않으면 네거티브 자리에 프롬프트가 그대로 실린다.
 */
function keysForPolarity(keys, polarity) {
  const wanted = polarity === 'negative' ? NEGATIVE_KEY : POSITIVE_KEY;
  const other = polarity === 'negative' ? POSITIVE_KEY : NEGATIVE_KEY;
  const matched = keys.filter((key) => wanted.test(key));
  if (matched.length > 0) return matched;
  // 반대쪽 이름이 붙은 입력은 건드리지 않는다. 극성이 없는 이름만 남긴다.
  return keys.filter((key) => !other.test(key));
}

/**
 * 입력값이 문자열이면 그대로, `[노드번호, 출력번호]` 링크면 그 노드까지 따라가 문자열을 찾는다.
 * polarity 는 지금 찾는 쪽이 프롬프트인지 네거티브인지다.
 * seen 으로 순환 참조와 같은 노드 중복 수집을 막는다.
 */
function resolveText(graph, value, seen, polarity) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return '';

  const nodeId = String(value[0]);
  if (seen.has(nodeId)) return '';
  seen.add(nodeId);

  const node = graph[nodeId];
  if (!node?.inputs || typeof node.inputs !== 'object') return '';

  const { known, extra } = textInputKeys(node.inputs);

  const parts = [];
  for (const key of keysForPolarity(known, polarity)) {
    const text = resolveText(graph, node.inputs[key], seen, polarity).trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (parts.length > 0) return parts.join(', ');

  // 알려진 입력 이름이 없으면 이름이 텍스트처럼 생긴 입력만 훑는다.
  // class_type 만 보고 아무 문자열이나 집으면 콤보 값(해상도, 파일명 등)이 딸려온다.
  for (const key of keysForPolarity(extra, polarity)) {
    const input = node.inputs[key];
    if (typeof input === 'string' && looksLikePrompt(input)) return input;
  }
  return '';
}

/**
 * 프롬프트로 보기 어려운 값을 걸러낸다.
 * 노드 입력에는 해상도나 체크포인트 이름 같은 콤보 값이 문자열로 들어있어서,
 * 이걸 거르지 않으면 프롬프트 자리에 "1280" 같은 값이 올라온다.
 */
function looksLikePrompt(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return false;                       // 1280, 4.5
  if (/^\d+\s*[x×*]\s*\d+/i.test(trimmed)) return false;                   // 1280x720
  if (/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|yaml)$/i.test(trimmed)) return false;
  if (/^(true|false|none|enable|disable|randomize|fixed|increment|decrement)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

/** 프롬프트로 쓸 수 있는 값만 남긴다. 아니면 빈 문자열. */
function cleanPrompt(text) {
  return looksLikePrompt(text) ? text.trim() : '';
}

/** positive · negative 조건 입력을 모두 가진 노드가 샘플러다. */
function findSamplers(graph) {
  return Object.values(graph).filter(
    (node) => node?.inputs && 'positive' in node.inputs && 'negative' in node.inputs,
  );
}

/**
 * positive · negative 로 이름 붙은 입력에서 링크를 거슬러 올라가며 노드에 극성을 표시한다.
 * 제목은 사용자가 붙이기 나름이라 비어 있는 일이 많으므로, 연결 관계를 먼저 본다.
 * 양쪽에서 함께 쓰이는 노드(체크포인트 로더 등)는 'both' 로 두어 판단에서 뺀다.
 */
function polarityMap(graph) {
  const map = new Map();

  const mark = (value, polarity, seen) => {
    if (!Array.isArray(value) || value.length === 0) return;
    const nodeId = String(value[0]);
    if (seen.has(nodeId)) return;
    seen.add(nodeId);

    const previous = map.get(nodeId);
    map.set(nodeId, previous && previous !== polarity ? 'both' : polarity);

    const node = graph[nodeId];
    if (!node?.inputs || typeof node.inputs !== 'object') return;
    for (const input of Object.values(node.inputs)) mark(input, polarity, seen);
  };

  for (const node of Object.values(graph)) {
    if (!node?.inputs || typeof node.inputs !== 'object') continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (NEGATIVE_KEY.test(key)) mark(value, 'negative', new Set());
      else if (POSITIVE_KEY.test(key)) mark(value, 'positive', new Set());
    }
  }

  return map;
}

/** 샘플러를 못 찾았을 때 텍스트 인코드 노드를 극성별로 갈라 모은다. */
function collectEncoderTexts(graph) {
  const linked = polarityMap(graph);
  const positive = [];
  const negative = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!/CLIPTextEncode|TextEncode/i.test(node?.class_type ?? '')) continue;

    const byLink = linked.get(nodeId);
    const polarity = byLink === 'positive' || byLink === 'negative'
      ? byLink
      : (NEGATIVE_TITLE.test(node._meta?.title ?? '') ? 'negative' : 'positive');

    const text = cleanPrompt(resolveText(graph, [nodeId, 0], new Set(), polarity));
    if (!text) continue;
    (polarity === 'negative' ? negative : positive).push(text);
  }

  return { prompt: positive.join(', '), negative: negative.join(', ') };
}

/** 숫자 또는 숫자 문자열이면 숫자로, 아니면 null. */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

function findFirstInput(graph, keys, predicate) {
  for (const node of Object.values(graph)) {
    if (!node?.inputs) continue;
    for (const key of keys) {
      const value = node.inputs[key];
      if (predicate(value)) return value;
    }
  }
  return undefined;
}

/** 값을 그대로 내보내는 중계 노드들이 쓰는 출력 이름. */
const SCALAR_KEYS = ['value', 'output_int', 'output_float', 'output', 'int', 'float', 'number'];

/** 숫자·문자열 입력을 읽는다. 링크면 중계 노드를 따라간다. */
function resolveScalar(graph, value, seen, ownKey) {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const nodeId = String(value[0]);
  if (seen.has(nodeId)) return undefined;
  seen.add(nodeId);

  const node = graph[nodeId];
  if (!node?.inputs) return undefined;

  for (const key of [ownKey, ...SCALAR_KEYS]) {
    if (!key || !(key in node.inputs)) continue;
    const resolved = resolveScalar(graph, node.inputs[key], seen, ownKey);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/**
 * 옵션을 채운다. 샘플러가 먼저고, 빠진 값은 그래프 전체에서 찾되
 * 샘플러처럼 생긴 노드를 우선한다. steps 를 별도 노드에 두는 워크플로가 많다.
 */
function fillOptions(graph, sampler, out) {
  const others = Object.values(graph).filter((node) => node !== sampler);
  const ordered = [
    ...(sampler ? [sampler] : []),
    ...others.filter((node) => SAMPLER_CLASS.test(node?.class_type ?? '')),
    ...others.filter((node) => !SAMPLER_CLASS.test(node?.class_type ?? '')),
  ];

  for (const node of ordered) {
    if (!node?.inputs) continue;
    for (const [inputKey, optionKey] of Object.entries(SAMPLER_OPTIONS)) {
      if (out[optionKey] !== undefined || !(inputKey in node.inputs)) continue;
      const value = resolveScalar(graph, node.inputs[inputKey], new Set(), inputKey);
      if (typeof value === 'number' || (typeof value === 'string' && value)) out[optionKey] = value;
    }
  }
}

/**
 * 생성 크기를 찾는다. 아무 노드나 집으면 참고용으로 불러온 입력 이미지의
 * 크기를 가져오게 되므로, 샘플러가 직접 들고 있는 값을 가장 먼저 본다.
 */
function readSize(graph, sampler) {
  const fromNode = (node) => {
    for (const [widthKey, heightKey] of SIZE_KEY_PAIRS) {
      const width = toNumber(resolveScalar(graph, node?.inputs?.[widthKey], new Set(), widthKey));
      const height = toNumber(resolveScalar(graph, node?.inputs?.[heightKey], new Set(), heightKey));
      if (width !== null && height !== null) {
        return { width, height, batch: toNumber(node.inputs.batch_size) };
      }
    }
    return null;
  };

  const nodes = Object.values(graph);
  const candidates = [
    ...(sampler ? [sampler] : []),
    ...nodes.filter((node) => LATENT_CLASS.test(node?.class_type ?? '')),
    ...nodes.filter((node) => !INPUT_IMAGE_CLASS.test(node?.class_type ?? '')),
  ];

  for (const node of candidates) {
    const size = fromNode(node);
    if (size) return size;
  }
  return null;
}

/**
 * ComfyUI 그래프를 다른 형식과 같은 평평한 사전으로 바꾼다.
 * @returns {object|null} 프롬프트를 찾지 못하면 null
 */
export function comfyToExifDict(graph) {
  let prompt = '';
  let negative = '';
  let sampler = null;

  for (const node of findSamplers(graph)) {
    const positiveText = cleanPrompt(resolveText(graph, node.inputs.positive, new Set(), 'positive'));
    const negativeText = cleanPrompt(resolveText(graph, node.inputs.negative, new Set(), 'negative'));
    if (positiveText || negativeText) {
      prompt = positiveText;
      negative = negativeText;
      sampler = node;
      break;
    }
  }

  if (!prompt && !negative) ({ prompt, negative } = collectEncoderTexts(graph));
  if (!prompt && !negative) return null;

  const out = { prompt, uc: negative };

  fillOptions(graph, sampler, out);

  const model = findFirstInput(graph, MODEL_KEYS, (v) => typeof v === 'string' && v);
  if (model) out.model = model;

  const size = readSize(graph, sampler);
  if (size) {
    out.width = size.width;
    out.height = size.height;
    if (size.batch !== null) out.n_samples = size.batch;
  }

  return out;
}
