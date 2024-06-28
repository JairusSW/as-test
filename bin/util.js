export function formatTime(ms) {
    if (ms < 0) {
        throw new Error("Time should be a non-negative number.");
    }
    // Convert milliseconds to microseconds
    const us = ms * 1000;
    const units = [
        { name: 'μs', divisor: 1 },
        { name: 'ms', divisor: 1000 },
        { name: 's', divisor: 1000 * 1000 },
        { name: 'm', divisor: 60 * 1000 * 1000 },
        { name: 'h', divisor: 60 * 60 * 1000 * 1000 },
        { name: 'd', divisor: 24 * 60 * 60 * 1000 * 1000 }
    ];
    for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        if (us >= unit.divisor) {
            const value = Math.round((us / unit.divisor) * 1000) / 1000;
            return `${value}${unit.name}`;
        }
    }
    return `${us}us`;
}
