import { build, } from "./commands/build-core.js";
process.env.AS_TEST_BUILD_API = "1";
process.on("message", async (message) => {
    if (!message || message.type != "build-file")
        return;
    try {
        await build(message.configPath, [message.file], message.modeName, message.featureToggles, message.overrides);
        send({
            type: "done",
            id: message.id,
        });
    }
    catch (error) {
        send({
            type: "error",
            id: message.id,
            error: serializeError(error),
        });
    }
});
function send(message) {
    if (!process.send)
        return;
    process.send(message);
}
function serializeError(error) {
    if (!(error instanceof Error)) {
        return {
            name: "Error",
            message: typeof error == "string" ? error : "unknown error",
        };
    }
    const out = {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
    const errorRecord = error;
    for (const key of Object.keys(error)) {
        out[key] = errorRecord[key];
    }
    return out;
}
