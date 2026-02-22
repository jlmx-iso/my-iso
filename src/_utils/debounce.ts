export function debounce<T = string>(func: (...args: T[]) => void, wait: number) {
    let timeout: NodeJS.Timeout | undefined;
    const executedFunction = (...args: T[]) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
    executedFunction.cancel = () => clearTimeout(timeout);
    return executedFunction;
}
