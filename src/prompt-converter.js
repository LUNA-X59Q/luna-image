// NAI 스타일 프롬프트({}, [] 중첩 강조)를 WebUI 형식인 (태그:가중치) 로 변환한다.
// 원본 prompt_converter.py 의 이식본.

const SKIPPABLE = ' \t{}[]';

/** 쉼표로 토큰을 나누고 원본 문자열 기준 시작/끝(포함) 위치를 함께 돌려준다. */
function splitTokens(text) {
  const tokens = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ',') {
      const token = text.slice(start, i);
      if (token.trim()) tokens.push([token, start, i - 1]);
      start = i + 1;
    }
  }
  if (start < text.length) {
    const token = text.slice(start);
    if (token.trim()) tokens.push([token, start, text.length - 1]);
  }
  return tokens;
}

/** 토큰 안에서 공백과 괄호를 걷어낸 실제 단어의 시작/끝(포함) 위치. */
function findWordBounds(token, tokenOffset) {
  let left = 0;
  while (left < token.length && SKIPPABLE.includes(token[left])) left++;
  let right = token.length - 1;
  while (right >= 0 && SKIPPABLE.includes(token[right])) right--;
  if (left > right) return [tokenOffset, tokenOffset + token.length - 1];
  return [tokenOffset + left, tokenOffset + right];
}

/** pos 왼쪽으로 target 을 세되 stopper 를 만나면 멈춘다. */
function countBefore(text, pos, target, stopper) {
  let count = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === stopper) break;
    if (text[i] === target) count++;
  }
  return count;
}

/** pos 오른쪽으로 target 을 세되 stopper 를 만나면 멈춘다. */
function countAfter(text, pos, target, stopper) {
  let count = 0;
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] === stopper) break;
    if (text[i] === target) count++;
  }
  return count;
}

/**
 * @param {string} text NAI 프롬프트
 * @returns {string} WebUI 형식 프롬프트
 */
export function convertToWebui(text) {
  if (!text) return '';
  text = text.replace(/_/g, ' ');

  const tokens = splitTokens(text);
  const results = [];

  // 프롬프트 전체가 괄호로 감싸인 경우 바깥 괄호는 가중치에서 제외한다.
  const stripped = text.trim();
  const globalCurly = stripped.startsWith('{') && stripped.endsWith('}') ? 1 : 0;
  const globalSquare = stripped.startsWith('[') && stripped.endsWith(']') ? 1 : 0;

  for (const [token, tokenStart] of tokens) {
    const [wordStart, wordEnd] = findWordBounds(token, tokenStart);

    let positive = Math.max(
      countBefore(text, wordStart, '{', '}'),
      countAfter(text, wordEnd, '}', '{'),
    );
    if (globalCurly) positive = Math.max(positive - 1, 0);

    let negative = Math.max(
      countBefore(text, wordStart, '[', ']'),
      countAfter(text, wordEnd, ']', '['),
    );
    if (globalSquare) negative = Math.max(negative - 1, 0);

    const level = positive - negative;
    let weight = 1.0;
    for (let i = 0; i < Math.abs(level); i++) weight *= level > 0 ? 1.05 : 0.95;
    weight = Math.round((weight + 1e-8) * 100) / 100;

    const cleaned = token.replace(/[{}[\]]/g, '').trim();
    if (!cleaned) continue;
    results.push(Math.abs(weight - 1.0) < 1e-8 ? cleaned : `(${cleaned}:${weight.toFixed(2)})`);
  }

  return results.join(', ');
}
