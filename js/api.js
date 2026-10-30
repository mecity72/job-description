/**
 * 工作說明書系統 - API 通訊模組 (API Service)
 * 實作 Stale-While-Revalidate (SWR) 本地優先快取與雙向同步機制
 */

const JobApi = (function () {
  const STORAGE_KEY_SWR_DATA = "JD_SWR_CACHE_DATA";
  const STORAGE_KEY_SWR_TIME = "JD_SWR_CACHE_TIME";

  let connectionStatus = "offline"; // "connected" | "offline" | "loading" | "error"
  let cachedJobs = null;
  let cachedCommonSystem = null;
  let cachedDepartments = [];
  let isRevalidating = false;

  function getStatus() {
    return connectionStatus;
  }

  function getDefaultJobs() {
    return (typeof DEFAULT_JOBS !== "undefined" && Array.isArray(DEFAULT_JOBS)) ? DEFAULT_JOBS : [];
  }

  function getDefaultCompanySystem() {
    return (typeof DEFAULT_COMPANY_SYSTEM !== "undefined" && DEFAULT_COMPANY_SYSTEM) ? DEFAULT_COMPANY_SYSTEM : null;
  }

  /**
   * 讀取本地 SWR 快取資料
   */
  function loadLocalCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SWR_DATA);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.jobs) && parsed.jobs.length > 0) {
        return {
          jobs: mergeJobsWithLocal(parsed.jobs, getDefaultJobs()),
          commonSystem: parsed.commonSystem || getDefaultCompanySystem(),
          departments: parsed.departments || [],
          timestamp: localStorage.getItem(STORAGE_KEY_SWR_TIME) || ""
        };
      }
    } catch (e) {
      console.warn("解析本地 SWR 快取失敗：", e);
    }
    return null;
  }

  /**
   * 寫入本地 SWR 快取資料
   */
  function saveLocalCache(payload) {
    try {
      const cacheObj = {
        jobs: payload.jobs,
        commonSystem: payload.commonSystem,
        departments: payload.departments
      };
      localStorage.setItem(STORAGE_KEY_SWR_DATA, JSON.stringify(cacheObj));
      localStorage.setItem(STORAGE_KEY_SWR_TIME, new Date().toISOString());
    } catch (e) {
      console.warn("寫入本地 SWR 快取失敗：", e);
    }
  }

  /**
   * 載入全系統資料（SWR 架構）
   * 策略：
   * 1. 非強制重整時，若本地已有快取立即以 0 秒速度回傳並渲染畫面。
   * 2. 背景靜默向 Google Apps Script 發出驗證請求，資料更新時觸發 onDataUpdated 回呼與自訂事件。
   * 3. 若為強制重整，則直接請求遠端並覆蓋本地快取。
   */
  async function loadAllData(forceRefresh, onDataUpdated) {
    const gasUrl = AppConfig.getGasUrl();

    // 若未設定 GAS 網址，使用本機預設資料庫
    if (!gasUrl || gasUrl.trim() === "") {
      connectionStatus = "offline";
      cachedJobs = JSON.parse(JSON.stringify(getDefaultJobs()));
      cachedCommonSystem = JSON.parse(JSON.stringify(getDefaultCompanySystem()));
      cachedDepartments = [];
      return {
        source: "local",
        status: connectionStatus,
        jobs: cachedJobs,
        commonSystem: cachedCommonSystem,
        departments: cachedDepartments
      };
    }

    // 1. 本地優先快取命中 (SWR 命中，0 秒瞬間呈現)
    if (!forceRefresh) {
      const local = loadLocalCache();
      if (local) {
        connectionStatus = "connected";
        cachedJobs = local.jobs;
        cachedCommonSystem = local.commonSystem;
        cachedDepartments = local.departments;

        // 背景非同步進行重新驗證 (Stale-While-Revalidate)
        revalidateInBackground(gasUrl, onDataUpdated);

        return {
          source: "local_cache",
          status: connectionStatus,
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments,
          timestamp: local.timestamp,
          isStale: true
        };
      }
    }

    // 2. 無本地快取或使用者手動要求強制重整：同步遠端請求
    return await fetchRemoteData(gasUrl, forceRefresh);
  }

  /**
   * 向 Google Apps Script 發送 HTTP GET 請求獲取最新資料
   */
  async function fetchRemoteData(gasUrl, isForce) {
    connectionStatus = "loading";
    try {
      const separator = gasUrl.indexOf("?") === -1 ? "?" : "&";
      let fetchUrl = gasUrl + separator + "action=getAll";
      if (isForce) {
        fetchUrl += "&refresh=1&_nocache=" + Date.now();
      }

      // 注意：不可自訂 Header（例如 Accept、Content-Type），否則會觸發 CORS Preflight OPTIONS 請求
      const response = await fetch(fetchUrl, {
        method: "GET"
      });

      if (!response.ok) {
        throw new Error("HTTP 狀態碼異常：" + response.status);
      }

      const resData = await response.json();
      if (resData && resData.status === "success" && Array.isArray(resData.jobs) && resData.jobs.length > 0) {
        connectionStatus = "connected";
        cachedJobs = mergeJobsWithLocal(resData.jobs, getDefaultJobs());
        cachedCommonSystem = resData.commonSystem || getDefaultCompanySystem();
        cachedDepartments = resData.departments || [];

        // 寫入本地 SWR 快取持久化
        saveLocalCache({
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments
        });

        return {
          source: "google_sheets",
          status: connectionStatus,
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments,
          timestamp: resData.timestamp || new Date().toISOString()
        };
      } else {
        throw new Error("遠端回傳資料格式不符合規範");
      }
    } catch (err) {
      console.warn("自 Google Apps Script 獲取資料失敗，切換為本地降級資料庫：", err);
      // 若已有快取則維持現有快取，否則降級為靜態預設
      const local = loadLocalCache();
      if (local) {
        connectionStatus = "offline";
        cachedJobs = local.jobs;
        cachedCommonSystem = local.commonSystem;
        cachedDepartments = local.departments;
      } else {
        connectionStatus = "error";
        cachedJobs = JSON.parse(JSON.stringify(getDefaultJobs()));
        cachedCommonSystem = JSON.parse(JSON.stringify(getDefaultCompanySystem()));
        cachedDepartments = [];
      }

      return {
        source: local ? "local_cache" : "local_fallback",
        status: connectionStatus,
        error: err.message,
        jobs: cachedJobs,
        commonSystem: cachedCommonSystem,
        departments: cachedDepartments
      };
    }
  }

  /**
   * 背景靜默重新驗證機制
   */
  async function revalidateInBackground(gasUrl, onDataUpdated) {
    if (isRevalidating) return;
    isRevalidating = true;

    try {
      const separator = gasUrl.indexOf("?") === -1 ? "?" : "&";
      const fetchUrl = gasUrl + separator + "action=getAll";

      const response = await fetch(fetchUrl, {
        method: "GET"
      });

      if (!response.ok) return;

      const resData = await response.json();
      if (resData && resData.status === "success" && Array.isArray(resData.jobs)) {
        const freshJobs = mergeJobsWithLocal(resData.jobs, getDefaultJobs());
        const freshCommon = resData.commonSystem || getDefaultCompanySystem();
        const freshDepts = resData.departments || [];

        cachedJobs = freshJobs;
        cachedCommonSystem = freshCommon;
        cachedDepartments = freshDepts;
        connectionStatus = "connected";

        saveLocalCache({
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments
        });

        const updatePayload = {
          source: "google_sheets",
          status: connectionStatus,
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments,
          timestamp: resData.timestamp || new Date().toISOString()
        };

        if (typeof onDataUpdated === "function") {
          onDataUpdated(updatePayload);
        }

        window.dispatchEvent(new CustomEvent("jobDataUpdated", { detail: updatePayload }));
      }
    } catch (e) {
      console.warn("背景重新驗證靜默失敗（維持本地快取）：", e);
    } finally {
      isRevalidating = false;
    }
  }

  /**
   * 輔助函式：將 Google Sheets 資料與本地結構合併
   */
  function mergeJobsWithLocal(remoteJobs, localJobs) {
    if (!localJobs || localJobs.length === 0) return remoteJobs || [];
    const jobMap = {};
    (remoteJobs || []).forEach(function (rj) {
      if (rj && rj.id) jobMap[rj.id] = rj;
    });

    return localJobs.map(function (lj) {
      const remote = jobMap[lj.id];
      if (!remote) return lj;
      return {
        id: lj.id,
        category: lj.category,
        dept: lj.dept || remote.dept,
        title: remote.title || lj.title,
        grade: remote.grade || lj.grade,
        reportsTo: remote.reportsTo || lj.reportsTo,
        workLocation: remote.workLocation || lj.workLocation,
        shift: remote.shift || lj.shift,
        overview: remote.overview || lj.overview,
        qualifications: remote.qualifications || lj.qualifications,
        certificates: remote.certificates || lj.certificates,
        schedule: (remote.schedule && remote.schedule.length > 0) ? remote.schedule : lj.schedule,
        notes: (remote.notes && remote.notes.length > 0) ? remote.notes : lj.notes,
        tasks: (remote.tasks && remote.tasks.length > 0) ? remote.tasks : lj.tasks
      };
    });
  }

  /**
   * 測試指定 Google Apps Script 網址連線能力
   */
  async function testConnection(testUrl) {
    if (!testUrl || testUrl.trim() === "") {
      return { ok: false, message: "網址不可為空白" };
    }
    try {
      const separator = testUrl.indexOf("?") === -1 ? "?" : "&";
      const url = testUrl.trim() + separator + "action=getCommon&_nocache=" + Date.now();
      const resp = await fetch(url, {
        method: "GET"
      });
      if (!resp.ok) {
        return { ok: false, message: "伺服器回應錯誤碼：" + resp.status };
      }
      const data = await resp.json();
      if (data && data.status === "success") {
        return { ok: true, message: "連線成功！Google Sheets API 運作正常。" };
      } else {
        return { ok: false, message: "回應格式未符合預期：" + (data.message || "未知原因") };
      }
    } catch (e) {
      return { ok: false, message: "連線失敗：" + e.message + "（請確認發布權限是否已設為「所有人」）" };
    }
  }

  /**
   * 強制刷新後端快取快照
   */
  async function refreshBackendCache() {
    const gasUrl = AppConfig.getGasUrl();
    if (!gasUrl) {
      return { ok: false, message: "尚未配置 Google Apps Script 網址" };
    }
    try {
      const separator = gasUrl.indexOf("?") === -1 ? "?" : "&";
      const url = gasUrl + separator + "action=refreshCache&_nocache=" + Date.now();
      const resp = await fetch(url, { method: "GET" });
      const data = await resp.json();
      if (data && data.status === "success") {
        if (data.jobs) {
          cachedJobs = mergeJobsWithLocal(data.jobs, getDefaultJobs());
          cachedCommonSystem = data.commonSystem || getDefaultCompanySystem();
          cachedDepartments = data.departments || [];
          saveLocalCache({
            jobs: cachedJobs,
            commonSystem: cachedCommonSystem,
            departments: cachedDepartments
          });
        }
        return { ok: true, message: "後端快取快照已全量重建完成！" };
      }
      return { ok: false, message: data.message || "快取重建失敗" };
    } catch (e) {
      return { ok: false, message: "呼叫快取刷新失敗：" + e.message };
    }
  }

  /**
   * 將修改後的工作說明書寫回 Google Sheets，並即時更新本地 SWR 快取
   */
  async function updateJob(jobData) {
    const gasUrl = AppConfig.getGasUrl();
    if (!gasUrl) {
      if (cachedJobs) {
        for (let i = 0; i < cachedJobs.length; i++) {
          if (cachedJobs[i].id === jobData.id) {
            cachedJobs[i] = JSON.parse(JSON.stringify(jobData));
            break;
          }
        }
        saveLocalCache({
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments
        });
      }
      return { ok: true, mode: "local", message: "本機端已更新（未設定 Google Apps Script 網址）" };
    }

    try {
      // 避免跨域預檢，使用 text/plain 送出 JSON 字串
      const resp = await fetch(gasUrl, {
        method: "POST",
        body: JSON.stringify({
          action: "updateJob",
          job: jobData
        })
      });
      const res = await resp.json();
      if (res && res.status === "success") {
        if (cachedJobs) {
          for (let i = 0; i < cachedJobs.length; i++) {
            if (cachedJobs[i].id === jobData.id) {
              cachedJobs[i] = JSON.parse(JSON.stringify(jobData));
              break;
            }
          }
          // 同步寫入本地快取
          saveLocalCache({
            jobs: cachedJobs,
            commonSystem: cachedCommonSystem,
            departments: cachedDepartments
          });
        }
        return { ok: true, mode: "remote", message: "已成功同步儲存至 Google Sheets 與本地快取！" };
      } else {
        throw new Error(res.message || "更新失敗");
      }
    } catch (err) {
      return { ok: false, message: "儲存至 Google Sheets 時發生錯誤：" + err.message };
    }
  }

  return {
    getStatus: getStatus,
    loadAllData: loadAllData,
    testConnection: testConnection,
    refreshBackendCache: refreshBackendCache,
    updateJob: updateJob
  };
})();
