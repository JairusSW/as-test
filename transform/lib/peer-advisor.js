import { isStdlib } from "./util.js";
const PEER_RULES = [
    {
        decorators: ["json", "serializable"],
        transform: "json-as",
        asconfigKey: "json-as",
    },
];
const TRANSFORM_ACTIVE_ENV = {
    "json-as": "AS_TEST_JSON_AS_TRANSFORM_ACTIVE",
};
export class PeerTransformAdvisor {
    stderr;
    warnedTransforms = new Set();
    constructor(stderr = process.stderr) {
        this.stderr = stderr;
    }
    apply(sources) {
        for (const rule of PEER_RULES) {
            if (this.transformActive(rule.transform))
                continue;
            const witness = this.findFirstDecoratedClass(sources, rule.decorators);
            if (!witness)
                continue;
            this.warn(rule, witness);
        }
    }
    transformActive(transform) {
        const envKey = TRANSFORM_ACTIVE_ENV[transform];
        if (!envKey)
            return false;
        return process.env[envKey] === "1";
    }
    findFirstDecoratedClass(sources, decorators) {
        for (const source of sources) {
            if (isStdlib(source))
                continue;
            if (!isUserSource(source))
                continue;
            const hit = walkForDecoratedClass(source.statements, decorators);
            if (hit)
                return { source, klass: hit.klass, decorator: hit.decorator };
        }
        return null;
    }
    warn(rule, witness) {
        const key = `${rule.transform}:${witness.decorator}`;
        if (this.warnedTransforms.has(key))
            return;
        this.warnedTransforms.add(key);
        const className = witness.klass.name.text;
        const sourcePath = witness.source.normalizedPath;
        const message = `\n[as-test] Class \`${className}\` in ${sourcePath} is decorated with ` +
            `\`@${witness.decorator}\` but the \`${rule.transform}\` transform is ` +
            `not enabled.\n` +
            `\n` +
            `  Add it to your asc invocation:\n` +
            `\n` +
            `    asc … --transform ${rule.transform}\n` +
            `\n` +
            `  or to your asconfig.json:\n` +
            `\n` +
            `    {\n` +
            `      "options": {\n` +
            `        "transform": ["${rule.asconfigKey}"]\n` +
            `      }\n` +
            `    }\n`;
        this.stderr.write(message);
    }
}
function isUserSource(source) {
    return (source.sourceKind === 0 ||
        source.sourceKind === 1);
}
function walkForDecoratedClass(statements, decorators) {
    for (const stmt of statements) {
        if (!stmt)
            continue;
        if (stmt.kind === 52) {
            const klass = stmt;
            const decorator = matchDecorator(klass, decorators);
            if (decorator)
                return { klass, decorator };
        }
        else if (stmt.kind === 60) {
            const members = stmt.members;
            if (members) {
                const hit = walkForDecoratedClass(members, decorators);
                if (hit)
                    return hit;
            }
        }
    }
    return null;
}
function matchDecorator(klass, decorators) {
    if (!klass.decorators)
        return null;
    for (const dec of klass.decorators) {
        const name = dec.name.text;
        if (name && decorators.indexOf(name) !== -1)
            return name;
    }
    return null;
}
