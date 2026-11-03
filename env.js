/**
 * 網頁前端環境變數注入檔 (Environment Variable Injector)
 * 解決瀏覽器以 file:// 開啟時無法直接讀取 .env 的限制。
 * 若日後更換 Google Apps Script 網址，可直接在此檔或經由管理員模式修改。
 */
window.__ENV__ = {
  GOOGLE_APP_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxTh78zwG_wPeNfeGf49ZoxbCNWTlOJbx9Q3uSLU49Adyn5FKMi2GOgMi68ffZx2S8p/exec",
  ADMIN_PIN: "8888",
  SYSTEM_MODE: "sync",
  CACHE_EXPIRE_SECONDS: 300
};
