export function debounce<T = string>(func: (...args: T[]) => void, wait: number) {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: T[]) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
