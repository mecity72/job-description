/**
 * 工作說明書系統 - 前端主控制器 (Main App Controller)
 * 負責路由解析、資料渲染、搜尋過濾、模組互動與主題切換
 */

const App = (function () {
  // 核心狀態
  let state = {
    jobs: [],
    commonSystem: null,
    departments: [],
    currentView: "home", // "home" | "job_detail" | "common_system"
    currentJobId: null,
    activeFilter: "all",
    searchQuery: "",
    collapsedGroups: {},
    isLoading: true
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

    // 4. 檢查管理員模式權限與網址參數
    checkAdminModeOnLoad();

    // 5. 載入資料（SWR 本地快取優先秒開）
    await refreshData(false);

    // 6. 執行初始路由
    handleRouting();
  }

  /**
   * 重新整理資料（支援 SWR 架構，背景無感靜默重新驗證）
   */
  async function refreshData(force) {
    if (force) {
      updateSyncStatus("loading", "正在強制同步 Google Sheets…");
    } else {
      updateSyncStatus("loading", "正在讀取資料庫…");
    }

    const result = await JobApi.loadAllData(force, handleBackgroundDataUpdate);
    applyDataResult(result);
  }

  /**
   * 套用資料結果至應用程式狀態並重新渲染
   */
  function applyDataResult(result) {
    state.jobs = result.jobs || [];
    state.commonSystem = result.commonSystem || DEFAULT_COMPANY_SYSTEM;
    state.departments = result.departments || [];
    state.isLoading = false;

    if (result.source === "google_sheets") {
      updateSyncStatus("connected", "Google Sheets 已連線 (已同步最新)");
    } else if (result.source === "local_cache") {
      updateSyncStatus("connected", "已載入本地快取 (0 秒秒開)");
    } else {
      updateSyncStatus("offline", "本機離線模式");
    }

    renderDepartmentSpreadsheetsList();
    renderCurrentView();
  }

  /**
   * SWR 背景驗證完成回呼
   */
  function handleBackgroundDataUpdate(freshResult) {
    applyDataResult(freshResult);
  }

  /**
   * 更新頂部連線狀態燈
   */
  function updateSyncStatus(status, text) {
    const el = document.getElementById("syncStatusIndicator");
    if (!el) return;
    el.className = "sync-indicator " + status;
    const textEl = el.querySelector(".sync-text");
    if (textEl) textEl.textContent = text;
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

    // 2. 技術部（分為：技術部、品管課、研發課）
    if (cat === "tech_dept") {
      if (id.indexOf("qc_") === 0 || lookup.indexOf("品管課") !== -1) return "技術部・品管課";
      if (id.indexOf("rd_") === 0 || lookup.indexOf("研發課") !== -1) return "技術部・研發課";
      return "技術部";
    }

    // 3. 營業部
    if (cat === "sales_dept") {
      return "營業部";
    }

    // 4. 管理部（分為：管理部、營管課、採購課、財務課）
    if (cat === "mgmt_dept") {
      if (id === "biz_admin" || lookup.indexOf("營管課") !== -1) return "管理部・營管課";
      if (id === "procurement" || lookup.indexOf("採購課") !== -1) return "管理部・採購課";
      if (id === "finance" || lookup.indexOf("財務課") !== -1) return "管理部・財務課";
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

    return groups;
  }

  /**
   * 依職位性質回傳對應之向量圖示與色調樣式
   */
  function getJobIconMeta(job) {
    const title = (job && job.title) ? job.title : "";
    const dept = getJobSectionTitle(job) + " " + ((job && job.dept) ? job.dept : "");
    const id = (job && job.id) ? job.id : "";

    // 1. 管理職與基層幹部（副理、經理、課長、副課長、組長）
    if (/(副理|經理|課長|組長)/.test(title) && id.indexOf("sales") === -1) {
      return {
        variant: "icon-mgmt",
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>'
      };
    }

    // 2. 包裝與洗槽作業
    if (dept.indexOf("包裝課") !== -1) {
      return {
        variant: "icon-pkg",
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>'
      };
    }

    // 3. 製造反應、製程技術與配方研發
    if (dept.indexOf("製造課") !== -1 || dept.indexOf("研發") !== -1 || id === "tech_psa" || id === "tech_pu") {
      return {
        variant: "icon-chem",
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.52 16h12.96"></path></svg>'
      };
    }

    // 4. 倉管物流與品管檢驗
    if (dept.indexOf("倉管課") !== -1 || dept.indexOf("品管") !== -1) {
      return {
        variant: "icon-check",
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="m9 14 2 2 4-4"></path></svg>'
      };
    }

    // 5. 工務設備維修保養
    if (dept.indexOf("工務課") !== -1) {
      return {
        variant: "icon-tool",
        svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>'
      };
    }

    // 6. 生管、營業、營管、採購、財務、人資與總務
    return {
      variant: "icon-admin",
      svg: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line></svg>'
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
      grid.innerHTML = '<div class="empty-search-state">' +
        '<p class="empty-search-title">查無符合條件的職位</p>' +
        '<p class="empty-search-sub">請更換搜尋關鍵字或切換上方部門篩選頁籤。</p>' +
        '</div>';
      return;
    }

    const sectionGroups = groupJobsBySection(filtered);
    let html = "";

    sectionGroups.forEach(function (group) {
      html += '<div class="dept-section-block">';
      html += '  <div class="dept-section-heading">';
      html += '    <h3 class="dept-section-title">' + escapeHtml(group.title) + '</h3>';
      html += '    <span class="dept-section-count">' + group.items.length + ' 項職位</span>';
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
              '<div class="job-card-icon-box ' + iconMeta.variant + '" aria-hidden="true">' +
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

  /**
   * 渲染公司組織圖頁面（預留待新增框架）
   */
  function renderOrgChart() {
    const container = document.getElementById("orgChartContent");
    if (!container) return;

    const countsMap = getDepartmentCountsMap();
    let deptNodesHtml = "";
    DEPT_DEFINITIONS.forEach(function (dept) {
      const cnt = countsMap[dept.key] || 0;
      deptNodesHtml +=
        '<a href="#/dept/' + dept.key + '" class="org-dept-node">' +
          '<span class="sidebar-job-icon ' + dept.variant + '" aria-hidden="true">' + dept.svg + '</span>' +
          '<div class="org-dept-node-info">' +
            '<span class="org-dept-node-name">' + escapeHtml(dept.name) + '</span>' +
            '<span class="org-dept-node-count">現有 ' + cnt + ' 項職位說明書</span>' +
          '</div>' +
        '</a>';
    });

    const html = '' +
      '<div class="breadcrumb">' +
        '<a href="#/">&larr; 返回總覽首頁</a>' +
        '<span>/</span>' +
        '<span>公司組織圖</span>' +
      '</div>' +
      '<div class="policy-block org-placeholder-card">' +
        '<div class="org-placeholder-badge">預留擴充頁面</div>' +
        '<h2 class="org-placeholder-title">公司組織圖</h2>' +
        '<p class="org-placeholder-desc">' +
          '此頁面已預留作為公司正式組織系統圖與部門層級架構展示區，待後續核定組織圖檔或層級資料後即可掛載呈現。目前可先透過下方五大部門入口直接查閱各單位現有職位說明書。' +
        '</p>' +
        '<div class="org-dept-preview-grid">' +
          deptNodesHtml +
        '</div>' +
      '</div>';

    container.innerHTML = html;
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

    const searchInput = document.getElementById("jobSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        state.searchQuery = e.target.value;
        if (state.currentView !== "home" && state.currentView !== "dept_list" && state.searchQuery.trim() !== "") {
          state.currentView = "dept_list";
          state.activeFilter = "all";
          state.currentJobId = null;
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, "", "#/dept/all");
          }
          renderCurrentView();
        } else if (state.currentView === "home" || state.currentView === "dept_list") {
          renderHomeJobs();
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

    // 4. 管理員驗證與系統設定模組
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsModal = document.getElementById("settingsModal");
    const closeSettingsBtn = document.getElementById("closeSettingsBtn");
    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    const testSettingsBtn = document.getElementById("testSettingsBtn");
    const gasUrlInput = document.getElementById("gasUrlInput");
    const toggleGasUrlVisibilityBtn = document.getElementById("toggleGasUrlVisibilityBtn");
    const refreshCacheBtn = document.getElementById("refreshCacheBtn");
    const cacheControlResult = document.getElementById("cacheControlResult");
    const logoutAdminBtn = document.getElementById("logoutAdminBtn");

    const adminAuthModal = document.getElementById("adminAuthModal");
    const closeAdminAuthBtn = document.getElementById("closeAdminAuthBtn");
    const cancelAdminAuthBtn = document.getElementById("cancelAdminAuthBtn");
    const submitAdminAuthBtn = document.getElementById("submitAdminAuthBtn");
    const adminPinInput = document.getElementById("adminPinInput");
    const adminAuthError = document.getElementById("adminAuthError");

    function openSettingsModal() {
      if (gasUrlInput) {
        gasUrlInput.value = AppConfig.getGasUrl();
        gasUrlInput.type = "password";
      }
      if (toggleGasUrlVisibilityBtn) {
        toggleGasUrlVisibilityBtn.textContent = "顯示網址";
      }
      const testRes = document.getElementById("testConnectionResult");
      if (testRes) testRes.textContent = "";
      if (cacheControlResult) cacheControlResult.textContent = "";
      renderDepartmentSpreadsheetsList();
      if (settingsModal) settingsModal.classList.add("open");
    }

    function openAdminAuthModal() {
      if (adminPinInput) adminPinInput.value = "";
      if (adminAuthError) adminAuthError.textContent = "";
      if (adminAuthModal) adminAuthModal.classList.add("open");
      setTimeout(function () {
        if (adminPinInput) adminPinInput.focus();
      }, 100);
    }

    function closeAdminAuthModal() {
      if (adminAuthModal) adminAuthModal.classList.remove("open");
    }

    function handleAdminAuthSubmit() {
      const pin = adminPinInput ? adminPinInput.value.trim() : "";
      if (!pin) {
        if (adminAuthError) adminAuthError.textContent = "請輸入管理員通行碼";
        return;
      }
      if (AppConfig.verifyAdminPin(pin)) {
        closeAdminAuthModal();
        applyAdminModeDisplay(true);
        openSettingsModal();
      } else {
        if (adminAuthError) adminAuthError.textContent = "通行碼錯誤，請重新輸入";
        if (adminPinInput) {
          adminPinInput.value = "";
          adminPinInput.focus();
        }
      }
    }

    if (submitAdminAuthBtn) {
      submitAdminAuthBtn.addEventListener("click", handleAdminAuthSubmit);
    }
    if (adminPinInput) {
      adminPinInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") handleAdminAuthSubmit();
      });
    }
    if (closeAdminAuthBtn) closeAdminAuthBtn.addEventListener("click", closeAdminAuthModal);
    if (cancelAdminAuthBtn) cancelAdminAuthBtn.addEventListener("click", closeAdminAuthModal);
    if (adminAuthModal) {
      adminAuthModal.addEventListener("click", function (e) {
        if (e.target === adminAuthModal) closeAdminAuthModal();
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener("click", function () {
        if (AppConfig.isAdminAuthenticated()) {
          openSettingsModal();
        } else {
          openAdminAuthModal();
        }
      });
    }

    if (closeSettingsBtn && settingsModal) {
      closeSettingsBtn.addEventListener("click", function () {
        settingsModal.classList.remove("open");
      });
    }

    if (settingsModal) {
      settingsModal.addEventListener("click", function (e) {
        if (e.target === settingsModal) {
          settingsModal.classList.remove("open");
        }
      });
    }

    if (toggleGasUrlVisibilityBtn && gasUrlInput) {
      toggleGasUrlVisibilityBtn.addEventListener("click", function () {
        if (gasUrlInput.type === "password") {
          gasUrlInput.type = "text";
          toggleGasUrlVisibilityBtn.textContent = "隱藏網址";
        } else {
          gasUrlInput.type = "password";
          toggleGasUrlVisibilityBtn.textContent = "顯示網址";
        }
      });
    }

    if (refreshCacheBtn) {
      refreshCacheBtn.addEventListener("click", async function () {
        if (cacheControlResult) {
          cacheControlResult.textContent = "正在向後端要求重建雙層快照快取…";
          cacheControlResult.style.color = "var(--text-muted)";
        }
        refreshCacheBtn.disabled = true;
        const res = await JobApi.refreshBackendCache();
        refreshCacheBtn.disabled = false;
        if (cacheControlResult) {
          cacheControlResult.textContent = res.message;
          cacheControlResult.style.color = res.ok ? "var(--status-good)" : "var(--status-danger)";
        }
        if (res.ok) {
          await refreshData(false);
        }
      });
    }

    if (logoutAdminBtn) {
      logoutAdminBtn.addEventListener("click", function () {
        AppConfig.setAdminAuthenticated(false);
        applyAdminModeDisplay(false);
        if (settingsModal) settingsModal.classList.remove("open");
        alert("已成功退出管理員模式，設定入口已安全隱藏。");
      });
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", async function () {
        const newUrl = gasUrlInput ? gasUrlInput.value.trim() : "";
        AppConfig.setGasUrl(newUrl);
        settingsModal.classList.remove("open");
        await refreshData(true);
      });
    }

    if (testSettingsBtn) {
      testSettingsBtn.addEventListener("click", async function () {
        const testResEl = document.getElementById("testConnectionResult");
        const val = gasUrlInput ? gasUrlInput.value.trim() : "";
        testResEl.textContent = "正在測試連線中…";
        testResEl.style.color = "var(--text-muted)";
        const res = await JobApi.testConnection(val);
        testResEl.textContent = res.message;
        testResEl.style.color = res.ok ? "var(--status-good)" : "var(--status-danger)";
      });
    }

    // 5. 隱藏式管理員觸發：Logo 連續點擊 5 次解鎖
    const brandSection = document.querySelector(".brand-section");
    let logoClickCount = 0;
    let logoClickTimer = null;
    if (brandSection) {
      brandSection.addEventListener("click", function (e) {
        logoClickCount++;
        if (logoClickTimer) clearTimeout(logoClickTimer);
        logoClickTimer = setTimeout(function () {
          logoClickCount = 0;
        }, 3000);

        if (logoClickCount >= 5) {
          logoClickCount = 0;
          e.preventDefault();
          if (AppConfig.isAdminAuthenticated()) {
            openSettingsModal();
          } else {
            openAdminAuthModal();
          }
        }
      });
    }

    // 6. 隱藏式管理員觸發：熱鍵 Ctrl + Shift + S
    window.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        if (AppConfig.isAdminAuthenticated()) {
          openSettingsModal();
        } else {
          openAdminAuthModal();
        }
      }
    });
  }

  /**
   * 套用管理員按鈕顯示狀態
   */
  function applyAdminModeDisplay(isAdmin) {
    const settingsBtn = document.getElementById("settingsBtn");
    if (!settingsBtn) return;
    settingsBtn.style.display = isAdmin ? "inline-flex" : "none";
  }

  /**
   * 頁面載入時檢查管理員狀態與網址參數
   */
  function checkAdminModeOnLoad() {
    const isAuthed = AppConfig.isAdminAuthenticated();
    applyAdminModeDisplay(isAuthed);

    const urlParams = new URLSearchParams(window.location.search);
    const hasAdminQuery = urlParams.get("admin") === "true" || window.location.hash.indexOf("admin=true") !== -1;
    if (hasAdminQuery) {
      if (isAuthed) {
        applyAdminModeDisplay(true);
      } else {
        const adminAuthModal = document.getElementById("adminAuthModal");
        if (adminAuthModal) adminAuthModal.classList.add("open");
      }
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

  /**
   * 渲染設定彈窗中的各部門 Google 試算表直接編輯連結
   */
  function renderDepartmentSpreadsheetsList() {
    const section = document.getElementById("departmentSpreadsheetsSection");
    const listEl = document.getElementById("deptSpreadsheetsList");
    if (!section || !listEl) return;

    if (!state.departments || state.departments.length === 0) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    let html = "";
    state.departments.forEach(function (dept) {
      const hasUrl = dept.url && dept.url.trim() !== "";
      html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; background-color: var(--bg-surface); border: 1px solid var(--border-light); border-radius: 6px;">';
      html += '  <div style="display: flex; flex-direction: column;">';
      html += '    <span style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">' + escapeHtml(dept.name) + '</span>';
      html += '    <span style="font-size: 0.76rem; color: var(--text-muted);">' + dept.sheetCount + ' 個工作表分頁</span>';
      html += '  </div>';
      if (hasUrl) {
        html += '  <a href="' + escapeHtml(dept.url) + '" target="_blank" rel="noopener noreferrer" style="color: var(--brand-primary); font-weight: 600; font-size: 0.82rem; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; padding: 4px 8px; background-color: rgba(15, 118, 110, 0.08); border-radius: 4px;">開啟試算表 &rarr;</a>';
      } else {
        html += '  <span style="color: var(--text-muted); font-size: 0.78rem;">未設定網址</span>';
      }
      html += '</div>';
    });

    listEl.innerHTML = html;
  }

  return {
    init: init,
    refreshData: refreshData,
    copyShareLink: copyShareLink
  };
})();

// DOM 載入完畢後啟動
document.addEventListener("DOMContentLoaded", function () {
  App.init();
});
