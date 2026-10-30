/**
 * 工作說明書系統 - 前端設定模組 (Config Module)
 */

const AppConfig = (function () {
  const STORAGE_KEY_GAS_URL = "JD_GOOGLE_APP_SCRIPT_URL";
  const STORAGE_KEY_THEME = "JD_COLOR_THEME";
  const STORAGE_KEY_ADMIN_PIN = "JD_ADMIN_PIN";
  const SESSION_KEY_ADMIN_AUTH = "JD_ADMIN_AUTHENTICATED";

  // 預設設定：直接套用目前已發布之 Google Apps Script Web App URL
  const DEFAULT_CONFIG = {
    gasUrl: "https://script.google.com/macros/s/AKfycbzzjQy-DN1ztCpkoH1awBlq_lXa1OZ8DQhIFc1hLApViYlTgISrcqbtepQq4hOycm4/exec",
    defaultPin: "8888",
    cacheDuration: 300
  };

  function getGasUrl() {
    // 1. 優先檢查使用者在介面設定儲存的網址
    var stored = localStorage.getItem(STORAGE_KEY_GAS_URL);
    if (stored !== null && stored.trim() !== "") {
      return stored.trim();
    }
    // 2. 檢查 env.js 中注入的環境變數
    if (window.__ENV__ && typeof window.__ENV__.GOOGLE_APP_SCRIPT_URL === "string" && window.__ENV__.GOOGLE_APP_SCRIPT_URL.trim() !== "") {
      return window.__ENV__.GOOGLE_APP_SCRIPT_URL.trim();
    }
    // 3. 使用預設值
    return DEFAULT_CONFIG.gasUrl;
  }

  function setGasUrl(url) {
    if (url && url.trim() !== "") {
      localStorage.setItem(STORAGE_KEY_GAS_URL, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_GAS_URL);
    }
  }

  function getAdminPin() {
    var stored = localStorage.getItem(STORAGE_KEY_ADMIN_PIN);
    if (stored && stored.trim() !== "") {
      return stored.trim();
    }
    if (window.__ENV__ && window.__ENV__.ADMIN_PIN) {
      return String(window.__ENV__.ADMIN_PIN).trim();
    }
    return DEFAULT_CONFIG.defaultPin;
  }

  function setAdminPin(pin) {
    if (pin && pin.trim() !== "") {
      localStorage.setItem(STORAGE_KEY_ADMIN_PIN, pin.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_ADMIN_PIN);
    }
  }

  function isAdminAuthenticated() {
    return sessionStorage.getItem(SESSION_KEY_ADMIN_AUTH) === "true";
  }

  function setAdminAuthenticated(val) {
    if (val) {
      sessionStorage.setItem(SESSION_KEY_ADMIN_AUTH, "true");
    } else {
      sessionStorage.removeItem(SESSION_KEY_ADMIN_AUTH);
    }
  }

  function verifyAdminPin(inputPin) {
    if (!inputPin) return false;
    var correctPin = getAdminPin();
    var ok = inputPin.trim() === correctPin;
    if (ok) {
      setAdminAuthenticated(true);
    }
    return ok;
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
    setGasUrl: setGasUrl,
    getAdminPin: getAdminPin,
    setAdminPin: setAdminPin,
    isAdminAuthenticated: isAdminAuthenticated,
    setAdminAuthenticated: setAdminAuthenticated,
    verifyAdminPin: verifyAdminPin,
    getTheme: getTheme,
    setTheme: setTheme,
    cacheDuration: DEFAULT_CONFIG.cacheDuration
  };
})();
