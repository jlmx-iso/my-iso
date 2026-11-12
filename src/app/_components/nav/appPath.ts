/** True for routes inside the signed-in app (`/app` and below). */
export function isAppPath(pathname: string | null): boolean {
    return pathname === "/app" || (pathname?.startsWith("/app/") ?? false);
}
