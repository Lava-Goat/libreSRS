// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
const MAX_PATTERN_LENGTH = 200;
const BACKREFERENCE_REGEX = /\\[1-9]|\\k<|\\k'|\\g/;

function isQuantifier(pattern: string, index: number): { isQuantifier: boolean; length: number } {
  const char = pattern[index];
  if (char === '*' || char === '+' || char === '?') {
    return { isQuantifier: true, length: 1 };
  }
  if (char === '{') {
    const match = pattern.slice(index).match(/^\{\d+(,\d*)?\}/);
    if (match) {
      return { isQuantifier: true, length: match[0].length };
    }
  }
  return { isQuantifier: false, length: 0 };
}

export function isSafeRegexPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }

  if (BACKREFERENCE_REGEX.test(pattern)) {
    return false;
  }

  const groupStack: { hasQuantifier: boolean }[] = [];
  let inCharClass = false;
  let escaped = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '[') {
      inCharClass = true;
      continue;
    }

    if (char === ']' && inCharClass) {
      inCharClass = false;
      continue;
    }

    if (inCharClass) {
      continue;
    }

    if (char === '(') {
      groupStack.push({ hasQuantifier: false });
      continue;
    }

    if (char === ')') {
      const group = groupStack.pop();
      const nextIndex = i + 1;
      if (group && nextIndex < pattern.length) {
        const { isQuantifier: outerQuantifier } = isQuantifier(pattern, nextIndex);
        if (outerQuantifier && group.hasQuantifier) {
          return false;
        }
      }
      continue;
    }

    const { isQuantifier: innerQuantifier, length } = isQuantifier(pattern, i);
    if (innerQuantifier) {
      if (groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasQuantifier = true;
      }
      i += length - 1;
    }
  }

  return true;
}

export function tryCompileSafeRegex(pattern: string): RegExp | null {
  if (!isSafeRegexPattern(pattern)) {
    return null;
  }

  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
