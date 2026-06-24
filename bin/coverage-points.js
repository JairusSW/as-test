import { readFileSync } from "fs";
import * as path from "path";
const sourceLineCache = new Map();
export function describeCoveragePoint(file, line, column, fallbackType) {
  const context = getCoverageSourceContext(file, line, column);
  if (!context) {
    return {
      displayType: fallbackType,
      subjectName: null,
      visible: "",
      focus: 0,
      highlightStart: 0,
      highlightEnd: 0,
    };
  }
  const parameter = detectCoverageParameter(
    context.visible,
    context.focus,
    fallbackType,
  );
  if (parameter) {
    return {
      displayType: parameter.type,
      subjectName: parameter.name,
      visible: context.visible,
      focus: context.focus,
      highlightStart: parameter.start,
      highlightEnd: parameter.end,
    };
  }
  const ternary = detectCoverageTernary(
    context.visible,
    context.focus,
    fallbackType,
  );
  if (ternary) {
    return {
      displayType: ternary.type,
      subjectName: null,
      visible: context.visible,
      focus: context.focus,
      highlightStart: ternary.start,
      highlightEnd: ternary.end,
    };
  }
  const ifBranch = detectCoverageIfBranch(context.visible, fallbackType);
  if (ifBranch) {
    return {
      displayType: ifBranch.type,
      subjectName: null,
      visible: context.visible,
      focus: context.focus,
      highlightStart: ifBranch.start,
      highlightEnd: ifBranch.end,
    };
  }
  const assignment = detectCoverageAssignment(context.visible, fallbackType);
  if (assignment) {
    return {
      displayType: assignment.type,
      subjectName: null,
      visible: context.visible,
      focus: context.focus,
      highlightStart: assignment.start,
      highlightEnd: assignment.end,
    };
  }
  const declarationAllowed =
    fallbackType == "Expression" ||
    fallbackType == "Block" ||
    fallbackType == "Function" ||
    fallbackType == "Method" ||
    fallbackType == "Constructor" ||
    fallbackType == "Variable" ||
    fallbackType == "Property" ||
    fallbackType == "Call";
  const declaration = declarationAllowed
    ? detectCoverageDeclaration(context.visible)
    : null;
  if (declaration) {
    const [highlightStart, highlightEnd] = resolveCoverageHighlightSpan(
      context.visible,
      context.focus,
    );
    return {
      displayType: declaration.type,
      subjectName: declaration.name,
      visible: context.visible,
      focus: context.focus,
      highlightStart,
      highlightEnd,
    };
  }
  const callAllowed = fallbackType == "Expression" || fallbackType == "Call";
  const call = callAllowed
    ? detectCoverageCall(context.visible, context.focus)
    : null;
  if (call) {
    return {
      displayType: "Call",
      subjectName: call.name,
      visible: context.visible,
      focus: context.focus,
      highlightStart: call.start,
      highlightEnd: call.end,
    };
  }
  const [highlightStart, highlightEnd] = resolveCoverageHighlightSpan(
    context.visible,
    context.focus,
  );
  return {
    displayType: fallbackType,
    subjectName: null,
    visible: context.visible,
    focus: context.focus,
    highlightStart,
    highlightEnd,
  };
}
export function readCoverageSourceLine(file, line) {
  const resolved = path.resolve(process.cwd(), file);
  let lines = sourceLineCache.get(resolved);
  if (lines === undefined) {
    try {
      lines = readFileSync(resolved, "utf8").split(/\r?\n/);
    } catch {
      lines = null;
    }
    sourceLineCache.set(resolved, lines);
  }
  if (!lines) return "";
  return lines[line - 1] ?? "";
}
export function resolveCoverageHighlightSpan(visible, focus) {
  if (!visible.length) return [0, 0];
  const index = Math.max(0, Math.min(visible.length - 1, focus));
  if (isCoverageBoundary(visible.charAt(index))) {
    return [index, Math.min(visible.length, index + 1)];
  }
  let start = index;
  let end = index + 1;
  while (start > 0 && !isCoverageBoundary(visible.charAt(start - 1))) start--;
  while (end < visible.length && !isCoverageBoundary(visible.charAt(end)))
    end++;
  return [start, end];
}
function getCoverageSourceContext(file, line, column) {
  const sourceLine = readCoverageSourceLine(file, line);
  if (!sourceLine) return null;
  const expanded = sourceLine.replace(/\t/g, "  ");
  const firstNonWhitespace = expanded.search(/\S/);
  if (firstNonWhitespace == -1) return null;
  const visible = expanded.slice(firstNonWhitespace).trimEnd();
  if (!visible.length) return null;
  const focus = Math.max(
    0,
    Math.min(visible.length - 1, Math.max(0, column - 1 - firstNonWhitespace)),
  );
  return { visible, focus };
}
function detectCoverageDeclaration(visible) {
  const trimmed = visible.trim();
  if (!trimmed.length) return null;
  let match = trimmed.match(
    /^(?:export\s+)?function\s+([A-Za-z_]\w*)(?:<[^(]+>)?\s*\(/,
  );
  if (match) return { type: "Function", name: match[1] ?? null };
  if (
    trimmed.startsWith("constructor(") ||
    /^(?:public\s+|private\s+|protected\s+)constructor\s*\(/.test(trimmed)
  ) {
    return { type: "Constructor", name: "constructor" };
  }
  match = trimmed.match(
    /^(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?([A-Za-z_]\w*)(?:<[^>]+>)?\([^)]*\)\s*:\s*[^{=]+[{]?$/,
  );
  if (match) return { type: "Method", name: match[1] ?? null };
  match = trimmed.match(
    /^(?:public\s+|private\s+|protected\s+)?(?:readonly\s+)?([A-Za-z_]\w*)(?:<[^>]+>)?\s*:\s*[^=;{]+(?:=.*)?;?$/,
  );
  if (match) return { type: "Property", name: match[1] ?? null };
  if (/^(?:export\s+)?class\b/.test(trimmed)) {
    match = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_]\w*)/);
    return { type: "Class", name: match?.[1] ?? null };
  }
  if (/^(?:export\s+)?enum\b/.test(trimmed)) {
    match = trimmed.match(/^(?:export\s+)?enum\s+([A-Za-z_]\w*)/);
    return { type: "Enum", name: match?.[1] ?? null };
  }
  if (/^(?:export\s+)?interface\b/.test(trimmed)) {
    match = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_]\w*)/);
    return { type: "Interface", name: match?.[1] ?? null };
  }
  if (/^(?:export\s+)?namespace\b/.test(trimmed)) {
    match = trimmed.match(/^(?:export\s+)?namespace\s+([A-Za-z_]\w*)/);
    return { type: "Namespace", name: match?.[1] ?? null };
  }
  if (/^(?:const|let|var)\b/.test(trimmed)) {
    match = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_]\w*)/);
    return { type: "Variable", name: match?.[1] ?? null };
  }
  return null;
}
function detectCoverageParameter(visible, focus, fallbackType) {
  const inlineParameter = detectCoverageInlineParameter(
    visible,
    focus,
    fallbackType,
  );
  if (inlineParameter) {
    return inlineParameter;
  }
  const openParen = visible.indexOf("(");
  const closeParen = visible.lastIndexOf(")");
  if (openParen == -1 || closeParen == -1 || closeParen <= openParen) {
    return null;
  }
  if (focus <= openParen || focus >= closeParen) {
    return null;
  }
  const params = visible.slice(openParen + 1, closeParen);
  const matches = [
    ...params.matchAll(/([A-Za-z_]\w*)\s*:\s*[^,)=]+(?:=\s*[^,)]*)?/g),
  ];
  if (!matches.length) return null;
  for (const match of matches) {
    const localStart = match.index ?? -1;
    if (localStart == -1) continue;
    const localEnd = localStart + match[0].length;
    const absoluteStart = openParen + 1 + localStart;
    const absoluteEnd = openParen + 1 + localEnd;
    if (focus < absoluteStart || focus > absoluteEnd) continue;
    const name = match[1] ?? null;
    if (!name) return null;
    const nameOffset = match[0].indexOf(name);
    const equalsOffset = match[0].indexOf("=");
    if (fallbackType == "DefaultValue" && equalsOffset != -1) {
      const valueStart = absoluteStart + equalsOffset + 1;
      const valueVisibleStart = skipCoverageWhitespace(visible, valueStart);
      const [start, end] = resolveCoverageHighlightSpan(
        visible,
        Math.max(valueVisibleStart, focus),
      );
      return {
        type: "DefaultValue",
        name,
        start,
        end,
      };
    }
    return {
      type: fallbackType == "Parameter" ? "Parameter" : "Property",
      name,
      start: absoluteStart + nameOffset,
      end: absoluteStart + nameOffset + name.length,
    };
  }
  return null;
}
function detectCoverageInlineParameter(visible, focus, fallbackType) {
  const match = visible.match(
    /^([A-Za-z_]\w*)\s*:\s*[^=,]+(?:=\s*[^,]+)?[,]?$/,
  );
  if (!match) return null;
  const name = match[1] ?? null;
  if (!name) return null;
  const nameStart = visible.indexOf(name);
  const nameEnd = nameStart + name.length;
  const equalsIndex = visible.indexOf("=");
  if (fallbackType == "DefaultValue" && equalsIndex != -1) {
    const valueStart = skipCoverageWhitespace(visible, equalsIndex + 1);
    const [start, end] = resolveCoverageHighlightSpan(
      visible,
      Math.max(valueStart, focus),
    );
    return {
      type: "DefaultValue",
      name,
      start,
      end,
    };
  }
  return {
    type: fallbackType == "Parameter" ? "Parameter" : "Property",
    name,
    start: nameStart,
    end: nameEnd,
  };
}
function detectCoverageTernary(visible, focus, fallbackType) {
  if (fallbackType != "Ternary" && fallbackType != "LogicalBranch") {
    return null;
  }
  const q = visible.indexOf("?");
  if (q == -1) return null;
  if (fallbackType == "LogicalBranch") {
    const [start, end] = resolveCoverageHighlightSpan(visible, focus);
    return { type: "LogicalBranch", start, end };
  }
  const colon = visible.indexOf(":", q + 1);
  if (colon == -1) {
    const [start, end] = resolveCoverageHighlightSpan(visible, focus);
    return { type: "Ternary", start, end };
  }
  const branchStart = focus <= colon ? q + 1 : colon + 1;
  const normalizedStart = skipCoverageWhitespace(visible, branchStart);
  const [start, end] = resolveCoverageHighlightSpan(
    visible,
    Math.max(normalizedStart, focus),
  );
  return { type: "Ternary", start, end };
}
function detectCoverageIfBranch(visible, fallbackType) {
  if (fallbackType != "IfBranch") return null;
  const match = visible.match(/^if\s*\(([^)]*)\)/);
  if (!match) {
    // The visible line does not start with `if (`, so this is the else/false
    // branch — the condition was always true and this path was never skipped to.
    return { type: "IfBranch (false)", start: 0, end: 0 };
  }
  const full = match[0];
  const condition = match[1] ?? "";
  const openParen = full.indexOf("(");
  const conditionPadding = condition.length
    ? condition.length - condition.trimStart().length
    : 0;
  const conditionStart =
    openParen == -1 ? -1 : openParen + 1 + conditionPadding;
  if (conditionStart == -1 || !condition.length) {
    return { type: "IfBranch (true)", start: 0, end: full.length };
  }
  // The true branch (condition → body) was never taken.
  return {
    type: "IfBranch (true)",
    start: conditionStart,
    end: conditionStart + condition.length,
  };
}
function detectCoverageAssignment(visible, fallbackType) {
  if (fallbackType != "Assignment") return null;
  const match = visible.match(
    /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[[^\]]+\])?)\s*(=|\+=|-=|\*=|\*\*=|\/=|%=|<<=|>>=|>>>=|&=|\|=|\^=)/,
  );
  if (!match) return null;
  const full = match[0];
  const lhs = match[1] ?? "";
  const operator = match[2] ?? "=";
  const fullStart = visible.indexOf(full);
  const lhsStart = fullStart + full.indexOf(lhs);
  const operatorStart = fullStart + full.lastIndexOf(operator);
  return {
    type: "Assignment",
    start: lhsStart,
    end: operatorStart + operator.length,
  };
}
function detectCoverageCall(visible, focus) {
  const matches = [...visible.matchAll(/\b([A-Za-z_]\w*)(?:<[^>()]+>)?\s*\(/g)];
  if (!matches.length) return null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMatch = null;
  for (const match of matches) {
    const start = match.index ?? -1;
    if (start == -1) continue;
    const end = start + match[0].length;
    const distance =
      focus < start ? start - focus : focus >= end ? focus - end + 1 : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = match;
    }
  }
  if (!bestMatch) return null;
  const name = bestMatch[1] ?? null;
  if (
    name == "if" ||
    name == "for" ||
    name == "while" ||
    name == "switch" ||
    name == "return" ||
    name == "function"
  ) {
    return null;
  }
  if (bestDistance > Math.max(12, Math.floor(visible.length / 3))) {
    return null;
  }
  const start = bestMatch.index ?? 0;
  return {
    name,
    start,
    end: start + (name?.length ?? 1),
  };
}
function isCoverageBoundary(ch) {
  return /[\s()[\]{}.,;:+\-*/%&|^!?=<>]/.test(ch);
}
function skipCoverageWhitespace(visible, index) {
  let current = Math.max(0, Math.min(visible.length - 1, index));
  while (current < visible.length - 1 && /\s/.test(visible.charAt(current))) {
    current++;
  }
  return current;
}
