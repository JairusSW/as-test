export function visualize<T>(value: T): string {
    if (isString<T>()) {
        return value as string;
    } else if (isBoolean<T>()) {
        // @ts-ignore
        return value.toString();
    } else if (isInteger<T>() || isFloat<T>()) {
        // @ts-ignore
        return value.toString();
    }

    return unreachable();
}