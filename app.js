
(() => {
  'use strict';

  // --------------------------
  // i18n (MVP: ja/en)
  // --------------------------
  const STRINGS = {
    ja: {
      appTitle: "3交替 日勤換算時計",
      settings: "設定",
      language: "言語",
      langHint: "※MVPは日本語/英語のみ",
      offsetTitle: "勤務オフセット（時間）",
      offsetHint: "例：-1.5 / 6.5 / 16.5（小数は0.5刻み推奨）",
      reset: "初期値に戻す",
      save: "保存",
      close: "閉じる",
      orderLabel: "切替順（固定）",
      orderHint: "早番 → 夜勤 → 遅番 → 早番 …",
      assist: "※ 端末時刻 + 勤務オフセット（分単位更新）",
      shifts: {
        early: "早番",
        late: "遅番",
        night: "夜勤",
      },
      shiftStatusFmt: (shiftName, offsetHours) => `${shiftName}（${formatOffsetHours(offsetHours)}）`,
    },
    en: {
      appTitle: "Shift Clock (Day-shift view)",
      settings: "Settings",
      language: "Language",
      langHint: "MVP supports Japanese/English only",
      offsetTitle: "Shift offsets (hours)",
      offsetHint: "Example: -1.5 / 6.5 / 16.5 (0.5 steps recommended)",
      reset: "Reset to default",
      save: "Save",
      close: "Close",
      orderLabel: "Cycle order (fixed)",
      orderHint: "Early → Night → Late → Early …",
      assist: "Device time + shift offset (updates per minute)",
      shifts: {
        early: "Early",
        late: "Late",
        night: "Night",
      },
      shiftStatusFmt: (shiftName, offsetHours) => `${shiftName} (${formatOffsetHours(offsetHours)})`,
    }
  };

  // --------------------------
  // Defaults / Storage keys
  // --------------------------
  const STORAGE = {
    version: "shift_clock_v1",
    selectedShift: "selected_shift",
    offsets: "offset_minutes",
    language: "language"
  };

  // Defaults (minutes)
  const DEFAULT_OFFSETS = { early: -90, late: 390, night: 990 };

  // Shift cycle order: early -> night -> late
  const SHIFT_ORDER = ["early", "night", "late"];

  // --------------------------
  // DOM
  // --------------------------
  const el = {
    appTitle: document.getElementById("appTitle"),
    shiftStatus: document.getElementById("shiftStatus"),
    assistText: document.getElementById("assistText"),
    shiftBtn: document.getElementById("shiftBtn"),

    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    modalBackdrop: document.getElementById("modalBackdrop"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),

    settingsTitle: document.getElementById("settingsTitle"),
    langLabel: document.getElementById("langLabel"),
    langHint: document.getElementById("langHint"),
    langSelect: document.getElementById("langSelect"),

    offsetLabel: document.getElementById("offsetLabel"),
    offsetHint: document.getElementById("offsetHint"),
    earlyLabel: document.getElementById("earlyLabel"),
    lateLabel: document.getElementById("lateLabel"),
    nightLabel: document.getElementById("nightLabel"),
    offsetEarly: document.getElementById("offsetEarly"),
    offsetLate: document.getElementById("offsetLate"),
    offsetNight: document.getElementById("offsetNight"),

    orderLabel: document.getElementById("orderLabel"),
    orderHint: document.getElementById("orderHint"),

    resetBtn: document.getElementById("resetBtn"),
    saveBtn: document.getElementById("saveBtn"),

    ticks: document.getElementById("ticks"),
    hourHand: document.getElementById("hourHand"),
    minuteHand: document.getElementById("minuteHand"),
  };

  // --------------------------
  // State
  // --------------------------
  let state = {
    lang: detectInitialLanguage(),
    selectedShift: "early",
    offsetsMin: { ...DEFAULT_OFFSETS },
    timerId: null,
    visibilityHandlerInstalled: false
  };

  // --------------------------
  // Utilities
  // --------------------------
  function detectInitialLanguage() {
    const saved = localStorage.getItem(STORAGE.language);
    if (saved && STRINGS[saved]) return saved;
    const nav = (navigator.language || "en").toLowerCase();
    return nav.startsWith("ja") ? "ja" : "en";
  }

  function clampNumber(x, min, max) {
    if (!Number.isFinite(x)) return null;
    return Math.min(max, Math.max(min, x));
  }

  function hoursToMinutes(hours) {
    // store minutes as integer
    return Math.round(hours * 60);
  }

  function minutesToHours(mins) {
    return mins / 60;
  }

  function formatOffsetHours(hours) {
    const sign = hours >= 0 ? "+" : "";
    // keep at most 2 decimals, but prefer .5 or .0
    const rounded = Math.round(hours * 2) / 2;
    return `${sign}${rounded}h`;
  }

  function getStr() {
    return STRINGS[state.lang] || STRINGS.en;
  }

  function loadState() {
    try {
      const savedShift = localStorage.getItem(STORAGE.selectedShift);
      if (savedShift && SHIFT_ORDER.includes(savedShift)) state.selectedShift = savedShift;

      const offsetsRaw = localStorage.getItem(STORAGE.offsets);
      if (offsetsRaw) {
        const obj = JSON.parse(offsetsRaw);
        if (obj && typeof obj === "object") {
          for (const k of ["early", "late", "night"]) {
            if (Number.isFinite(obj[k])) state.offsetsMin[k] = obj[k];
          }
        }
      }

      const savedLang = localStorage.getItem(STORAGE.language);
      if (savedLang && STRINGS[savedLang]) state.lang = savedLang;
    } catch (_) {
      // ignore corrupted storage
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE.selectedShift, state.selectedShift);
    localStorage.setItem(STORAGE.offsets, JSON.stringify(state.offsetsMin));
    localStorage.setItem(STORAGE.language, state.lang);
  }

  function resetState() {
    state.offsetsMin = { ...DEFAULT_OFFSETS };
    state.selectedShift = "early";
    saveState();
  }

  function nextShift(current) {
    const idx = SHIFT_ORDER.indexOf(current);
    const nextIdx = (idx + 1) % SHIFT_ORDER.length;
    return SHIFT_ORDER[nextIdx];
  }

  function getConvertedDate() {
    const offsetMin = state.offsetsMin[state.selectedShift] ?? 0;
    const ms = Date.now() + offsetMin * 60_000;
    return new Date(ms);
  }

  function getHourMinute(date) {
    const h = date.getHours();
    const m = date.getMinutes();
    return { h, m };
  }

  // --------------------------
  // Clock ticks (1-hour markers)
  // --------------------------
  function buildTicks() {
    // 12 hour ticks. Longer at 12/3/6/9.
    const cx = 100, cy = 100;
    const rOuter = 88;
    const rInnerMinor = 80;
    const rInnerMajor = 76;

    const majorHours = new Set([0, 3, 6, 9]); // 12,3,6,9 positions
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2; // 0 at 12 o'clock? We'll rotate by -90deg
      const a = angle - Math.PI / 2;

      const x1 = cx + rOuter * Math.cos(a);
      const y1 = cy + rOuter * Math.sin(a);

      const inner = majorHours.has(i) ? rInnerMajor : rInnerMinor;
      const x2 = cx + inner * Math.cos(a);
      const y2 = cy + inner * Math.sin(a);

      const cls = majorHours.has(i) ? "tick major" : "tick";
      parts.push(`<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`);
    }
    el.ticks.innerHTML = parts.join("");
  }

  // --------------------------
  // Render
  // --------------------------
  function applyLanguage() {
    const s = getStr();
    el.appTitle.textContent = s.appTitle;
    el.settingsBtn.setAttribute("aria-label", s.settings);
    el.settingsTitle.textContent = s.settings;

    el.langLabel.textContent = s.language;
    el.langHint.textContent = s.langHint;

    el.offsetLabel.textContent = s.offsetTitle;
    el.offsetHint.textContent = s.offsetHint;

    el.earlyLabel.textContent = s.shifts.early;
    el.lateLabel.textContent = s.shifts.late;
    el.nightLabel.textContent = s.shifts.night;

    el.orderLabel.textContent = s.orderLabel;
    el.orderHint.textContent = s.orderHint;

    el.resetBtn.textContent = s.reset;
    el.saveBtn.textContent = s.save;

    el.assistText.textContent = s.assist;

    // set select
    el.langSelect.value = state.lang;
  }

  function renderShiftUI() {
    const s = getStr();
    const shiftName = s.shifts[state.selectedShift] || state.selectedShift;
    el.shiftBtn.textContent = shiftName;

    const offsetHours = minutesToHours(state.offsetsMin[state.selectedShift] ?? 0);
    el.shiftStatus.textContent = s.shiftStatusFmt(shiftName, offsetHours);
  }

  function renderClock(date) {
    const { h, m } = getHourMinute(date);

    const minuteAngle = (m / 60) * 360;
    const hourAngle = ((h % 12) / 12) * 360 + (m / 60) * 30;

    el.minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
    el.hourHand.style.transform = `rotate(${hourAngle}deg)`;
  }

  function renderAll() {
    renderShiftUI();
    renderClock(getConvertedDate());
  }

  // --------------------------
  // Minute-boundary scheduler
  // --------------------------
  function clearTimer() {
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function scheduleNextTick() {
    clearTimer();
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const delay = Math.max(250, msToNextMinute); // safety
    state.timerId = setTimeout(() => {
      renderAll();
      scheduleNextTick();
    }, delay);
  }

  function installVisibilityHandler() {
    if (state.visibilityHandlerInstalled) return;
    state.visibilityHandlerInstalled = true;

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // stop updates while hidden (battery)
        clearTimer();
      } else {
        // refresh and restart
        renderAll();
        scheduleNextTick();
      }
    });
  }

  // --------------------------
  // Settings modal
  // --------------------------
  function openSettings() {
    // fill current values
    el.offsetEarly.value = minutesToHours(state.offsetsMin.early);
    el.offsetNight.value = minutesToHours(state.offsetsMin.night);
    el.offsetLate.value = minutesToHours(state.offsetsMin.late);

    el.langSelect.value = state.lang;

    el.modalBackdrop.hidden = false;
    if (typeof el.settingsModal.showModal === "function") {
      el.settingsModal.showModal();
    } else {
      // fallback for older browsers: simple display block
      el.settingsModal.setAttribute("open", "");
    }
  }

  function closeSettings() {
    el.modalBackdrop.hidden = true;
    if (typeof el.settingsModal.close === "function") {
      el.settingsModal.close();
    } else {
      el.settingsModal.removeAttribute("open");
    }
  }

  function readOffsetInput(inputEl) {
    const raw = parseFloat(inputEl.value);
    const clamped = clampNumber(raw, -24, 24);
    if (clamped === null) return null;
    return hoursToMinutes(clamped);
  }

  function saveSettings() {
    // update language first
    const lang = el.langSelect.value;
    if (STRINGS[lang]) state.lang = lang;

    // read offsets
    const early = readOffsetInput(el.offsetEarly);
    const night = readOffsetInput(el.offsetNight);
    const late  = readOffsetInput(el.offsetLate);

    // if any is invalid, do not save
    if (early === null || night === null || late === null) {
      // minimal feedback (no alerts); highlight by shaking could be added
      // Using alert here is acceptable but intrusive. We'll do a minimal one-time alert.
      alert(state.lang === "ja" ? "数値を入力してください（範囲：-24〜+24）" : "Enter numbers in range -24 to +24.");
      return;
    }

    state.offsetsMin = { early, night, late };
    saveState();
    applyLanguage();
    renderAll();
    closeSettings();
  }

  function resetSettings() {
    // reset offsets and selection (as per requirement: reset to defaults)
    resetState();
    loadState();
    applyLanguage();
    renderAll();
    closeSettings();
  }

  // --------------------------
  // Service worker (optional)
  // --------------------------
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // Only register under http(s)
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // --------------------------
  // Events
  // --------------------------
  function bindEvents() {
    el.shiftBtn.addEventListener("click", () => {
      state.selectedShift = nextShift(state.selectedShift);
      saveState();
      renderAll();
    });

    el.settingsBtn.addEventListener("click", openSettings);
    el.modalBackdrop.addEventListener("click", closeSettings);

    el.closeSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeSettings();
    });

    el.saveBtn.addEventListener("click", saveSettings);
    el.resetBtn.addEventListener("click", resetSettings);

    el.langSelect.addEventListener("change", () => {
      const lang = el.langSelect.value;
      if (STRINGS[lang]) {
        state.lang = lang;
        saveState();
        applyLanguage();
        renderShiftUI();
      }
    });
  }

  // --------------------------
  // Boot
  // --------------------------
  function init() {
    buildTicks();
    loadState();
    applyLanguage();
    bindEvents();
    installVisibilityHandler();
    renderAll();
    scheduleNextTick();
    registerSW();
  }

  // run
  init();
})();
