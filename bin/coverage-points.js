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
    const declaration = detectCoverageDeclaration(context.visible);
    if (declaration) {
        const [highlightStart, highlightEnd] = resolveCoverageHighlightSpan(context.visible, context.focus);
        return {
            displayType: declaration.type,
            subjectName: declaration.name,
            visible: context.visible,
            focus: context.focus,
            highlightStart,
            highlightEnd,
        };
    }
    const call = detectCoverageCall(context.visible, context.focus);
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
    const [highlightStart, highlightEnd] = resolveCoverageHighlightSpan(context.visible, context.focus);
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
        }
        catch {
            lines = null;
        }
        sourceLineCache.set(resolved, lines);
    }
    if (!lines)
        return "";
    return lines[line - 1] ?? "";
}
export function resolveCoverageHighlightSpan(visible, focus) {
    if (!visible.length)
        return [0, 0];
    const index = Math.max(0, Math.min(visible.length - 1, focus));
    if (isCoverageBoundary(visible.charAt(index))) {
        return [index, Math.min(visible.length, index + 1)];
    }
    let start = index;
    let end = index + 1;
    while (start > 0 && !isCoverageBoundary(visible.charAt(start - 1)))
        start--;
    while (end < visible.length && !isCoverageBoundary(visible.charAt(end)))
        end++;
    return [start, end];
}
function getCoverageSourceContext(file, line, column) {
    const sourceLine = readCoverageSourceLine(file, line);
    if (!sourceLine)
        return null;
    const expanded = sourceLine.replace(/\t/g, "  ");
    const firstNonWhitespace = expanded.search(/\S/);
    if (firstNonWhitespace == -1)
        return null;
    const visible = expanded.slice(firstNonWhitespace).trimEnd();
    if (!visible.length)
        return null;
    const focus = Math.max(0, Math.min(visible.length - 1, Math.max(0, column - 1 - firstNonWhitespace)));
    return { visible, focus };
}
function detectCoverageDeclaration(visible) {
    const trimmed = visible.trim();
    if (!trimmed.length)
        return null;
    let match = trimmed.match(/^(?:export\s+)?function\s+([A-Za-z_]\w*)(?:<[^>]+>)?\s*\(/);
    if (match)
        return { type: "Function", name: match[1] ?? null };
    if (trimmed.startsWith("constructor(") ||
        /^(?:public\s+|private\s+|protected\s+)constructor\s*\(/.test(trimmed)) {
        return { type: "Constructor", name: "constructor" };
    }
    match = trimmed.match(/^(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?([A-Za-z_]\w*)(?:<[^>]+>)?\([^)]*\)\s*:\s*[^{=]+[{]?$/);
    if (match)
        return { type: "Method", name: match[1] ?? null };
    match = trimmed.match(/^(?:public\s+|private\s+|protected\s+)?(?:readonly\s+)?([A-Za-z_]\w*)(?:<[^>]+>)?\s*:\s*[^=;{]+(?:=.*)?;?$/);
    if (match)
        return { type: "Property", name: match[1] ?? null };
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
function detectCoverageCall(visible, focus) {
    const matches = [...visible.matchAll(/\b([A-Za-z_]\w*)(?:<[^>()]+>)?\s*\(/g)];
    if (!matches.length)
        return null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestMatch = null;
    for (const match of matches) {
        const start = match.index ?? -1;
        if (start == -1)
            continue;
        const end = start + match[0].length;
        const distance = focus < start ? start - focus : focus >= end ? focus - end + 1 : 0;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = match;
        }
    }
    if (!bestMatch)
        return null;
    const name = bestMatch[1] ?? null;
    if (name == "if" ||
        name == "for" ||
        name == "while" ||
        name == "switch" ||
        name == "return" ||
        name == "function") {
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
