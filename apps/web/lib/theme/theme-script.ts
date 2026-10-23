export type ThemeMode = "light" | "dark";

export const forceThemeAttribute = "data-force-theme";

export function resolveTheme(forced: string | null, prefersDark: boolean): ThemeMode {
  if (forced === "light" || forced === "dark") {
    return forced;
  }
  return prefersDark ? "dark" : "light";
}

// Runs in <head> before first paint. Mutation observer callbacks run before the browser can
// paint the inserted nodes, so a community that forces a theme never shows the device theme.
export const themeScript = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)"),a="${forceThemeAttribute}";function apply(){var f=d.querySelector("["+a+"]"),v=f?f.getAttribute(a):null,t=v==="light"||v==="dark"?v:m.matches?"dark":"light";if(d.getAttribute("data-theme")!==t)d.setAttribute("data-theme",t)}apply();m.addEventListener("change",apply);new MutationObserver(apply).observe(d,{childList:true,subtree:true,attributes:true,attributeFilter:[a]})})();`;
