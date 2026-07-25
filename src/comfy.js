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

/** ComfyUI 노드 그래프인지 확인한다. */
export function isComfyGraph(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const nodes = Object.values(value);
  if (nodes.length === 0) return false;
  const typed = nodes.filter((n) => n && typeof n === 'object' && typeof n.class_type === 'string');
  return typed.length > 0 && typed.length >= nodes.length / 2;
}

/**
 * 입력값이 문자열이면 그대로, `[노드번호, 출력번호]` 링크면 그 노드까지 따라가 문자열을 찾는다.
 * seen 으로 순환 참조와 같은 노드 중복 수집을 막는다.
 */
function resolveText(graph, value, seen) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) return '';

  const nodeId = String(value[0]);
  if (seen.has(nodeId)) return '';
  seen.add(nodeId);

  const node = graph[nodeId];
  if (!node?.inputs || typeof node.inputs !== 'object') return '';

  const parts = [];
  for (const key of TEXT_KEYS) {
    if (!(key in node.inputs)) continue;
    const text = resolveText(graph, node.inputs[key], seen).trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (parts.length > 0) return parts.join(', ');

  // 알려진 입력 이름이 없으면 이름이 텍스트처럼 생긴 입력만 훑는다.
  // class_type 만 보고 아무 문자열이나 집으면 콤보 값(해상도, 파일명 등)이 딸려온다.
  for (const [key, input] of Object.entries(node.inputs)) {
    if (!TEXTY_KEY.test(key)) continue;
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

/** 샘플러를 못 찾았을 때 텍스트 인코드 노드를 제목으로 갈라 모은다. */
function collectEncoderTexts(graph) {
  const positive = [];
  const negative = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    if (!/CLIPTextEncode|TextEncode/i.test(node?.class_type ?? '')) continue;
    const text = cleanPrompt(resolveText(graph, [nodeId, 0], new Set()));
    if (!text) continue;
    (NEGATIVE_TITLE.test(node._meta?.title ?? '') ? negative : positive).push(text);
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

/**
 * ComfyUI 그래프를 다른 형식과 같은 평평한 사전으로 바꾼다.
 * @returns {object|null} 프롬프트를 찾지 못하면 null
 */
export function comfyToExifDict(graph) {
  let prompt = '';
  let negative = '';
  let sampler = null;

  for (const node of findSamplers(graph)) {
    const positiveText = cleanPrompt(resolveText(graph, node.inputs.positive, new Set()));
    const negativeText = cleanPrompt(resolveText(graph, node.inputs.negative, new Set()));
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

  if (sampler) {
    for (const [inputKey, optionKey] of Object.entries(SAMPLER_OPTIONS)) {
      const value = sampler.inputs[inputKey];
      if ((typeof value === 'string' || typeof value === 'number') && out[optionKey] === undefined) {
        out[optionKey] = value;
      }
    }
  }

  const model = findFirstInput(graph, MODEL_KEYS, (v) => typeof v === 'string' && v);
  if (model) out.model = model;

  // 크기와 배치는 빈 latent 노드가 들고 있다. 문자열로 넣는 노드도 있어서 함께 받는다.
  for (const node of Object.values(graph)) {
    const width = toNumber(node?.inputs?.width);
    const height = toNumber(node?.inputs?.height);
    if (width === null || height === null) continue;
    out.width = width;
    out.height = height;
    const batch = toNumber(node.inputs.batch_size);
    if (batch !== null) out.n_samples = batch;
    break;
  }

  return out;
}
