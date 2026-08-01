// 프롬프트 문자열을 태그 단위로 쪼갠다.

/**
 * NAI V4 가중치 묶음을 여는 `::` 앞에 오는 숫자. `1.5::` 는 묶음이지만
 * `artist2::` 는 아니므로, 숫자가 낱말로 떨어져 있을 때만 인정한다.
 */
const WEIGHT_HEAD = /(^|[^\w.])-?\d+(\.\d+)?$/;

/**
 * 쉼표로 태그를 나눈다. 단 NAI V4 의 `1.5::태그, 태그::` 가중치 묶음은
 * 통째로 한 덩어리로 둔다. 안쪽 쉼표까지 자르면 가중치가 깨진다.
 *
 * `::` 를 보이는 대로 묶음의 시작으로 삼으면 `artist::name` 같은 평범한 태그에서
 * 묶음이 열린 채 끝나 버려, 뒤에 오는 쉼표가 전부 무시되고 나머지가 한 덩어리가 된다.
 * 숫자 뒤에 오면서 닫는 `::` 가 실제로 있을 때만 묶음으로 친다.
 */
export function splitTags(text) {
  const source = String(text || '');
  const tags = [];
  let buffer = '';
  let inGroup = false;

  const flush = () => {
    // 줄바꿈과 이어진 공백은 한 칸으로 눌러 둔다. 그대로 두면 붙여넣었을 때 지저분하다.
    const tag = buffer.replace(/\s+/g, ' ').trim();
    if (tag) tags.push(tag);
    buffer = '';
  };

  for (let i = 0; i < source.length; i++) {
    if (source[i] === ':' && source[i + 1] === ':') {
      inGroup = inGroup
        ? false
        : WEIGHT_HEAD.test(buffer.trim()) && source.indexOf('::', i + 2) !== -1;
      buffer += '::';
      i++;
    } else if (source[i] === ',' && !inGroup) {
      flush();
    } else {
      buffer += source[i];
    }
  }
  flush();
  return tags;
}
