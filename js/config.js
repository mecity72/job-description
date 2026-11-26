/**
 * 工作說明書系統 - 前端設定模組 (Config Module)
 */

const AppConfig = (function () {
  const STORAGE_KEY_THEME = "JD_COLOR_THEME";

  // 固定 Google Apps Script Web App 端點（免手動設定，隨開即用）
  const DEFAULT_CONFIG = {
    gasUrl: "https://script.google.com/macros/s/AKfycbxTh78zwG_wPeNfeGf49ZoxbCNWTlOJbx9Q3uSLU49Adyn5FKMi2GOgMi68ffZx2S8p/exec"
  };

  function getGasUrl() {
    if (window.__ENV__ && typeof window.__ENV__.GOOGLE_APP_SCRIPT_URL === "string" && window.__ENV__.GOOGLE_APP_SCRIPT_URL.trim() !== "") {
      return window.__ENV__.GOOGLE_APP_SCRIPT_URL.trim();
    }
    return DEFAULT_CONFIG.gasUrl;
  }

  function getTheme() {
    var stored = localStorage.getItem(STORAGE_KEY_THEME);
    if (stored) return stored;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }

  return {
    getGasUrl: getGasUrl,
    getTheme: getTheme,
    setTheme: setTheme
  };
})();
