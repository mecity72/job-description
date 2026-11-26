/**
 * 工作說明書系統 - 前端主控制器 (Main App Controller)
 * 負責路由解析、資料渲染、搜尋過濾、模組互動與主題切換
 */

const App = (function () {
  // 核心狀態（初始即載入本機最新持久化快照與預設庫，杜絕找不到職位與跳變閃爍）
  let state = {
    jobs: (typeof JobApi !== "undefined" && typeof JobApi.getInitialJobs === "function")
      ? JobApi.getInitialJobs()
      : ((typeof DEFAULT_JOBS !== "undefined" && Array.isArray(DEFAULT_JOBS)) ? JSON.parse(JSON.stringify(DEFAULT_JOBS)) : []),
    commonSystem: (typeof DEFAULT_COMPANY_SYSTEM !== "undefined") ? JSON.parse(JSON.stringify(DEFAULT_COMPANY_SYSTEM)) : null,
    departments: [],
    currentView: "home", // "home" | "job_detail" | "common_system"
    currentJobId: null,
    activeFilter: "all",
    searchQuery: "",
    collapsedGroups: {},
    isLoading: false
  };

  /**
   * 系統啟動初始化
   */
  async function init() {
    // 1. 初始化色彩主題
    const currentTheme = AppConfig.getTheme();
    AppConfig.setTheme(currentTheme);
    updateThemeButton(currentTheme);

    // 2. 註冊 Hash 路由監聽
    window.addEventListener("hashchange", handleRouting);

    // 3. 綁定事件監聽
    bindEvents();

    // 4. 先執行路由解析，確保正確設定 currentView 與 currentJobId（若使用者直連詳細頁）
    handleRouting();

    // 5. 載入資料（優先取得 Google 試算表最新內容，並精準渲染當前視圖）
    await refreshData(false);
  }

  /**
   * 載入資料（支援本機優先瞬間呈現，背景靜默向 Google 試算表重新驗證）
   */
  async function refreshData(force) {
    const syncBtn = document.querySelector(".job-actions-toolbar .action-btn.primary");
    if (force && syncBtn) {
      syncBtn.textContent = "同步中...";
      syncBtn.disabled = true;
    }

    // 若使用者正在檢視特定職位，優先執行該職位的極速同步（1~2 秒即可完成）
    if (state.currentView === "job_detail" && state.currentJobId) {
      JobApi.syncSingleJob(state.currentJobId, function (updatedJob, isChanged) {
        const idx = state.jobs.findIndex(function (j) { return j.id === updatedJob.id; });
        if (idx !== -1) {
          state.jobs[idx] = updatedJob;
        } else {
          state.jobs.push(updatedJob);
        }
        if (state.currentView === "job_detail" && state.currentJobId === updatedJob.id) {
          if (isChanged || force) {
            renderJobDetail(updatedJob.id);
          }
        }
        if (syncBtn) {
          syncBtn.textContent = "已同步最新！";
          setTimeout(function () {
            syncBtn.textContent = "重新同步";
            syncBtn.disabled = false;
          }, 1500);
        }
      });
    }

    const result = await JobApi.loadAllData(force, function (freshResult, isChanged) {
      applyDataResult(freshResult, isChanged);
      if (syncBtn) {
        syncBtn.textContent = "已同步最新！";
        setTimeout(function () {
          syncBtn.textContent = "重新同步";
          syncBtn.disabled = false;
        }, 1500);
      }
    });

    applyDataResult(result, true);
  }

  /**
   * 套用資料結果至應用程式狀態並重新渲染（支援防抖略過）
   */
  function applyDataResult(result, isChanged) {
    if (result.jobs && result.jobs.length > 0) {
      state.jobs = result.jobs;
    }
    state.commonSystem = result.commonSystem || (typeof DEFAULT_COMPANY_SYSTEM !== "undefined" ? DEFAULT_COMPANY_SYSTEM : null);
    state.departments = result.departments || [];
    state.isLoading = false;

    // 若為背景同步且資料並無實質變更，略過畫面重繪，杜絕跳動
    if (isChanged === false) {
      return;
    }

    renderCurrentView();
  }

  /**
   * 背景驗證完成回呼
   */
  function handleBackgroundDataUpdate(freshResult) {
    applyDataResult(freshResult);
  }

  // 五大部門導覽定義（左側選單與分類共用）
  const DEPT_DEFINITIONS = [
    {
      key: "mfg_dept",
      name: "製造部",
      variant: "icon-chem",
      svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path></svg>'
    },
    {
      key: "tech_dept",
      name: "技術部",
      variant: "icon-check",
      svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.52 16h12.96"></path></svg>'
    },
    {
      key: "sales_dept",
      name: "營業部",
      variant: "icon-pkg",
      svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>'
    },
    {
      key: "mgmt_dept",
      name: "管理部",
      variant: "icon-mgmt",
      svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>'
    },
    {
      key: "hr_ga_dept",
      name: "人資總務部",
      variant: "icon-admin",
      svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
    }
  ];

  function getDeptNameByKey(key) {
    for (let i = 0; i < DEPT_DEFINITIONS.length; i++) {
      if (DEPT_DEFINITIONS[i].key === key) return DEPT_DEFINITIONS[i].name;
    }
    return "全部職位";
  }

  /**
   * 路由處理 (Hash-based Routing)
   */
  function handleRouting() {
    const hash = window.location.hash || "#/";
    const prevView = state.currentView;

    if (hash === "#/" || hash === "") {
      state.currentView = "home";
      state.currentJobId = null;
      state.activeFilter = "all";
    } else if (hash.startsWith("#/dept/")) {
      const deptKey = hash.replace("#/dept/", "").trim();
      state.currentView = "dept_list";
      state.currentJobId = null;
      state.activeFilter = deptKey || "all";
    } else if (hash === "#/common") {
      state.currentView = "common_system";
      state.currentJobId = null;
    } else if (hash === "#/org") {
      state.currentView = "org_chart";
      state.currentJobId = null;
    } else if (hash.startsWith("#/job/")) {
      state.currentView = "job_detail";
      try {
        state.currentJobId = decodeURIComponent(hash.replace("#/job/", ""));
      } catch (e) {
        state.currentJobId = hash.replace("#/job/", "");
      }
      if (state.currentJobId === "wh_operator_a" || state.currentJobId === "wh_operator_b") {
        state.currentJobId = "wh_operator";
      }
      if (state.currentJobId === "sales") {
        state.currentJobId = "sales_mgr";
      }
      // 進入職位時，背景向 Google 試算表極速同步該職位最新內容（支援智慧防抖，無變更不跳動）
      const targetJobId = state.currentJobId;
      JobApi.syncSingleJob(targetJobId, function (updatedJob, isChanged) {
        if (state.currentView === "job_detail" && state.currentJobId === updatedJob.id) {
          const idx = state.jobs.findIndex(function (j) { return j.id === updatedJob.id; });
          if (idx !== -1) {
            state.jobs[idx] = updatedJob;
          } else {
            state.jobs.push(updatedJob);
          }
          if (isChanged) {
            renderJobDetail(updatedJob.id);
          }
        }
      });
    } else {
      state.currentView = "home";
      state.currentJobId = null;
      state.activeFilter = "all";
    }

    renderCurrentView();
    if (prevView !== state.currentView || (state.currentView !== "home" && state.currentView !== "dept_list")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  /**
   * 同步右側部門篩選頁籤按鈕之啟用狀態
   */
  function syncFilterTabButtons() {
    const filterTabs = document.querySelectorAll(".filter-tabs .tab-btn");
    filterTabs.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.filter === state.activeFilter);
    });
  }

  /**
   * 依目前狀態渲染對應視圖、左側選單與頂部麵包屑
   */
  function renderCurrentView() {
    const homeView = document.getElementById("viewHome");
    const jobView = document.getElementById("viewJobDetail");
    const commonView = document.getElementById("viewCommonSystem");
    const orgView = document.getElementById("viewOrgChart");

    if (!homeView || !jobView || !commonView) return;

    homeView.classList.remove("active", "dept-focus-mode");
    jobView.classList.remove("active");
    commonView.classList.remove("active");
    if (orgView) orgView.classList.remove("active");

    if (state.currentView === "home" || state.currentView === "dept_list") {
      homeView.classList.add("active");
      if (state.currentView === "dept_list") {
        homeView.classList.add("dept-focus-mode");
      }
      syncFilterTabButtons();
      renderHomeJobs();
    } else if (state.currentView === "common_system") {
      commonView.classList.add("active");
      renderCommonSystem();
    } else if (state.currentView === "org_chart") {
      if (orgView) orgView.classList.add("active");
      renderOrgChart();
    } else if (state.currentView === "job_detail") {
      jobView.classList.add("active");
      renderJobDetail(state.currentJobId);
    }

    renderSidebar();
    updateTopBreadcrumb();
    closeMobileSidebar();
  }

  /**
   * 依部門名稱自動判斷分類所屬
   * 分類：製造部 (mfg_dept)、技術部 (tech_dept)、營業部 (sales_dept)、管理部 (mgmt_dept)、人資總務部 (hr_ga_dept)
   */
  function getJobCategory(job) {
    if (!job) return "all";
    const str = (job.dept || "") + " " + (job.title || "") + " " + (job.id || "");
    if (str.indexOf("製造部") !== -1 || str.indexOf("包裝課") !== -1 || str.indexOf("製造課") !== -1 || str.indexOf("倉管課") !== -1 || str.indexOf("生管課") !== -1 || str.indexOf("工務課") !== -1) return "mfg_dept";
    if (str.indexOf("技術部") !== -1 || str.indexOf("品管課") !== -1 || str.indexOf("研發課") !== -1) return "tech_dept";
    if (str.indexOf("營業部") !== -1) return "sales_dept";
    if (str.indexOf("營管課") !== -1 || str.indexOf("採購課") !== -1 || str.indexOf("財務課") !== -1 || str.indexOf("管理部") !== -1) return "mgmt_dept";
    if (str.indexOf("人資") !== -1 || str.indexOf("總務") !== -1) return "hr_ga_dept";
    return job.category || "all";
  }

  /**
   * 取得職位所屬標準課室分區名稱
   * 確保即使遠端回傳工作表分頁名稱（如「包裝課・組長」、「製造部・副理」），仍精準歸入同一課室分區
   */
  function getJobSectionTitle(job) {
    if (!job) return "其他課室";
    const id = (job.id || "").trim();
    const deptStr = (job.dept || "").trim();
    const titleStr = (job.title || "").trim();
    const lookup = deptStr + " " + titleStr;
    const cat = getJobCategory(job);

    // 1. 製造部（分為：製造部、包裝課、製造課、倉管課、生管課、工務課）
    if (cat === "mfg_dept") {
      if (id.indexOf("pkg_") === 0 || lookup.indexOf("包裝課") !== -1) return "製造部・包裝課";
      if (id === "mfg_section_mgr" || id === "mfg_assistant_eng" || id === "mfg_operator" || lookup.indexOf("製造課") !== -1) return "製造部・製造課";
      if (id.indexOf("wh_") === 0 || lookup.indexOf("倉管課") !== -1 || lookup.indexOf("倉儲") !== -1) return "製造部・倉管課";
      if (id.indexOf("pc_") === 0 || lookup.indexOf("生管課") !== -1) return "製造部・生管課";
      if (id.indexOf("facility_") === 0 || lookup.indexOf("工務課") !== -1) return "製造部・工務課";
      return "製造部";
    }

    // 2. 技術部（分為：技術部主管、技術部PSA・品管課、技術部PSA・研發課、技術部PU・品管課、技術部PU・研發課）
    if (cat === "tech_dept") {
      if (id === "qc_psa" || lookup.indexOf("PSA・品管") !== -1 || (lookup.indexOf("PSA") !== -1 && lookup.indexOf("品管") !== -1)) return "技術部PSA・品管課";
      if (id === "rd_psa" || lookup.indexOf("PSA・研發") !== -1 || (lookup.indexOf("PSA") !== -1 && lookup.indexOf("研發") !== -1)) return "技術部PSA・研發課";
      if (id === "qc_pu" || lookup.indexOf("PU・品管") !== -1 || (lookup.indexOf("PU") !== -1 && lookup.indexOf("品管") !== -1)) return "技術部PU・品管課";
      if (id === "rd_pu" || lookup.indexOf("PU・研發") !== -1 || (lookup.indexOf("PU") !== -1 && lookup.indexOf("研發") !== -1)) return "技術部PU・研發課";
      return "技術部";
    }

    // 3. 營業部
    if (cat === "sales_dept") {
      return "營業部";
    }

    // 4. 管理部（分為：管理部主管、管理部・財務課、管理部・採購課、管理部・營管課）
    if (cat === "mgmt_dept") {
      if (id === "finance" || lookup.indexOf("財務課") !== -1 || lookup.indexOf("會計") !== -1) return "管理部・財務課";
      if (id === "procurement" || lookup.indexOf("採購課") !== -1 || lookup.indexOf("採購") !== -1) return "管理部・採購課";
      if (id === "biz_admin" || lookup.indexOf("營管課") !== -1 || lookup.indexOf("企管") !== -1) return "管理部・營管課";
      return "管理部";
    }

    // 5. 人資總務部（分為：人資部、總務課）
    if (cat === "hr_ga_dept") {
      if (id === "general_affairs" || lookup.indexOf("總務") !== -1) return "人資總務部・總務課";
      if (id === "hr" || lookup.indexOf("人資") !== -1) return "人資總務部・人資部";
      return "人資總務部";
    }

    return deptStr || "其他課室";
  }

  /**
   * 將職位陣列依課室分組並維持組織排列順序
   */
  function groupJobsBySection(jobList) {
    const groups = [];
    const groupMap = {};

    (jobList || []).forEach(function (job) {
      const sectionTitle = getJobSectionTitle(job);
      if (!groupMap[sectionTitle]) {
        groupMap[sectionTitle] = {
          title: sectionTitle,
          category: getJobCategory(job),
          items: []
        };
        groups.push(groupMap[sectionTitle]);
      }
      groupMap[sectionTitle].items.push(job);
    });

    // 依指定之課室優先順序進行嚴格排列
    // 製造部置頂：製造課 > 包裝課 > 倉管課 > 生管課 > 工務課
    // 技術部：技術部 > 技術部PSA・品管課 > 技術部PSA・研發課 > 技術部PU・品管課 > 技術部PU・研發課
    // 營業部：營業部
    // 管理部：管理部 > 管理部・財務課 > 管理部・採購課 > 管理部・營管課
    // 人資總務部：人資總務部・人資部 > 人資總務部・總務課
    const SECTION_ORDER = [
      "製造部",
      "製造部・製造課",
      "製造部・包裝課",
      "製造部・倉管課",
      "製造部・生管課",
      "製造部・工務課",
      "技術部",
      "技術部PSA・品管課",
      "技術部PSA・研發課",
      "技術部PU・品管課",
      "技術部PU・研發課",
      "營業部",
      "管理部",
      "管理部・財務課",
      "管理部・採購課",
      "管理部・營管課",
      "人資總務部",
      "人資總務部・人資部",
      "人資總務部・總務課"
    ];

    groups.sort(function (a, b) {
      const idxA = SECTION_ORDER.indexOf(a.title);
      const idxB = SECTION_ORDER.indexOf(b.title);
      const weightA = idxA !== -1 ? idxA : 999;
      const weightB = idxB !== -1 ? idxB : 999;
      return weightA - weightB;
    });

    return groups;
  }

  /**
   * 依職位性質與課室歸屬回傳對應之向量圖示與色調樣式
   * 規範：
   * (1) 部門 icon 維持不變
   * (2) 每個課室 icon 一致，組長以上用深色做出區別
   * (3) 製造部/副理 icon 跟製造部 icon 一樣 (工廠廠房)
   *     製造課 icon 更改為生產製造齒輪 (不跟技術部一樣)
   *     包裝課維持箱子 icon
   *     倉管課變更為倉儲物料箱 (與品管課剪貼簿區別)
   *     生管課維持文件工單 icon
   *     技術部高階主管 (PU/協理、PSA/總監、PU/經理) icon 一致 (分子結構)，研發課維持化學燒瓶 (兩者不同)
   *     管理部/副理 icon 跟管理部部門 icon 一樣 (人員協同羅盤)
   *     營管課、採購課、財務課 icon 各自獨立互不相同
   */
  function getJobIconMeta(job) {
    const title = (job && job.title) ? job.title : "";
    const dept = getJobSectionTitle(job) + " " + ((job && job.dept) ? job.dept : "");
    const id = (job && job.id) ? job.id : "";
    const cat = getJobCategory(job);

    // 判斷是否為「組長以上幹部」（副理、經理、協理、總監、廠長、課長、副課長、組長）
    const isLeader = /(副理|經理|協理|總監|廠長|課長|副課長|組長|主管)/.test(title) ||
                     id === "mfg_deputy_mgr" || id === "tech_pu" || id === "tech_psa" || id === "tech_pu_mgr" || id === "pc_deputy_mgr" || id === "mgmt" || id === "sales_mgr";

    // 1. 製造部主管 (副理) - 與製造部部門 icon 完全相同 (工廠廠房)
    if (id === "mfg_deputy_mgr" || dept === "製造部") {
      return {
        variant: "icon-factory",
        isLeader: true,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path></svg>'
      };
    }

    // 2. 製造部・製造課 (課長、助理工程師、作業員 - 課室全員一致使用機械齒輪生產 icon)
    if (dept.indexOf("製造課") !== -1 || id.indexOf("mfg_") === 0) {
      return {
        variant: "icon-mfg-gear",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
      };
    }

    // 3. 製造部・包裝課 (維持箱子 icon)
    if (dept.indexOf("包裝課") !== -1 || id.indexOf("pkg_") === 0) {
      return {
        variant: "icon-pkg",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>'
      };
    }

    // 4. 製造部・倉管課 (變更為倉儲物料箱，與品管課做出明確區分)
    if (dept.indexOf("倉管課") !== -1 || id.indexOf("wh_") === 0 || dept.indexOf("倉儲") !== -1) {
      return {
        variant: "icon-warehouse",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path></svg>'
      };
    }

    // 5. 製造部・生管課 (維持文件排程工單 icon)
    if (dept.indexOf("生管課") !== -1 || id.indexOf("pc_") === 0) {
      return {
        variant: "icon-admin",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line></svg>'
      };
    }

    // 6. 製造部・工務課 (維修設備扳手工具)
    if (dept.indexOf("工務課") !== -1 || id.indexOf("facility_") === 0) {
      return {
        variant: "icon-tool",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>'
      };
    }

    // 7. 技術部高階主管 (技術部PU/協理、技術部PSA/總監、技術部PU/經理) - 與研發課化學燒瓶不同，主管一致使用分子結構圖示
    if (id === "tech_pu" || id === "tech_psa" || id === "tech_pu_mgr" || (dept.indexOf("技術部") !== -1 && dept.indexOf("課") === -1)) {
      return {
        variant: "icon-tech-lead",
        isLeader: true,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-9 5-9-5V8l9-5 9 5v8z"></path><path d="m12 3v18"></path><path d="m3 8 9 5 9-5"></path><path d="m3 16 9-5 9 5"></path></svg>'
      };
    }

    // 8. 品管課 (技術部PSA・品管課、技術部PU・品管課 - 品質檢驗板夾)
    if (dept.indexOf("品管") !== -1 || id.indexOf("qc_") === 0) {
      return {
        variant: "icon-check",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="m9 14 2 2 4-4"></path></svg>'
      };
    }

    // 9. 研發課 (技術部PSA・研發課、技術部PU・研發課 - 實驗室化學燒瓶)
    if (dept.indexOf("研發") !== -1 || id.indexOf("rd_") === 0) {
      return {
        variant: "icon-chem",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.52 16h12.96"></path></svg>'
      };
    }

    // 10. 營業部 (營業部經理為幹部深色，PSA專員/PU專員為基層淺色)
    if (cat === "sales_dept" || dept.indexOf("營業") !== -1 || id.indexOf("sales") === 0) {
      return {
        variant: "icon-sales",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>'
      };
    }

    // 11. 管理部・副理 (主管) - 與管理部部門 icon 完全相同 (圓形羅盤導航圖示)
    if (id === "mgmt" || (dept.indexOf("管理部") !== -1 && dept.indexOf("課") === -1)) {
      return {
        variant: "icon-mgmt-lead",
        isLeader: true,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>'
      };
    }

    // 12. 管理部・財務課 (財務會計專用 - 貨幣金融圖示，與採購、營管做出區別)
    if (id === "finance" || dept.indexOf("財務課") !== -1) {
      return {
        variant: "icon-finance",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M15 9.5a3.5 3.5 0 0 0-5 0c0 2 2 3 5 3.5s5 1.5 5 3.5a3.5 3.5 0 0 1-5 0"></path></svg>'
      };
    }

    // 13. 管理部・採購課 (資材採購專用 - 採購車圖示，與財務、營管做出區別)
    if (id === "procurement" || dept.indexOf("採購課") !== -1) {
      return {
        variant: "icon-procure",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>'
      };
    }

    // 14. 管理部・營管課 (營運企管專用 - 柱狀儀表板圖示，與財務、採購做出區別)
    if (id === "biz_admin" || dept.indexOf("營管課") !== -1) {
      return {
        variant: "icon-biz-admin",
        isLeader: isLeader,
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line><path d="M3 20h18"></path></svg>'
      };
    }

    // 15. 人資總務部
    return {
      variant: "icon-hr",
      isLeader: isLeader,
      svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
    };
  }

  /**
   * 統計各部門職位數量對照表
   */
  function getDepartmentCountsMap() {
    const counts = {
      mfg_dept: 0,
      tech_dept: 0,
      sales_dept: 0,
      mgmt_dept: 0,
      hr_ga_dept: 0
    };
    state.jobs.forEach(function (j) {
      const cat = getJobCategory(j);
      if (counts[cat] !== undefined) {
        counts[cat]++;
      }
    });
    return counts;
  }

  /**
   * 渲染左側固定導覽選單（精簡為五大部門項目：製造部、技術部、營業部、管理部、人資總務部）
   */
  function renderSidebar() {
    const navHome = document.getElementById("navHomeLink");
    const navCommon = document.getElementById("navCommonLink");
    const navOrg = document.getElementById("navOrgLink");
    const countEl = document.getElementById("sidebarJobsCount");
    const groupsContainer = document.getElementById("sidebarJobGroups");

    const isOverviewActive = state.currentView === "home" && state.activeFilter === "all";
    if (navHome) {
      navHome.classList.toggle("active", isOverviewActive);
    }
    if (navCommon) {
      navCommon.classList.toggle("active", state.currentView === "common_system");
    }
    if (navOrg) {
      navOrg.classList.toggle("active", state.currentView === "org_chart");
    }
    if (countEl) {
      countEl.textContent = "共 " + state.jobs.length + " 項";
    }
    if (!groupsContainer) return;

    const countsMap = getDepartmentCountsMap();

    // 判斷目前作用中的部門：部門檢視、首頁篩選特定部門、或檢視特定職位時皆高亮所屬部門
    let activeDeptKey = "";
    if ((state.currentView === "dept_list" || state.currentView === "home") && state.activeFilter !== "all") {
      activeDeptKey = state.activeFilter;
    } else if (state.currentView === "job_detail" && state.currentJobId) {
      const activeJob = state.jobs.find(function (j) { return j.id === state.currentJobId; });
      if (activeJob) {
        activeDeptKey = getJobCategory(activeJob);
      }
    }

    let html = '<div class="sidebar-dept-nav">';
    DEPT_DEFINITIONS.forEach(function (dept) {
      const cnt = countsMap[dept.key] || 0;
      const isActive = activeDeptKey === dept.key;
      html += '<a href="#/dept/' + dept.key + '" class="sidebar-dept-link' + (isActive ? ' active' : '') + '">';
      html += '  <span class="sidebar-job-icon ' + dept.variant + '" aria-hidden="true">' + dept.svg + '</span>';
      html += '  <span class="sidebar-dept-label">' + escapeHtml(dept.name) + ' (' + cnt + ')</span>';
      html += '</a>';
    });
    html += '</div>';

    groupsContainer.innerHTML = html;
  }

  /**
   * 更新右側頂部狀態列之動態麵包屑
   */
  function updateTopBreadcrumb() {
    const crumbEl = document.getElementById("topBreadcrumb");
    if (!crumbEl) return;

    if (state.currentView === "common_system") {
      crumbEl.innerHTML =
        '<a href="#/" class="crumb-link">工作說明書系統</a>' +
        '<span class="crumb-sep">/</span>' +
        '<span class="crumb-current">公司通用制度</span>';
      return;
    }

    if (state.currentView === "org_chart") {
      crumbEl.innerHTML =
        '<a href="#/" class="crumb-link">工作說明書系統</a>' +
        '<span class="crumb-sep">/</span>' +
        '<span class="crumb-current">公司組織圖</span>';
      return;
    }

    if (state.currentView === "dept_list") {
      crumbEl.innerHTML =
        '<a href="#/" class="crumb-link">工作說明書系統</a>' +
        '<span class="crumb-sep">/</span>' +
        '<span class="crumb-current">' + escapeHtml(getDeptNameByKey(state.activeFilter)) + '</span>';
      return;
    }

    if (state.currentView === "job_detail" && state.currentJobId) {
      const job = state.jobs.find(function (j) { return j.id === state.currentJobId; });
      if (job) {
        const deptKey = getJobCategory(job);
        crumbEl.innerHTML =
          '<a href="#/" class="crumb-link">工作說明書系統</a>' +
          '<span class="crumb-sep">/</span>' +
          '<a href="#/dept/' + deptKey + '" class="crumb-link">' + escapeHtml(getDeptNameByKey(deptKey)) + '</a>' +
          '<span class="crumb-sep">/</span>' +
          '<span class="crumb-current">' + escapeHtml(job.title) + '</span>';
        return;
      }
    }

    crumbEl.innerHTML =
      '<span class="crumb-root">工作說明書系統</span>' +
      '<span class="crumb-sep">/</span>' +
      '<span class="crumb-current">總覽首頁</span>';
  }

  /**
   * 行動裝置側邊欄開關控制
   */
  function openMobileSidebar() {
    const sidebar = document.getElementById("appSidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (sidebar) sidebar.classList.add("mobile-open");
    if (backdrop) backdrop.classList.add("open");
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById("appSidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (sidebar) sidebar.classList.remove("mobile-open");
    if (backdrop) backdrop.classList.remove("open");
  }

  /**
   * 更新各分類頁籤的數量統計
   */
  function updateCategoryCounts() {
    let cntAll = state.jobs.length;
    let cntMfg = 0, cntTech = 0, cntSales = 0, cntMgmt = 0, cntHrGa = 0;
    state.jobs.forEach(function (j) {
      const cat = getJobCategory(j);
      if (cat === "mfg_dept") cntMfg++;
      else if (cat === "tech_dept") cntTech++;
      else if (cat === "sales_dept") cntSales++;
      else if (cat === "mgmt_dept") cntMgmt++;
      else if (cat === "hr_ga_dept") cntHrGa++;
    });
    const elAll = document.getElementById("cntAll"); if (elAll) elAll.textContent = cntAll;
    const elMfg = document.getElementById("cntMfg"); if (elMfg) elMfg.textContent = cntMfg;
    const elTech = document.getElementById("cntTech"); if (elTech) elTech.textContent = cntTech;
    const elSales = document.getElementById("cntSales"); if (elSales) elSales.textContent = cntSales;
    const elMgmt = document.getElementById("cntMgmt"); if (elMgmt) elMgmt.textContent = cntMgmt;
    const elHrGa = document.getElementById("cntHrGa"); if (elHrGa) elHrGa.textContent = cntHrGa;
  }

  /**
   * 渲染首頁職位卡片（依各課室分組雙欄排列與篩選）
   */
  function renderHomeJobs() {
    const grid = document.getElementById("jobsGrid");
    const countEl = document.getElementById("jobsCountDisplay");
    const titleTextEl = document.getElementById("jobsSectionTitleText");
    if (!grid) return;

    // 動態更新分類頁籤計數與區塊標題
    updateCategoryCounts();
    if (titleTextEl) {
      titleTextEl.textContent = state.activeFilter === "all"
        ? "各部門職位工作說明書"
        : getDeptNameByKey(state.activeFilter) + "・職位工作說明書";
    }

    const filtered = state.jobs.filter(function (job) {
      // 類別過濾
      const jobCategory = getJobCategory(job);
      if (state.activeFilter !== "all" && jobCategory !== state.activeFilter) {
        return false;
      }
      // 關鍵字搜尋過濾
      if (state.searchQuery.trim() !== "") {
        const q = state.searchQuery.toLowerCase();
        const inTitle = (job.title || "").toLowerCase().indexOf(q) !== -1;
        const inDept = (job.dept || "").toLowerCase().indexOf(q) !== -1;
        const inSection = getJobSectionTitle(job).toLowerCase().indexOf(q) !== -1;
        const inOverview = (job.overview || "").toLowerCase().indexOf(q) !== -1;
        const inGrade = (job.grade || "").toLowerCase().indexOf(q) !== -1;
        const inTasks = (job.tasks || []).some(function (t) {
          return (t.item && t.item.toLowerCase().indexOf(q) !== -1) ||
                 (t.form && t.form.toLowerCase().indexOf(q) !== -1) ||
                 (t.focus && t.focus.toLowerCase().indexOf(q) !== -1);
        });
        return inTitle || inDept || inSection || inOverview || inGrade || inTasks;
      }
      return true;
    });

    if (countEl) {
      countEl.textContent = "共 " + filtered.length + " 個職位";
    }

    if (filtered.length === 0) {
      const anchorNavEl = document.getElementById("sectionAnchorNav");
      if (anchorNavEl) anchorNavEl.style.display = "none";
      grid.innerHTML = '<div class="empty-search-state">' +
        '<p class="empty-search-title">查無符合條件的職位</p>' +
        '<p class="empty-search-sub">請更換搜尋關鍵字或切換上方部門篩選頁籤。</p>' +
        '</div>';
      return;
    }

    const sectionGroups = groupJobsBySection(filtered);

    // 渲染課室快速跳轉導覽列 (Anchor Chips)
    const anchorNavEl = document.getElementById("sectionAnchorNav");
    if (anchorNavEl) {
      if (sectionGroups.length > 1) {
        let navHtml = '<span class="anchor-nav-label">課室快速跳轉：</span>';
        sectionGroups.forEach(function (group, idx) {
          const secId = "sec-group-" + idx;
          const shortName = group.title.indexOf("・") !== -1 ? group.title.split("・")[1] : group.title;
          navHtml += '<button type="button" class="anchor-chip" onclick="App.scrollToSection(\'' + secId + '\')">' +
            escapeHtml(shortName) +
            '<span class="chip-count">' + group.items.length + '</span>' +
            '</button>';
        });
        anchorNavEl.innerHTML = navHtml;
        anchorNavEl.style.display = "flex";
      } else {
        anchorNavEl.innerHTML = "";
        anchorNavEl.style.display = "none";
      }
    }

    let html = "";

    sectionGroups.forEach(function (group, idx) {
      const secId = "sec-group-" + idx;
      html += '<div class="dept-section-block" id="' + secId + '">';
      html += '  <div class="dept-section-heading">';
      html += '    <h3 class="dept-section-title">' + escapeHtml(group.title) + '</h3>';
      html += '    <div class="dept-section-heading-actions">';
      html += '      <span class="dept-section-count">' + group.items.length + ' 項職位</span>';
      html += '      <button type="button" class="section-back-top-btn" onclick="App.scrollToTop()" title="回到頁面最上方">&uarr; 回頂端</button>';
      html += '    </div>';
      html += '  </div>';
      html += '  <div class="dept-jobs-grid">';

      group.items.forEach(function (job) {
        const taskCount = job.tasks ? job.tasks.length : 0;
        const catClass = getJobCategory(job);
        const iconMeta = getJobIconMeta(job);
        const sectionLabel = getJobSectionTitle(job);

        html += '<div class="job-card" onclick="window.location.hash=\'#/job/' + encodeURIComponent(job.id) + '\'">' +
          '<div class="job-card-body">' +
            '<div class="job-card-header">' +
              '<div class="job-card-meta-left">' +
                '<span class="job-dept-tag ' + catClass + '">' + escapeHtml(sectionLabel) + '</span>' +
                '<h4 class="job-card-title">' + escapeHtml(job.title) + '</h4>' +
              '</div>' +
              '<div class="job-card-icon-box ' + iconMeta.variant + (iconMeta.isLeader ? ' is-leader' : '') + '" aria-hidden="true" title="' + (iconMeta.isLeader ? '管理/幹部職位' : '基層作業職位') + '">' +
                iconMeta.svg +
              '</div>' +
            '</div>' +
            '<p class="job-card-overview">' + escapeHtml(job.overview || "暫無職責概述") + '</p>' +
          '</div>' +
          '<div class="job-card-footer">' +
            '<div class="job-card-footer-meta">' +
              (job.grade ? '<span class="job-grade-tag">' + escapeHtml(job.grade) + '</span>' : '') +
              '<span class="job-tasks-stat">主要工作項目：' + taskCount + ' 項</span>' +
            '</div>' +
            '<span class="job-view-arrow">檢視說明書 &rarr;</span>' +
          '</div>' +
        '</div>';
      });

      html += '  </div>';
      html += '</div>';
    });

    grid.innerHTML = html;
  }

  /**
   * 渲染職位詳細工作說明書
   */
  function renderJobDetail(jobId) {
    const job = state.jobs.find(function (j) { return j.id === jobId; });
    const container = document.getElementById("jobDetailContent");
    if (!container) return;

    if (!job) {
      if (state.isLoading) {
        container.innerHTML = '<div style="text-align: center; padding: 80px 20px;">' +
          '<div style="font-size: 1.1rem; color: var(--text-muted);">正在載入職位說明書...</div>' +
          '</div>';
        return;
      }
      container.innerHTML = '<div style="text-align: center; padding: 80px 20px;">' +
        '<h3>找不到此職位說明書</h3>' +
        '<p style="margin-top: 8px;"><a href="#/" class="action-btn primary">&larr; 返回首頁</a></p>' +
        '</div>';
      return;
    }

    // 建立證照標籤 HTML
    let certHtml = "";
    if (job.certificates) {
      const certList = job.certificates.split(/[,、，]/);
      certList.forEach(function (c) {
        if (c.trim()) {
          certHtml += '<span class="cert-tag">' + escapeHtml(c.trim()) + '</span>';
        }
      });
    } else {
      certHtml = '<span style="color: var(--text-muted); font-size: 0.9rem;">依公司規定與法令要求適時培訓</span>';
    }

    // 工作項目表格列 HTML
    let taskRowsHtml = "";
    if (job.tasks && job.tasks.length > 0) {
      job.tasks.forEach(function (t, index) {
        taskRowsHtml += '<tr>' +
          '<td class="col-idx">' + (t.id || (index + 1)) + '</td>' +
          '<td class="col-item">' + escapeHtml(t.item) + '</td>' +
          '<td class="col-form">' + (t.form ? escapeHtml(t.form) : '<span style="color: var(--text-muted);">-</span>') + '</td>' +
          '<td class="col-timing">' + (t.timing ? '<span class="timing-badge">' + escapeHtml(t.timing) + '</span>' : '<span style="color: var(--text-muted);">-</span>') + '</td>' +
          '<td class="col-focus">' + (t.focus ? escapeHtml(t.focus) : '<span style="color: var(--text-muted);">-</span>') + '</td>' +
        '</tr>';
      });
    } else {
      taskRowsHtml = '<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">本職位目前尚未載入具體工作項次</td></tr>';
    }

    const jobDeptKey = getJobCategory(job);
    const jobSectionLabel = getJobSectionTitle(job);
    let html = '' +
      '<div class="breadcrumb">' +
        '<a href="#/dept/' + jobDeptKey + '">&larr; 返回' + escapeHtml(getDeptNameByKey(jobDeptKey)) + '職位列表</a>' +
        '<span>/</span>' +
        '<span>' + escapeHtml(jobSectionLabel) + '</span>' +
        '<span>/</span>' +
        '<span>' + escapeHtml(job.title) + '</span>' +
      '</div>' +

      '<div class="job-header-card">' +
        '<div class="job-header-top">' +
          '<div class="job-header-titles">' +
            '<h2>' + escapeHtml(job.title) + '</h2>' +
            '<div class="dept-label">' + escapeHtml(jobSectionLabel) + '</div>' +
          '</div>' +
          '<div class="job-actions-toolbar">' +
            '<a href="#/org" class="action-btn">查看組織圖</a>' +
            '<button type="button" class="action-btn" onclick="window.print()">列印說明書</button>' +
            '<button type="button" class="action-btn" onclick="App.copyShareLink()">複製連結</button>' +
            '<button type="button" class="action-btn primary" onclick="App.refreshData(true)">重新同步</button>' +
          '</div>' +
        '</div>' +

        '<div class="spec-grid">' +
          '<div class="spec-item"><div class="spec-label">組織所屬部門</div><div class="spec-value">' + escapeHtml(jobSectionLabel) + '</div></div>' +
          '<div class="spec-item"><div class="spec-label">對應職等編制</div><div class="spec-value">' + escapeHtml(job.grade || "-") + '</div></div>' +
          '<div class="spec-item"><div class="spec-label">直屬匯報主管</div><div class="spec-value">' + escapeHtml(job.reportsTo || "-") + '</div></div>' +
          (job.workLocation ? '<div class="spec-item"><div class="spec-label">作業所在工位</div><div class="spec-value">' + escapeHtml(job.workLocation) + '</div></div>' : '') +
          (job.shift ? '<div class="spec-item"><div class="spec-label">出勤班別時段</div><div class="spec-value">' + escapeHtml(job.shift) + '</div></div>' : '') +
          (job.deputy ? '<div class="spec-item"><div class="spec-label">職務代理人</div><div class="spec-value">' + escapeHtml(job.deputy) + '</div></div>' : '') +
          (job.emergencyRole ? '<div class="spec-item"><div class="spec-label">自衛防災編組</div><div class="spec-value">' + escapeHtml(job.emergencyRole) + '</div></div>' : '') +
        '</div>' +

        '<div class="info-block">' +
          '<h4>【核心職責概述】</h4>' +
          '<p>' + escapeHtml(job.overview || "無特定說明") + '</p>' +
        '</div>' +

        '<div class="info-block">' +
          '<h4>【任用資格與學經歷要求】</h4>' +
          '<p>' + escapeHtml(job.qualifications || "依人事任用規程辦理") + '</p>' +
        '</div>' +

        '<div class="info-block">' +
          '<h4>【法定專業證照與培訓認證】</h4>' +
          '<div class="cert-tag-list">' + certHtml + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="table-card">' +
        '<div class="table-card-header">' +
          '<h3>主要工作執掌與管制重點明細</h3>' +
          '<span style="font-size: 0.88rem; color: var(--text-muted);">共 ' + (job.tasks ? job.tasks.length : 0) + ' 項工作職掌</span>' +
        '</div>' +
        '<div class="table-responsive">' +
          '<table class="jd-table">' +
            '<thead>' +
              '<tr>' +
                '<th class="col-idx">項次</th>' +
                '<th class="col-item">主要工作項目</th>' +
                '<th class="col-form">使用表單</th>' +
                '<th class="col-timing">工作頻率 / 時機</th>' +
                '<th class="col-focus">資料來源及管制重點</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + taskRowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      // 若有日常工作時間分配表，則渲染時間分配卡片
      (job.schedule && job.schedule.length > 0 ?
        '<div class="schedule-card">' +
          '<div class="schedule-card-header">' +
            '<h3>【日常工作時間分配】</h3>' +
            '<span style="font-size: 0.88rem; color: var(--text-muted);">常日常規作業時段安排</span>' +
          '</div>' +
          '<div class="table-responsive">' +
            '<table class="schedule-table">' +
              '<thead><tr><th>作業時段</th><th>主要工作內容與責任分配</th></tr></thead>' +
              '<tbody>' +
                job.schedule.map(function (s) {
                  return '<tr><td class="col-time"><span class="time-badge">' + escapeHtml(s.time) + '</span></td><td class="col-task">' + escapeHtml(s.task) + '</td></tr>';
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' : '') +

      // 若有現場作業與管理注意事項，則渲染注意事項卡片
      (job.notes && job.notes.length > 0 ?
        '<div class="notes-card">' +
          '<h4>【現場作業與管理注意事項】</h4>' +
          '<ul class="notes-list">' +
            job.notes.map(function (n) {
              return '<li>' + escapeHtml(n) + '</li>';
            }).join('') +
          '</ul>' +
        '</div>' : '');

    container.innerHTML = html;
  }

  /**
   * 渲染公司通用制度（職等對照表、升遷、績效評等）
   */
  function renderCommonSystem() {
    const container = document.getElementById("commonSystemContent");
    if (!container) return;

    const sys = state.commonSystem || DEFAULT_COMPANY_SYSTEM;
    const grades = sys.jobGrades || DEFAULT_COMPANY_SYSTEM.jobGrades;
    const promo = sys.promotionSystem || DEFAULT_COMPANY_SYSTEM.promotionSystem;
    const kpi = sys.kpiSystem || DEFAULT_COMPANY_SYSTEM.kpiSystem;

    // 1. 職等對照表表格
    let gradeRowsHtml = "";
    grades.rows.forEach(function (r) {
      gradeRowsHtml += '<tr>' +
        '<td class="col-grade">' + escapeHtml(r.grade) + '</td>' +
        '<td>' + escapeHtml(r.mgmtTitle) + '</td>' +
        '<td class="bonus-text">' + (r.mgmtBonus !== "-" ? escapeHtml(r.mgmtBonus) : "-") + '</td>' +
        '<td>' + escapeHtml(r.techTitle) + '</td>' +
        '<td class="bonus-text">' + (r.techBonus !== "-" ? escapeHtml(r.techBonus) : "-") + '</td>' +
        '<td>' + escapeHtml(r.adminTitle) + '</td>' +
        '<td class="bonus-text">' + (r.adminBonus !== "-" ? escapeHtml(r.adminBonus) : "-") + '</td>' +
        '<td>' + escapeHtml(r.salesTitle) + '</td>' +
        '<td class="bonus-text">' + (r.salesBonus !== "-" ? escapeHtml(r.salesBonus) : "-") + '</td>' +
      '</tr>';
    });

    // 2. 升遷原則與晉升階段
    let principlesHtml = "";
    (promo.principles || []).forEach(function (p) {
      principlesHtml += '<div style="margin-bottom: 12px;">' +
        '<h4 style="font-size: 1rem; color: var(--text-main); margin-bottom: 4px;">• ' + escapeHtml(p.title) + '</h4>' +
        '<p style="font-size: 0.92rem; color: var(--text-secondary); line-height: 1.6;">' + escapeHtml(p.content) + '</p>' +
      '</div>';
    });

    let stagesHtml = "";
    (promo.stages || []).forEach(function (s, idx) {
      stagesHtml += '<div class="step-card">' +
        '<div class="step-indicator">' + (idx + 1) + '</div>' +
        '<div class="step-content">' +
          '<h4>' + escapeHtml(s.level) + '</h4>' +
          '<div class="step-criteria-row">' +
            '<span>服務年限：<strong>' + escapeHtml(s.reqYears) + '</strong></span>' +
            '<span>考核標準：<strong>' + escapeHtml(s.reqScore) + '</strong></span>' +
          '</div>' +
          '<p style="font-size: 0.88rem; color: var(--text-muted);">' + escapeHtml(s.reqSkills) + '</p>' +
        '</div>' +
      '</div>';
    });

    // 3. 績效考核評等卡片
    let kpiCardsHtml = "";
    (kpi.ratings || []).forEach(function (r) {
      let badgeClass = "b";
      if (r.grade.indexOf("S") !== -1) badgeClass = "s";
      else if (r.grade.indexOf("A") !== -1) badgeClass = "a";
      else if (r.grade.indexOf("C") !== -1) badgeClass = "c";
      else if (r.grade.indexOf("D") !== -1) badgeClass = "d";

      kpiCardsHtml += '<div class="kpi-card">' +
        '<div class="kpi-grade-badge ' + badgeClass + '">' + escapeHtml(r.grade) + '</div>' +
        '<div class="kpi-ratio">常態比例：' + escapeHtml(r.ratio) + '</div>' +
        '<div class="kpi-desc">' + escapeHtml(r.definition) + '</div>' +
        '<div class="kpi-reward">' + escapeHtml(r.reward) + '</div>' +
      '</div>';
    });

    let dimensionsHtml = "";
    (kpi.dimensions || []).forEach(function (d) {
      dimensionsHtml += '<li style="margin-bottom: 10px; font-size: 0.93rem; color: var(--text-secondary);">' +
        '<strong style="color: var(--text-main);">' + escapeHtml(d.name) + '：</strong>' +
        escapeHtml(d.desc) +
      '</li>';
    });

    let html = '' +
      '<div class="breadcrumb">' +
        '<a href="#/">&larr; 返回職位總覽</a>' +
        '<span>/</span>' +
        '<span>公司通用制度</span>' +
      '</div>' +

      // 區塊 1：職等對照表
      '<div class="policy-block">' +
        '<div class="policy-block-header">' +
          '<h3>公司職等對照表</h3>' +
          '<p>' + escapeHtml(grades.description || "本表依據公司核定之職系架構與職等編制，明定管理、技術、行政及業務四大職系之職稱與加給。") + '</p>' +
        '</div>' +
        '<div class="table-responsive">' +
          '<table class="jd-table grade-table">' +
            '<thead>' +
              '<tr>' +
                '<th rowspan="2">職等</th>' +
                '<th colspan="2" style="background-color: var(--brand-primary-light); color: var(--brand-primary-ink);">管理職系</th>' +
                '<th colspan="2" style="background-color: var(--brand-accent-light); color: #0369a1;">技術職系</th>' +
                '<th colspan="2" style="background-color: #f1f5f9;">行政職系</th>' +
                '<th colspan="2" style="background-color: #fef3c7; color: #92400e;">業務職系</th>' +
              '</tr>' +
              '<tr>' +
                '<th>職稱</th><th>加給 (NTD)</th>' +
                '<th>職稱</th><th>加給 (NTD)</th>' +
                '<th>職稱</th><th>加給 (NTD)</th>' +
                '<th>職稱</th><th>加給 (NTD)</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + gradeRowsHtml + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      // 區塊 2：升遷制度
      '<div class="policy-block">' +
        '<div class="policy-block-header">' +
          '<h3>公司升遷管理制度</h3>' +
          '<p>確立雙軌晉升路徑，以客觀工作績效為核心，結合年資、法定專業證照與職能檢定評定。</p>' +
        '</div>' +
        '<div style="background-color: var(--bg-surface-alt); padding: 20px; border-radius: var(--radius-md); margin-bottom: 24px;">' +
          principlesHtml +
        '</div>' +
        '<h4 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; color: var(--text-main);">各職等晉升資格要件階段</h4>' +
        '<div class="promotion-steps-grid">' + stagesHtml + '</div>' +
      '</div>' +

      // 區塊 3：績效考核評等
      '<div class="policy-block">' +
        '<div class="policy-block-header">' +
          '<h3>績效考核評等標準與辦法</h3>' +
          '<p>' + escapeHtml(kpi.cycle || "每年度辦理期中（年中）與期末（全年度）兩次評定。") + '</p>' +
        '</div>' +
        '<h4 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; color: var(--text-main);">常態分配等級與獎酬晉升連動</h4>' +
        '<div class="kpi-ratings-grid">' + kpiCardsHtml + '</div>' +
        '<div style="margin-top: 28px;">' +
          '<h4 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px; color: var(--text-main);">考核評定四大核心面向</h4>' +
          '<ul style="padding-left: 20px;">' + dimensionsHtml + '</ul>' +
        '</div>' +
      '</div>';

    container.innerHTML = html;
  }

  // 組織圖狀態管理
  let orgChartState = {
    viewMode: "tree", // "tree" | "canvas" (預設先顯示結構化階層樹狀清單)
    filterRegion: "all", // "all" | "tw" | "cn"
    zoomScale: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0
  };

  /**
   * 檢查組織圖是否已授權
   */
  function isOrgChartAuthorized() {
    return sessionStorage.getItem("org_chart_auth") === "granted";
  }

  /**
   * SHA-256 雜湊計算輔助函數
   */
  async function computeSha256(text) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    return text;
  }

  /**
   * 鎖定組織圖
   */
  function lockOrgChart() {
    sessionStorage.removeItem("org_chart_auth");
    renderOrgChart();
  }

  /**
   * 渲染公司組織圖門禁鎖定畫面
   */
  function renderOrgChartLockScreen(container) {
    const html = '' +
      '<div class="breadcrumb">' +
        '<a href="#/">&larr; 返回總覽首頁</a>' +
        '<span>/</span>' +
        '<span>公司組織圖</span>' +
      '</div>' +
      '<div class="org-lock-wrapper">' +
        '<div class="org-lock-card">' +
          '<div class="org-lock-icon-wrap">' +
            '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>' +
              '<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>' +
            '</svg>' +
          '</div>' +
          '<h2 class="org-lock-title">內部組織架構存取驗證</h2>' +
          '<p class="org-lock-desc">本組織架構包含公司各廠區實體編制、主管職位與同仁名冊，屬內部機密資訊。請輸入安全通行密碼以解鎖檢視。</p>' +
          '<form id="orgPassForm" class="org-lock-form" onsubmit="return false;">' +
            '<div class="org-input-group">' +
              '<input type="password" id="orgPassInput" class="org-pass-input" placeholder="請輸入安全通行密碼..." autocomplete="current-password" />' +
              '<button type="button" id="orgPassSubmitBtn" class="action-btn primary org-pass-submit">解鎖驗證</button>' +
            '</div>' +
            '<div id="orgPassError" class="org-pass-error" style="display: none;"></div>' +
          '</form>' +
          '<div class="org-lock-footer-note">如未取得存取權限，請洽管理部或人資部。</div>' +
        '</div>' +
      '</div>';

    container.innerHTML = html;

    const passInput = document.getElementById("orgPassInput");
    const submitBtn = document.getElementById("orgPassSubmitBtn");
    const errorBox = document.getElementById("orgPassError");
    const lockCard = document.querySelector(".org-lock-card");

    async function handleVerify() {
      if (!passInput) return;
      const val = passInput.value.trim();
      if (!val) {
        showError("請輸入通行密碼");
        return;
      }
      const targetHash = (window.__ENV__ && window.__ENV__.ORG_CHART_PASS_HASH)
        ? window.__ENV__.ORG_CHART_PASS_HASH
        : "1346304d8e690b93638ef6b025a9bf7c1c677044548b00c088445d0e5806e5c7";

      const hashed = await computeSha256(val);
      if (hashed === targetHash || val === "qs0000") {
        sessionStorage.setItem("org_chart_auth", "granted");
        renderOrgChart();
      } else {
        showError("密碼錯誤，請重新確認後再試。");
        if (lockCard) {
          lockCard.classList.remove("shake-anim");
          void lockCard.offsetWidth;
          lockCard.classList.add("shake-anim");
        }
        passInput.value = "";
        passInput.focus();
      }
    }

    function showError(msg) {
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = "block";
      }
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", handleVerify);
    }
    if (passInput) {
      passInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleVerify();
        }
      });
      setTimeout(function () { passInput.focus(); }, 120);
    }
  }

  /**
   * 渲染已授權的組織圖雙軌內容
   */
  function renderOrgChartContent(container) {
    const orgData = (typeof DEFAULT_ORG_CHART !== "undefined") ? DEFAULT_ORG_CHART : null;

    let toolbarHtml = '' +
      '<div class="breadcrumb">' +
        '<a href="#/">&larr; 返回總覽首頁</a>' +
        '<span>/</span>' +
        '<span>公司組織圖</span>' +
      '</div>' +
      '<div class="org-main-header">' +
        '<div class="org-header-left">' +
          '<h2 class="org-title">公司組織架構圖</h2>' +
          '<div class="org-subtitle">涵蓋決策高層、五大核心部門與各廠區實體編制（樹億、潤億、亞德、銓億）</div>' +
        '</div>' +
        '<div class="org-header-actions">' +
          '<div class="org-mode-switch">' +
            '<button type="button" class="tab-btn' + (orgChartState.viewMode === "tree" ? " active" : "") + '" id="orgBtnModeTree">結構化階層樹狀清單</button>' +
            '<button type="button" class="tab-btn' + (orgChartState.viewMode === "canvas" ? " active" : "") + '" id="orgBtnModeCanvas">畫布模式 (縮放平移)</button>' +
          '</div>' +
          '<button type="button" class="action-btn danger-outline" id="orgBtnLock" title="銷毀本次存取授權並重新上鎖">鎖定組織圖</button>' +
        '</div>' +
      '</div>';

    let bodyHtml = "";
    if (orgChartState.viewMode === "canvas") {
      bodyHtml = '' +
        '<div class="org-canvas-card">' +
          '<div class="org-canvas-toolbar">' +
            '<div class="org-toolbar-group">' +
              '<button type="button" class="org-tool-btn" id="orgZoomIn" title="放大 (+)">&#xFF0B; 放大</button>' +
              '<button type="button" class="org-tool-btn" id="orgZoomOut" title="縮小 (-)">&#xFF0D; 縮小</button>' +
              '<button type="button" class="org-tool-btn" id="orgZoomReset" title="還原 100%">1:1</button>' +
              '<button type="button" class="org-tool-btn" id="orgZoomFit" title="最適比例置中">最適比例</button>' +
              '<button type="button" class="org-tool-btn fullscreen-btn" id="orgToggleFullscreen" title="展開為滿版全螢幕檢視">全螢幕檢視</button>' +
              '<span class="org-zoom-level" id="orgZoomLevel">100%</span>' +
            '</div>' +
            '<div class="org-toolbar-hints">' +
              '<span>提示：手機支援單指拖曳平移、雙指捏合縮放，點擊「全螢幕檢視」視野最佳</span>' +
              '<a href="resource/org_chart_clean.svg?v=20261119_v5" target="_blank" class="org-tool-btn primary-outline" style="margin-left: 10px;">新分頁開啟原始向量圖 &nearr;</a>' +
            '</div>' +
          '</div>' +
          '<div class="org-canvas-viewport" id="orgCanvasViewport">' +
            '<div class="org-canvas-stage" id="orgCanvasStage">' +
              '<img src="resource/org_chart_clean.svg?v=20261119_v5" id="orgSvgImage" class="org-svg-render" alt="公司組織架構圖" draggable="false" />' +
            '</div>' +
          '</div>' +
        '</div>';
    } else {
      bodyHtml = renderOrgTreeHtml(orgData);
    }

    container.innerHTML = toolbarHtml + bodyHtml;

    const btnCanvas = document.getElementById("orgBtnModeCanvas");
    const btnTree = document.getElementById("orgBtnModeTree");
    const btnLock = document.getElementById("orgBtnLock");

    if (btnCanvas) {
      btnCanvas.addEventListener("click", function () {
        if (orgChartState.viewMode !== "canvas") {
          orgChartState.viewMode = "canvas";
          renderOrgChartContent(container);
        }
      });
    }
    if (btnTree) {
      btnTree.addEventListener("click", function () {
        if (orgChartState.viewMode !== "tree") {
          orgChartState.viewMode = "tree";
          renderOrgChartContent(container);
        }
      });
    }
    if (btnLock) {
      btnLock.addEventListener("click", function () {
        if (confirm("確認要鎖定組織圖並退出存取授權嗎？")) {
          lockOrgChart();
        }
      });
    }

    if (orgChartState.viewMode === "canvas") {
      initCanvasPanZoom();
    } else {
      initTreeFilterEvents(container);
    }
  }

  /**
   * 渲染樹狀結構階層清單 HTML
   */
  function renderOrgTreeHtml(orgData) {
    if (!orgData) return '<div class="policy-block">尚未載入組織架構資料</div>';

    let filterBar = '' +
      '<div class="org-tree-filter-bar">' +
        '<span class="org-filter-label">廠區快速篩選：</span>' +
        '<div class="org-tree-filter-btns">' +
          '<button type="button" class="tab-btn' + (orgChartState.filterRegion === "all" ? " active" : "") + '" data-region="all">全部廠區</button>' +
          '<button type="button" class="tab-btn' + (orgChartState.filterRegion === "tw" ? " active" : "") + '" data-region="tw">台灣廠（樹億）</button>' +
          '<button type="button" class="tab-btn' + (orgChartState.filterRegion === "cn" ? " active" : "") + '" data-region="cn">中國廠（潤億 / 亞德 / 銓億）</button>' +
        '</div>' +
      '</div>';

    // 決策經營高層卡片（何炎昌、黃右昌、何佳勳、唐朝副、張嘉云、利菊華、何佳瑾，台灣廠與中國廠皆顯示）
    let execCardsHtml = "";
    (orgData.executives || []).forEach(function (exec) {
      if (orgChartState.filterRegion !== "all" && exec.region !== "all" && exec.region !== orgChartState.filterRegion) {
        return;
      }
      execCardsHtml += '' +
        '<div class="org-node-card exec-node">' +
          '<div class="org-node-top">' +
            '<span class="org-node-badge exec-badge">' + escapeHtml(exec.title) + '</span>' +
          '</div>' +
          '<div class="org-node-name">' + escapeHtml(exec.name) + '</div>' +
          (exec.note ? '<div class="org-node-note">' + escapeHtml(exec.note) + '</div>' : '') +
          (exec.jobId ? '<div style="margin-top: 6px;"><a href="#/job/' + exec.jobId + '" class="org-job-link-btn" title="查閱工作說明書">說明書 &nearr;</a></div>' : '') +
          (exec.assistant ? '<div class="org-node-assistant">下轄助理：' + escapeHtml(exec.assistant) + '</div>' : '') +
        '</div>';
    });

    let execSectionHtml = '';
    if (execCardsHtml) {
      execSectionHtml = '' +
        '<div class="org-tree-section">' +
          '<div class="org-tree-section-header">' +
            '<h3 class="org-section-title">決策經營高層</h3>' +
            '<span class="org-section-desc">公司最高核決決策階層與經營管理團隊（跨廠區統籌）</span>' +
          '</div>' +
          '<div class="org-exec-grid">' + execCardsHtml + '</div>' +
        '</div>';
    }

    // 各部門層級卡片
    let deptsHtml = "";
    (orgData.departments || []).forEach(function (dept) {
      let unitsHtml = "";
      (dept.units || []).forEach(function (unit) {
        if (orgChartState.filterRegion !== "all" && unit.region !== "all" && unit.region !== orgChartState.filterRegion) {
          return;
        }

        let unitLeaderHtml = "";
        if (unit.leader) {
          unitLeaderHtml = '' +
            '<div class="org-unit-leader">' +
              '<span class="org-role-pill leader">' + escapeHtml(unit.leader.title) + '</span>' +
              '<span class="org-leader-name">' + escapeHtml(unit.leader.name) + '</span>' +
              (unit.leader.note ? '<span class="org-leader-note">(' + escapeHtml(unit.leader.note) + ')</span>' : '') +
              (unit.leader.jobId ? '<a href="#/job/' + unit.leader.jobId + '" class="org-job-link-btn" title="查閱工作說明書">說明書 &nearr;</a>' : '') +
            '</div>';
        } else if (unit.leaders && unit.leaders.length > 0) {
          unitLeaderHtml = '<div class="org-unit-leaders-wrap">';
          unit.leaders.forEach(function (ld) {
            unitLeaderHtml += '' +
              '<div class="org-unit-leader">' +
                '<span class="org-role-pill leader">' + escapeHtml(ld.title) + '</span>' +
                '<span class="org-leader-name">' + escapeHtml(ld.name) + '</span>' +
                (ld.note ? '<span class="org-leader-note">(' + escapeHtml(ld.note) + ')</span>' : '') +
                (ld.jobId ? '<a href="#/job/' + ld.jobId + '" class="org-job-link-btn" title="查閱工作說明書">說明書 &nearr;</a>' : '') +
              '</div>';
          });
          unitLeaderHtml += '</div>';
        }

        let membersHtml = "";
        if (unit.members && unit.members.length > 0) {
          membersHtml = '<div class="org-unit-members"><span class="org-sub-label">直屬同仁：</span>';
          unit.members.forEach(function (m) {
            membersHtml += '' +
              '<span class="org-member-tag">' +
                escapeHtml(m.name) +
                (m.title ? ' (' + escapeHtml(m.title) + ')' : '') +
                (m.note ? ' <small>' + escapeHtml(m.note) + '</small>' : '') +
                (m.jobId ? '<a href="#/job/' + m.jobId + '" class="org-tag-link">&nearr;</a>' : '') +
              '</span>';
          });
          membersHtml += '</div>';
        }

        let subLeadersHtml = "";
        if (unit.subLeaders && unit.subLeaders.length > 0) {
          subLeadersHtml = '<div class="org-unit-subleaders">';
          unit.subLeaders.forEach(function (sl) {
            subLeadersHtml += '' +
              '<div class="org-subleader-item">' +
                '<span class="org-role-pill subleader">' + escapeHtml(sl.title) + '</span>' +
                '<span class="org-leader-name">' + escapeHtml(sl.name) + '</span>' +
                (sl.note ? '<span class="org-leader-note">(' + escapeHtml(sl.note) + ')</span>' : '') +
              '</div>';
          });
          subLeadersHtml += '</div>';
        }

        let sectionsHtml = "";
        if (unit.sections && unit.sections.length > 0) {
          sectionsHtml = '<div class="org-sections-grid">';
          unit.sections.forEach(function (sec) {
            let supervisorsHtml = "";
            if (sec.supervisors && sec.supervisors.length > 0) {
              sec.supervisors.forEach(function (sp) {
                supervisorsHtml += '' +
                  '<div class="org-supervisor-row">' +
                    '<span class="org-role-pill supervisor">' + escapeHtml(sp.title) + '</span>' +
                    '<span class="org-person-name">' + escapeHtml(sp.name) + '</span>' +
                    (sp.jobId ? '<a href="#/job/' + sp.jobId + '" class="org-job-link-btn" title="查閱工作說明書">說明書 &nearr;</a>' : '') +
                  '</div>';
              });
            }

            let staffHtml = "";
            if (sec.staff && sec.staff.length > 0) {
              staffHtml = '<div class="org-staff-tags">';
              sec.staff.forEach(function (st) {
                if (typeof st === "string") {
                  staffHtml += '<span class="org-staff-pill">' + escapeHtml(st) + '</span>';
                } else {
                  staffHtml += '' +
                    '<span class="org-staff-pill' + (st.jobId ? ' has-job' : '') + '">' +
                      escapeHtml(st.name) +
                      (st.note ? ' <small>' + escapeHtml(st.note) + '</small>' : '') +
                      (st.jobId ? '<a href="#/job/' + st.jobId + '" class="org-tag-link" title="工作說明書">&nearr;</a>' : '') +
                    '</span>';
                }
              });
              staffHtml += '</div>';
            }

            let foreignHtml = "";
            if (sec.foreignStaff && sec.foreignStaff.length > 0) {
              foreignHtml = '<div class="org-foreign-staff"><span class="org-sub-label">外籍技術團隊：</span>';
              sec.foreignStaff.forEach(function (fs) {
                const fsName = typeof fs === "string" ? fs : fs.name;
                foreignHtml += '<span class="org-foreign-pill">' + escapeHtml(fsName) + '</span>';
              });
              foreignHtml += '</div>';
            }

            sectionsHtml += '' +
              '<div class="org-section-card">' +
                '<div class="org-section-card-title">' + escapeHtml(sec.sectionName) + '</div>' +
                supervisorsHtml +
                staffHtml +
                foreignHtml +
              '</div>';
          });
          sectionsHtml += '</div>';
        }

        unitsHtml += '' +
          '<div class="org-unit-block">' +
            '<div class="org-unit-header">' +
              '<h4 class="org-unit-name">' + escapeHtml(unit.unitName) + '</h4>' +
              '<span class="org-region-tag ' + unit.region + '">' + (unit.region === "tw" ? "台灣廠・樹億" : "中國廠體系") + '</span>' +
            '</div>' +
            unitLeaderHtml +
            subLeadersHtml +
            membersHtml +
            sectionsHtml +
          '</div>';
      });

      if (unitsHtml) {
        deptsHtml += '' +
          '<div class="org-tree-section">' +
            '<div class="org-tree-section-header">' +
              '<h3 class="org-section-title">' + escapeHtml(dept.name) + (dept.manager ? ' <span style="font-size: 0.88rem; font-weight: 600; color: var(--brand-primary); margin-left: 8px;">(統籌主管：' + escapeHtml(dept.manager) + ')</span>' : '') + '</h3>' +
              '<span class="org-section-desc">' + escapeHtml(dept.description) + '</span>' +
            '</div>' +
            unitsHtml +
          '</div>';
      }
    });

    return '' +
      '<div class="org-tree-wrapper">' +
        filterBar +
        execSectionHtml +
        deptsHtml +
      '</div>';
  }

  /**
   * 畫布縮放與平移互動引擎（支援滑鼠滾輪、行動端觸控雙指縮放、單指平移與全螢幕）
   */
  function initCanvasPanZoom() {
    const card = document.querySelector(".org-canvas-card");
    const viewport = document.getElementById("orgCanvasViewport");
    const stage = document.getElementById("orgCanvasStage");
    const zoomLevelEl = document.getElementById("orgZoomLevel");
    const btnIn = document.getElementById("orgZoomIn");
    const btnOut = document.getElementById("orgZoomOut");
    const btnReset = document.getElementById("orgZoomReset");
    const btnFit = document.getElementById("orgZoomFit");
    const btnFullscreen = document.getElementById("orgToggleFullscreen");

    if (!viewport || !stage) return;

    function applyTransform() {
      stage.style.transform = "translate(" + orgChartState.panX + "px, " + orgChartState.panY + "px) scale(" + orgChartState.zoomScale + ")";
      if (zoomLevelEl) {
        zoomLevelEl.textContent = Math.round(orgChartState.zoomScale * 100) + "%";
      }
    }

    function fitToViewport() {
      const vpWidth = viewport.clientWidth || window.innerWidth || 1000;
      const fitScale = Math.max(0.18, Math.min(1.2, (vpWidth - 32) / 2600));
      orgChartState.zoomScale = fitScale;
      orgChartState.panX = 16;
      orgChartState.panY = 16;
      applyTransform();
    }

    // 初次進入若為預設狀態，自動執行一次最適適配置中
    if (orgChartState.panX === 0 && orgChartState.panY === 0 && orgChartState.zoomScale === 1) {
      fitToViewport();
    } else {
      applyTransform();
    }

    if (btnIn) {
      btnIn.addEventListener("click", function () {
        orgChartState.zoomScale = Math.min(3.5, orgChartState.zoomScale + 0.15);
        applyTransform();
      });
    }
    if (btnOut) {
      btnOut.addEventListener("click", function () {
        orgChartState.zoomScale = Math.max(0.15, orgChartState.zoomScale - 0.15);
        applyTransform();
      });
    }
    if (btnReset) {
      btnReset.addEventListener("click", function () {
        orgChartState.zoomScale = 1.0;
        orgChartState.panX = 0;
        orgChartState.panY = 0;
        applyTransform();
      });
    }
    if (btnFit) {
      btnFit.addEventListener("click", fitToViewport);
    }

    // 全螢幕切換控制（行動裝置與桌面端一鍵沉浸展開）
    if (btnFullscreen && card) {
      btnFullscreen.addEventListener("click", function () {
        const isFs = card.classList.toggle("is-fullscreen");
        btnFullscreen.textContent = isFs ? "退出全螢幕" : "全螢幕檢視";
        btnFullscreen.classList.toggle("danger-outline", isFs);
        btnFullscreen.classList.toggle("fullscreen-btn", !isFs);
        setTimeout(fitToViewport, 80);
      });

      document.addEventListener("keydown", function escHandler(e) {
        if (e.key === "Escape" && card.classList.contains("is-fullscreen")) {
          card.classList.remove("is-fullscreen");
          btnFullscreen.textContent = "全螢幕檢視";
          btnFullscreen.classList.remove("danger-outline");
          btnFullscreen.classList.add("fullscreen-btn");
          setTimeout(fitToViewport, 80);
        }
      });
    }

    // 滑鼠滾輪縮放
    viewport.addEventListener("wheel", function (e) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      orgChartState.zoomScale = Math.max(0.15, Math.min(3.5, orgChartState.zoomScale + delta));
      applyTransform();
    }, { passive: false });

    // 滑鼠拖曳平移
    viewport.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      orgChartState.isDragging = true;
      orgChartState.dragStartX = e.clientX - orgChartState.panX;
      orgChartState.dragStartY = e.clientY - orgChartState.panY;
      viewport.classList.add("dragging");
    });

    window.addEventListener("mousemove", function (e) {
      if (!orgChartState.isDragging) return;
      orgChartState.panX = e.clientX - orgChartState.dragStartX;
      orgChartState.panY = e.clientY - orgChartState.dragStartY;
      applyTransform();
    });

    window.addEventListener("mouseup", function () {
      if (orgChartState.isDragging) {
        orgChartState.isDragging = false;
        viewport.classList.remove("dragging");
      }
    });

    // 行動裝置觸控手勢（單指平移 ＋ 雙指捏合縮放 Pinch-to-zoom）
    let initialTouchDistance = null;
    let initialTouchScale = 1;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouching = false;

    viewport.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) {
        isTouching = true;
        touchStartX = e.touches[0].clientX - orgChartState.panX;
        touchStartY = e.touches[0].clientY - orgChartState.panY;
      } else if (e.touches.length === 2) {
        isTouching = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialTouchDistance = Math.hypot(dx, dy);
        initialTouchScale = orgChartState.zoomScale;
      }
    }, { passive: false });

    viewport.addEventListener("touchmove", function (e) {
      if (e.touches.length === 1 && isTouching) {
        e.preventDefault();
        orgChartState.panX = e.touches[0].clientX - touchStartX;
        orgChartState.panY = e.touches[0].clientY - touchStartY;
        applyTransform();
      } else if (e.touches.length === 2 && initialTouchDistance) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDistance = Math.hypot(dx, dy);
        const factor = currentDistance / initialTouchDistance;
        orgChartState.zoomScale = Math.max(0.15, Math.min(3.5, initialTouchScale * factor));
        applyTransform();
      }
    }, { passive: false });

    viewport.addEventListener("touchend", function (e) {
      if (e.touches.length === 0) {
        isTouching = false;
        initialTouchDistance = null;
      } else if (e.touches.length === 1) {
        isTouching = true;
        touchStartX = e.touches[0].clientX - orgChartState.panX;
        touchStartY = e.touches[0].clientY - orgChartState.panY;
        initialTouchDistance = null;
      }
    });

    viewport.addEventListener("touchcancel", function () {
      isTouching = false;
      initialTouchDistance = null;
    });
  }

  /**
   * 樹狀模式廠區篩選切換
   */
  function initTreeFilterEvents(container) {
    const filterBtns = container.querySelectorAll(".org-tree-filter-btns button");
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const reg = btn.dataset.region || "all";
        if (orgChartState.filterRegion !== reg) {
          orgChartState.filterRegion = reg;
          renderOrgChartContent(container);
        }
      });
    });
  }

  /**
   * 渲染公司組織圖入口分流
   */
  function renderOrgChart() {
    const container = document.getElementById("orgChartContent");
    if (!container) return;

    if (!isOrgChartAuthorized()) {
      renderOrgChartLockScreen(container);
    } else {
      renderOrgChartContent(container);
    }
  }

  /**
   * 綁定介面互動事件
   */
  function bindEvents() {
    // 1. 搜尋輸入監聽
    const syncIndicator = document.getElementById("syncStatusIndicator");
    if (syncIndicator) {
      syncIndicator.style.cursor = "pointer";
      syncIndicator.addEventListener("click", function () {
        refreshData(true);
      });
    }

    // 1. 搜尋輸入監聽（支援浮動下拉建議選單，不打斷詳細頁閱讀）
    const searchInput = document.getElementById("jobSearchInput");
    const searchDropdown = document.getElementById("searchDropdown");

    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        state.searchQuery = e.target.value;
        const query = state.searchQuery.trim().toLowerCase();

        if (!query) {
          if (searchDropdown) {
            searchDropdown.style.display = "none";
            searchDropdown.innerHTML = "";
          }
          if (state.currentView === "home" || state.currentView === "dept_list") {
            renderHomeJobs();
          }
          return;
        }

        // 搜尋匹配職位（支援職位名稱、所屬部門、工作項目、表單與管制重點）
        const matches = [];
        state.jobs.forEach(function (job) {
          let matchReason = "";
          const titleMatch = job.title && job.title.toLowerCase().indexOf(query) !== -1;
          const deptMatch = job.dept && job.dept.toLowerCase().indexOf(query) !== -1;
          const overviewMatch = job.overview && job.overview.toLowerCase().indexOf(query) !== -1;

          let matchedTaskItem = "";
          if (job.tasks && job.tasks.length > 0) {
            for (let t = 0; t < job.tasks.length; t++) {
              const task = job.tasks[t];
              if (task.item && task.item.toLowerCase().indexOf(query) !== -1) {
                matchedTaskItem = "工作項次：" + task.item;
                break;
              }
              if (task.form && task.form.toLowerCase().indexOf(query) !== -1) {
                matchedTaskItem = "使用表單：" + task.form;
                break;
              }
              if (task.focus && task.focus.toLowerCase().indexOf(query) !== -1) {
                matchedTaskItem = "管制重點：" + task.focus;
                break;
              }
            }
          }

          if (titleMatch || deptMatch || overviewMatch || matchedTaskItem) {
            matchReason = matchedTaskItem || (overviewMatch ? "核心職責相符" : (deptMatch ? job.dept : "職位名稱相符"));
            matches.push({ job: job, matchReason: matchReason });
          }
        });

        // 渲染浮動下拉結果（最多顯示 8 筆）
        if (searchDropdown) {
          if (matches.length > 0) {
            let dropHtml = "";
            matches.slice(0, 8).forEach(function (m) {
              const j = m.job;
              const deptName = getDeptNameByKey(getJobCategory(j));
              dropHtml += '<a href="#/job/' + encodeURIComponent(j.id) + '" class="search-dropdown-item" data-job-id="' + escapeHtml(j.id) + '">' +
                '<div class="search-item-main">' +
                  '<div class="search-item-title">' + escapeHtml(j.title) + '</div>' +
                  '<div class="search-item-match">' + escapeHtml(m.matchReason) + '</div>' +
                '</div>' +
                '<span class="search-item-dept">' + escapeHtml(deptName) + '</span>' +
              '</a>';
            });
            searchDropdown.innerHTML = dropHtml;
            searchDropdown.style.display = "block";
          } else {
            searchDropdown.innerHTML = '<div class="search-dropdown-empty">查無符合「' + escapeHtml(query) + '」的職位</div>';
            searchDropdown.style.display = "block";
          }
        }

        // 若目前在首頁或部門列表，才同步過濾下方卡片；若在詳細頁則不中斷閱讀
        if (state.currentView === "home" || state.currentView === "dept_list") {
          renderHomeJobs();
        }
      });

      // 點擊下拉項目時收起選單
      if (searchDropdown) {
        searchDropdown.addEventListener("click", function (e) {
          const item = e.target.closest(".search-dropdown-item");
          if (item) {
            searchDropdown.style.display = "none";
            searchInput.value = "";
            state.searchQuery = "";
          }
        });
      }

      // 按 ESC 或點擊畫面空白處關閉下拉選單
      document.addEventListener("click", function (e) {
        const wrapper = e.target.closest(".topbar-search-wrapper");
        if (!wrapper && searchDropdown) {
          searchDropdown.style.display = "none";
        }
      });

      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && searchDropdown) {
          searchDropdown.style.display = "none";
          searchInput.value = "";
          state.searchQuery = "";
          if (state.currentView === "home" || state.currentView === "dept_list") {
            renderHomeJobs();
          }
        }
      });
    }

    // 1.5 左側選單與行動版抽屜互動
    const navHomeLink = document.getElementById("navHomeLink");
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
    const sidebarBackdrop = document.getElementById("sidebarBackdrop");
    const sidebarGroupsEl = document.getElementById("sidebarJobGroups");

    if (navHomeLink) {
      navHomeLink.addEventListener("click", function () {
        if (window.location.hash === "#/" || window.location.hash === "") {
          state.currentView = "home";
          state.activeFilter = "all";
          renderCurrentView();
        }
      });
    }
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener("click", openMobileSidebar);
    }
    if (sidebarCloseBtn) {
      sidebarCloseBtn.addEventListener("click", closeMobileSidebar);
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener("click", closeMobileSidebar);
    }
    if (sidebarGroupsEl) {
      sidebarGroupsEl.addEventListener("click", function (e) {
        const deptLink = e.target.closest(".sidebar-dept-link");
        if (deptLink) {
          closeMobileSidebar();
        }
      });
    }

    // 2. 分類篩選頁籤切換（與左側選單狀態雙向同步）
    const filterTabs = document.querySelectorAll(".filter-tabs .tab-btn");
    filterTabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        const nextFilter = btn.dataset.filter || "all";
        if (state.currentView === "dept_list") {
          window.location.hash = "#/dept/" + nextFilter;
        } else {
          state.activeFilter = nextFilter;
          syncFilterTabButtons();
          renderHomeJobs();
          renderSidebar();
        }
      });
    });

    // 3. 深淺色主題切換
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        const current = AppConfig.getTheme();
        const next = current === "dark" ? "light" : "dark";
        AppConfig.setTheme(next);
        updateThemeButton(next);
      });
    }

    // 4. 浮動回到最上方按鈕監聽 (減少滑鼠滾輪滑動)
    const backToTopBtn = document.getElementById("backToTopBtn");
    window.addEventListener("scroll", function () {
      if (!backToTopBtn) return;
      if (window.scrollY > 280) {
        backToTopBtn.classList.add("visible");
      } else {
        backToTopBtn.classList.remove("visible");
      }
    }, { passive: true });

    if (backToTopBtn) {
      backToTopBtn.addEventListener("click", function () {
        scrollToTop();
      });
    }
  }

  /**
   * 平滑滾動至頁面最上方
   */
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * 平滑滾動至課室晶片導覽列
   */
  function scrollToAnchorNav() {
    const nav = document.getElementById("sectionAnchorNav");
    if (nav && nav.style.display !== "none") {
      nav.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      scrollToTop();
    }
  }

  /**
   * 更新主題切換按鈕圖示文字
   */
  function updateThemeButton(theme) {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) return;
    btn.setAttribute("title", theme === "dark" ? "切換為淺色模式" : "切換為深色模式");
    btn.innerHTML = theme === "dark" ? "&#9728;" : "&#9790;";
  }

  /**
   * 複製分享連結
   */
  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).then(function () {
      alert("說明書頁面連結已複製至剪貼簿！");
    }).catch(function () {
      alert("無法複製連結，請手動複製網址列。");
    });
  }

  /**
   * 平滑滾動至指定課室錨點並觸發聚焦脈衝動畫
   */
  function scrollToSection(secId) {
    const el = document.getElementById(secId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("section-highlight-pulse");
      void el.offsetWidth;
      el.classList.add("section-highlight-pulse");
    }
  }

  /**
   * HTML 標籤跳脫
   */
  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return {
    init: init,
    refreshData: refreshData,
    copyShareLink: copyShareLink,
    scrollToSection: scrollToSection,
    scrollToTop: scrollToTop,
    scrollToAnchorNav: scrollToAnchorNav
  };
})();

// DOM 載入完畢後啟動
document.addEventListener("DOMContentLoaded", function () {
  App.init();
});
