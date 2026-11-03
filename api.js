/**
 * 工作說明書系統 - API 通訊模組 (API Service)
 * 實作直連 Google Apps Script + 本地快照持久化 (SWR) + 智慧防跳變架構
 */

const JobApi = (function () {
  const STORAGE_SNAPSHOT_KEY = "JD_PERSISTED_SNAPSHOT_V2";

  let connectionStatus = "offline";
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
   * 取得初始職位資料（優先讀取上次同步成功之 localStorage 快照，杜絕舊畫面跳變）
   */
  function getInitialJobs() {
    try {
      const raw = localStorage.getItem(STORAGE_SNAPSHOT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.jobs) && parsed.jobs.length > 0) {
          return mergeJobsWithLocal(parsed.jobs, getDefaultJobs());
        }
      }
    } catch (e) {
      console.warn("讀取持久化快照失敗：", e);
    }
    return JSON.parse(JSON.stringify(getDefaultJobs()));
  }

  /**
   * 持久化儲存最新快照至 localStorage
   */
  function persistSnapshot(jobs) {
    try {
      localStorage.setItem(STORAGE_SNAPSHOT_KEY, JSON.stringify({
        timestamp: new Date().toISOString(),
        jobs: jobs
      }));
    } catch (e) {
      // 避免 quota 超限
    }
  }

  /**
   * 載入全系統資料
   * 策略：
   * 1. 0 秒秒開：優先讀取已持久化之最新快照，若無則以本機靜態資料庫呈現。
   * 2. 背景靜默驗證：背景向 Google Apps Script 發出請求，實質比對有差異才無感套用。
   */
  async function loadAllData(forceRefresh, onDataUpdated) {
    const gasUrl = AppConfig.getGasUrl();

    if (!cachedJobs) {
      cachedJobs = getInitialJobs();
    }
    if (!cachedCommonSystem) {
      cachedCommonSystem = JSON.parse(JSON.stringify(getDefaultCompanySystem()));
    }

    if (!gasUrl || gasUrl.trim() === "") {
      connectionStatus = "offline";
      return {
        source: "local",
        status: connectionStatus,
        jobs: cachedJobs,
        commonSystem: cachedCommonSystem,
        departments: cachedDepartments
      };
    }

    connectionStatus = "connected";
    revalidateInBackground(gasUrl, onDataUpdated);

    return {
      source: "local_instant",
      status: connectionStatus,
      jobs: cachedJobs,
      commonSystem: cachedCommonSystem,
      departments: cachedDepartments
    };
  }

  /**
   * 背景向 Google 試算表驗證全部資料（超時時間設為 20 秒，容納 Apps Script 試算表遍歷）
   */
  async function revalidateInBackground(gasUrl, onDataUpdated) {
    if (isRevalidating) return;
    isRevalidating = true;

    try {
      const separator = gasUrl.indexOf("?") === -1 ? "?" : "&";
      const fetchUrl = gasUrl + separator + "action=getAll&refresh=1&_nocache=" + Date.now();

      const controller = new AbortController();
      const timeoutId = setTimeout(function () { controller.abort(); }, 20000);

      const response = await fetch(fetchUrl, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return;

      const resData = await response.json();
      if (resData && resData.status === "success" && Array.isArray(resData.jobs) && resData.jobs.length > 0) {
        const freshJobs = mergeJobsWithLocal(resData.jobs, getDefaultJobs());
        const freshCommon = (resData.commonSystem && resData.commonSystem.jobGrades && resData.commonSystem.jobGrades.columns && resData.commonSystem.jobGrades.columns.length > 0)
          ? resData.commonSystem
          : getDefaultCompanySystem();
        const freshDepts = resData.departments || [];

        // 智慧防抖：比對是否有實質變更
        const isChanged = JSON.stringify(freshJobs) !== JSON.stringify(cachedJobs);

        cachedJobs = freshJobs;
        cachedCommonSystem = freshCommon;
        cachedDepartments = freshDepts;
        connectionStatus = "connected";

        // 更新持久化快照
        persistSnapshot(cachedJobs);

        const updatePayload = {
          source: "google_sheets",
          status: connectionStatus,
          jobs: cachedJobs,
          commonSystem: cachedCommonSystem,
          departments: cachedDepartments,
          timestamp: resData.timestamp || new Date().toISOString(),
          isChanged: isChanged
        };

        if (typeof onDataUpdated === "function") {
          onDataUpdated(updatePayload, isChanged);
        }
      }
    } catch (e) {
      console.warn("背景同步 Google 試算表全表略過或超時：", e);
    } finally {
      isRevalidating = false;
    }
  }

  /**
   * 背景針對單一職位快速同步（執行耗時僅約 1~2 秒，支援智慧防抖與快照更新）
   */
  async function syncSingleJob(jobId, onJobUpdated) {
    if (!jobId) return;
    const gasUrl = AppConfig.getGasUrl();
    if (!gasUrl || gasUrl.trim() === "") return;

    try {
      const separator = gasUrl.indexOf("?") === -1 ? "?" : "&";
      const fetchUrl = gasUrl + separator + "action=getJob&id=" + encodeURIComponent(jobId) + "&_nocache=" + Date.now();

      const controller = new AbortController();
      const timeoutId = setTimeout(function () { controller.abort(); }, 12000);

      const response = await fetch(fetchUrl, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return;

      const resData = await response.json();
      if (resData && resData.status === "success" && resData.job && resData.job.id === jobId) {
        if (!cachedJobs) {
          cachedJobs = getInitialJobs();
        }
        const index = cachedJobs.findIndex(function (j) { return j.id === jobId; });
        const localJob = index !== -1 ? cachedJobs[index] : null;
        const merged = mergeSingleJob(resData.job, localJob);

        // 智慧防抖：比對該職位是否有實質修改
        const isChanged = !localJob || JSON.stringify(merged) !== JSON.stringify(localJob);

        if (index !== -1) {
          cachedJobs[index] = merged;
        } else {
          cachedJobs.push(merged);
        }

        connectionStatus = "connected";

        // 若有實質異動，立即更新持久化快照
        if (isChanged) {
          persistSnapshot(cachedJobs);
        }

        if (typeof onJobUpdated === "function") {
          onJobUpdated(merged, isChanged);
        }
        return merged;
      }
    } catch (e) {
      console.warn("快速同步單一職位 (" + jobId + ") 失敗：", e);
    }
  }

  /**
   * 單一職位資料精準合併
   */
  function mergeSingleJob(remote, local) {
    if (!remote) return local;
    if (!local) return remote;
    return {
      id: local.id,
      category: local.category,
      dept: remote.dept || local.dept,
      title: remote.title || local.title,
      grade: remote.grade || local.grade,
      reportsTo: remote.reportsTo || local.reportsTo,
      workLocation: (remote.workLocation !== undefined && remote.workLocation !== null && remote.workLocation !== "") ? remote.workLocation : local.workLocation,
      shift: (remote.shift !== undefined && remote.shift !== null && remote.shift !== "") ? remote.shift : local.shift,
      overview: (remote.overview !== undefined && remote.overview !== null && remote.overview !== "") ? remote.overview : local.overview,
      qualifications: (remote.qualifications !== undefined && remote.qualifications !== null && remote.qualifications !== "") ? remote.qualifications : local.qualifications,
      certificates: (remote.certificates !== undefined && remote.certificates !== null && remote.certificates !== "") ? remote.certificates : local.certificates,
      schedule: (remote.schedule && remote.schedule.length > 0) ? remote.schedule : local.schedule,
      notes: (remote.notes && remote.notes.length > 0) ? remote.notes : local.notes,
      tasks: (remote.tasks && remote.tasks.length > 0) ? remote.tasks : local.tasks
    };
  }

  /**
   * 輔助函式：將 Google 試算表全部職位與本地預設資料合併
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
      return mergeSingleJob(remote, lj);
    });
  }

  return {
    getStatus: getStatus,
    getInitialJobs: getInitialJobs,
    loadAllData: loadAllData,
    syncSingleJob: syncSingleJob
  };
})();
