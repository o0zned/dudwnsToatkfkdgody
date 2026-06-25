/* ============================================================
   app.js
   ------------------------------------------------------------
   poems-data.js 의 PAGES 배열을 기반으로, 옆으로 한 장씩 넘기는
   책 UI를 구현합니다.

   핵심 구조
   - DOM에는 leaf--prev / leaf--current / leaf--next 딱 3장만 둔다.
     (35장을 한꺼번에 그려두지 않아 모바일에서도 가볍게 동작)
   - Pager.currentIndex 가 "지금 보고 있는 페이지 번호"의 단일 진실.
   - 페이지를 넘길 때:
       1) 다음에 보일 leaf의 내용을 미리 채운다
       2) translateX 트랜지션을 건다 (is-turning 클래스)
       3) 트랜지션이 끝나면 3장의 내용을 다시 채우고 transform을 리셋
          (leaf는 항상 prev=-100%, current=0, next=100% 위치를 유지)

   모듈 구성 (디버깅/리팩토링 편의를 위해 역할별로 분리)
   - Renderer    : 페이지 데이터를 HTML로 그리는 역할만 담당
   - Pager       : 페이지 번호 상태 + 넘기기 애니메이션 담당
   - InputRouter : 스와이프 드래그 / 탭 / 목차 클릭을 Pager 호출로 연결
   - Highlighter : 텍스트 선택 → 하이라이트 → 저장/복원
   ============================================================= */

(function () {
  "use strict";

  if (typeof window.PAGES === "undefined" || typeof window.BOOK_META === "undefined") {
    console.error(
      "[app.js] PAGES 또는 BOOK_META 데이터를 찾을 수 없습니다. " +
      "index.html에서 poems-data.js가 app.js보다 먼저 로드되는지 확인하세요."
    );
    return;
  }

  const BOOK_META = window.BOOK_META;
  const PAGES = window.PAGES;

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $all = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ============================================================
     Renderer : 페이지 1장(page object)을 받아 leaf 엘리먼트 내부에
     채울 HTML 문자열을 만든다. DOM 조작은 하지 않고 문자열만 반환해서
     Pager가 leaf.innerHTML에 한 번에 꽂아 넣을 수 있게 한다.
  ============================================================= */
  const Renderer = {
    renderPageHtml(page) {
      switch (page.type) {
        case "cover-front": return this.coverFront();
        case "editors-note": return this.editorsNote();
        case "toc": return this.toc();
        case "poem": return this.poem(page.poem, page.poemIndex);
        case "cover-back": return this.coverBack();
        default:
          console.warn("[Renderer] 알 수 없는 page.type:", page.type);
          return "";
      }
    },

    coverFront() {
      return `
        <div class="leaf__inner" style="padding:0;height:100%;">
          <div class="cover-front">
            <p class="cover-front__eyebrow">${escapeHtml(BOOK_META.schoolLine)}</p>
            <h1 class="cover-front__title">${escapeHtml(BOOK_META.title)}</h1>
            ${BOOK_META.subtitle ? `<p class="cover-front__subtitle">${escapeHtml(BOOK_META.subtitle)}</p>` : ""}
            <p class="cover-front__year">${escapeHtml(BOOK_META.yearLine)}</p>
            <svg class="cover-front__wave" viewBox="0 0 400 64" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M0,32 C60,8 120,56 180,32 C240,8 300,56 360,32 C380,22 390,18 400,20 L400,64 L0,64 Z" fill="rgba(247,244,239,0.18)"/>
              <path d="M0,44 C50,24 110,60 170,40 C230,20 290,58 350,38 C370,30 385,26 400,28 L400,64 L0,64 Z" fill="rgba(247,244,239,0.28)"/>
              <path d="M0,54 C40,40 90,64 160,50 C220,38 280,62 340,50 C365,44 385,42 400,43 L400,64 L0,64 Z" fill="rgba(247,244,239,0.55)"/>
            </svg>
            <div class="cover-front__hint">
              <span>넘겨보세요</span>
              <span class="cover-front__hint-arrow">›</span>
            </div>
          </div>
        </div>`;
    },

    editorsNote() {
      const paragraphs = (BOOK_META.editorsNote || [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("");
      return `
        <div class="leaf__inner">
          <p class="page__kicker">엮은이의 글</p>
          <h2 class="note__title">${escapeHtml(BOOK_META.editorsNoteTitle || "옮긴이의 말")}</h2>
          <div class="note__body">${paragraphs}</div>
          <p class="note__sign">${escapeHtml(BOOK_META.editorsNoteSign || "")}</p>
        </div>`;
    },

    toc() {
      const items = PAGES
        .filter((p) => p.type === "poem")
        .map((p, i) => `
          <li>
            <button type="button" data-target-index="${this.pageIndexOf(p)}">
              <span class="toc__num">${String(i + 1).padStart(2, "0")}</span>
              <span class="toc__title-text">${escapeHtml(p.poem.title)}</span>
            </button>
          </li>`)
        .join("");
      return `
        <div class="leaf__inner">
          <p class="page__kicker">목차</p>
          <h2 class="toc__title">시 서른한 편</h2>
          <ol class="toc__list">${items}</ol>
        </div>`;
    },

    poem(poem, poemIndex) {
      const totalPoems = PAGES.filter((p) => p.type === "poem").length;
      const linesHtml = poem.lines
        .map((line, i) => `<span class="poem__line" data-line-index="${i}">${escapeHtml(line)}</span>`)
        .join("");
      return `
        <div class="leaf__inner">
          <div class="poem">
            <p class="poem__index">${String(poemIndex + 1).padStart(2, "0")} / ${String(totalPoems).padStart(2, "0")}</p>
            <h2 class="poem__title">${escapeHtml(poem.title)}</h2>
            <div class="poem__body" data-poem-id="${poem.id}">${linesHtml}</div>
            <p class="poem__hint">문장을 길게 눌러 선택하면 하이라이트할 수 있어요.</p>
            <div class="poem__footer"><span class="poem__footer-dot"></span><span class="poem__footer-dot"></span><span class="poem__footer-dot"></span></div>
          </div>
        </div>`;
    },

    coverBack() {
      return `
        <div class="leaf__inner">
          <div class="cover-back">
            <p class="cover-back__note">${escapeHtml(BOOK_META.backNote)}</p>
            <div class="cover-back__divider"></div>
            <p class="cover-back__publisher">${escapeHtml(BOOK_META.publisher)}</p>
            <p class="cover-back__print">${escapeHtml(BOOK_META.printInfo)}</p>
          </div>
        </div>`;
    },

    // PAGES 배열에서 특정 page 객체의 인덱스를 찾는 보조 함수
    pageIndexOf(pageObj) {
      return PAGES.indexOf(pageObj);
    },

    // 목차/메뉴용 : PAGES 안에서 시들의 (전체 인덱스, 시 자체)를 순서대로 반환
    listPoems() {
      return PAGES
        .map((p, idx) => ({ pageIndex: idx, poem: p.type === "poem" ? p.poem : null }))
        .filter((x) => x.poem);
    },
  };

  /* ============================================================
     Pager : 현재 페이지 상태 관리 + 넘기기 애니메이션
  ============================================================= */
  const Pager = {
    currentIndex: 0,
    total: PAGES.length,
    isAnimating: false,

    stage: null,
    leafPrev: null,
    leafCurrent: null,
    leafNext: null,
    indicator: null,

    init() {
      this.stage = $("#stage");
      this.leafPrev = $("#leafPrev");
      this.leafCurrent = $("#leafCurrent");
      this.leafNext = $("#leafNext");
      this.indicator = $("#pageIndicator");

      this.renderAround(); // 처음 3장(없으면 빈칸) 채우기
      this.updateIndicator();
      this.updateTopbarCoverState();
    },

    // 현재 인덱스를 기준으로 prev/current/next 3장의 내용을 다시 채운다.
    renderAround() {
      this.leafPrev.innerHTML = this.currentIndex > 0 ? Renderer.renderPageHtml(PAGES[this.currentIndex - 1]) : "";
      this.leafCurrent.innerHTML = Renderer.renderPageHtml(PAGES[this.currentIndex]);
      this.leafNext.innerHTML = this.currentIndex < this.total - 1 ? Renderer.renderPageHtml(PAGES[this.currentIndex + 1]) : "";
      Highlighter.restoreInto(this.leafPrev);
      Highlighter.restoreInto(this.leafCurrent);
      Highlighter.restoreInto(this.leafNext);
    },

    canGoNext() {
      return this.currentIndex < this.total - 1;
    },
    canGoPrev() {
      return this.currentIndex > 0;
    },

    // direction: 1(다음 장) 또는 -1(이전 장)
    turn(direction) {
      if (this.isAnimating) return;
      if (direction > 0 && !this.canGoNext()) return this.bounce("next");
      if (direction < 0 && !this.canGoPrev()) return this.bounce("prev");

      this.isAnimating = true;
      this.stage.classList.add("is-turning");

      const offset = direction > 0 ? "-100%" : "100%";
      this.leafPrev.style.transform = `translateX(${direction > 0 ? "-200%" : "0%"})`;
      this.leafCurrent.style.transform = `translateX(${offset})`;
      this.leafNext.style.transform = `translateX(${direction > 0 ? "0%" : "200%"})`;

      const onDone = () => {
        this.leafCurrent.removeEventListener("transitionend", onDone);
        this.currentIndex += direction;
        this.stage.classList.remove("is-turning");
        // transform을 기본 위치로 리셋하고, 내용도 새 currentIndex 기준으로 다시 채움
        this.leafPrev.style.transform = "";
        this.leafCurrent.style.transform = "";
        this.leafNext.style.transform = "";
        this.renderAround();
        this.updateIndicator();
        this.updateTopbarCoverState();
        this.isAnimating = false;
      };
      this.leafCurrent.addEventListener("transitionend", onDone);

      // 혹시 transitionend가 발생하지 않는 예외 상황(예: 매우 느린 기기,
      // 또는 display:none 전환 중 발생하는 브라우저 버그) 대비 안전망.
      // 트랜지션 시간(0.32s)보다 넉넉하게 잡아 정상 동작을 방해하지 않게 함.
      window.setTimeout(() => {
        if (this.isAnimating) onDone();
      }, 420);
    },

    // 더 넘어갈 곳이 없을 때 살짝 튕기는 피드백 (책의 끝에 닿은 느낌)
    bounce(side) {
      const leaf = this.leafCurrent;
      leaf.style.transition = "transform 0.18s ease";
      leaf.style.transform = side === "next" ? "translateX(-14px)" : "translateX(14px)";
      window.setTimeout(() => {
        leaf.style.transform = "translateX(0)";
        window.setTimeout(() => { leaf.style.transition = ""; }, 200);
      }, 90);
    },

    // 목차/메뉴에서 특정 페이지로 즉시 점프 (애니메이션 없이 바로 전환 —
    // 목차에서 31번째 시까지 한 장씩 넘기면 너무 느리므로 점프가 자연스러움)
    jumpTo(pageIndex) {
      if (pageIndex < 0 || pageIndex >= this.total || this.isAnimating) return;
      this.currentIndex = pageIndex;
      this.renderAround();
      this.updateIndicator();
      this.updateTopbarCoverState();
    },

    updateIndicator() {
      const current = PAGES[this.currentIndex];
      if (current.type === "cover-front" || current.type === "cover-back") {
        this.indicator.textContent = "";
        return;
      }
      this.indicator.textContent = (this.currentIndex + 1) + " / " + this.total;
    },

    updateTopbarCoverState() {
      const isCover = PAGES[this.currentIndex].type === "cover-front";
      $("#topbar").classList.toggle("is-on-cover", isCover);
    },
  };

  /* ============================================================
     InputRouter : 스와이프 드래그 / 탭존 / 목차 클릭 → Pager 연결
  ============================================================= */
  const InputRouter = {
    dragState: null, // {startX, startY, lastX, dragging, isHorizontal}

    init() {
      const stage = $("#stage");

      // --- 좌우 탭존(가장자리 살짝 터치) ---
      $("#tapPrev").addEventListener("click", () => Pager.turn(-1));
      $("#tapNext").addEventListener("click", () => Pager.turn(1));

      // --- 스와이프 드래그 (포인터 이벤트로 마우스/터치 통합 처리) ---
      stage.addEventListener("pointerdown", (e) => this.onPointerDown(e));
      stage.addEventListener("pointermove", (e) => this.onPointerMove(e));
      stage.addEventListener("pointerup", (e) => this.onPointerUp(e));
      stage.addEventListener("pointercancel", () => this.resetDrag());

      // --- 메뉴/홈/목차 ---
      $("#menuBtn").addEventListener("click", () => Navigator.toggleMenu());
      $("#menuCloseBtn").addEventListener("click", () => Navigator.closeMenu());
      $("#menuOverlay").addEventListener("click", (e) => {
        if (e.target === $("#menuOverlay")) Navigator.closeMenu();
      });
      $("#homeBtn").addEventListener("click", () => {
        Navigator.closeMenu();
        Pager.jumpTo(0);
      });
      $("#menuList").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-target-index]");
        if (!btn) return;
        Navigator.closeMenu();
        Pager.jumpTo(Number(btn.dataset.targetIndex));
      });

      // 목차 페이지(leaf 내부, 동적으로 생성됨)는 이벤트 위임으로 처리
      document.addEventListener("click", (e) => {
        const btn = e.target.closest(".toc__list button[data-target-index]");
        if (!btn) return;
        Pager.jumpTo(Number(btn.dataset.targetIndex));
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && $("#menuOverlay").classList.contains("is-open")) {
          Navigator.closeMenu();
        }
        // 데스크탑에서 방향키로도 넘길 수 있게(보조 기능)
        if (e.key === "ArrowRight") Pager.turn(1);
        if (e.key === "ArrowLeft") Pager.turn(-1);
      });
    },

    onPointerDown(e) {
      // 메뉴가 열려 있으면 드래그 시작하지 않음
      if ($("#menuOverlay").classList.contains("is-open")) return;
      this.dragState = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        dragging: false,
        isHorizontal: null,
        pointerId: e.pointerId,
      };
    },

    onPointerMove(e) {
      const ds = this.dragState;
      if (!ds || Pager.isAnimating) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;

      // 처음 움직임에서 가로/세로 의도를 판별 (세로면 본문 텍스트
      // 선택이나 leaf 내부 스크롤을 방해하지 않도록 드래그를 포기)
      if (ds.isHorizontal === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        ds.isHorizontal = Math.abs(dx) > Math.abs(dy);
        if (ds.isHorizontal) {
          Pager.leafCurrent.setPointerCapture?.(ds.pointerId);
        }
      }
      if (!ds.isHorizontal) return;

      ds.dragging = true;
      ds.lastX = e.clientX;

      // 손가락을 따라 페이지가 실시간으로 따라오게 함 (드래그 중 미리보기)
      const w = Pager.stage.clientWidth;
      const clamped = Math.max(-w, Math.min(w, dx));
      Pager.leafCurrent.style.transition = "none";
      Pager.leafCurrent.style.transform = `translateX(${clamped}px)`;

      if (clamped < 0 && Pager.canGoNext()) {
        Pager.leafNext.style.transition = "none";
        Pager.leafNext.style.transform = `translateX(${100 + (clamped / w) * 100}%)`;
      } else if (clamped > 0 && Pager.canGoPrev()) {
        Pager.leafPrev.style.transition = "none";
        Pager.leafPrev.style.transform = `translateX(${-100 + (clamped / w) * 100}%)`;
      }
    },

    onPointerUp(e) {
      const ds = this.dragState;
      if (!ds) return;
      if (!ds.dragging) { this.resetDrag(); return; }

      const dx = ds.lastX - ds.startX;
      const w = Pager.stage.clientWidth;
      const threshold = w * 0.22; // 화면의 22% 이상 끌면 페이지 넘김으로 인정

      // 드래그로 만들어둔 임시 transform/transition을 정리하고
      // Pager.turn() 또는 원위치 복귀 애니메이션에게 제어권을 넘긴다.
      Pager.leafCurrent.style.transition = "";
      Pager.leafPrev.style.transition = "";
      Pager.leafNext.style.transition = "";

      if (dx <= -threshold && Pager.canGoNext()) {
        Pager.leafCurrent.style.transform = "";
        Pager.leafNext.style.transform = "";
        Pager.turn(1);
      } else if (dx >= threshold && Pager.canGoPrev()) {
        Pager.leafCurrent.style.transform = "";
        Pager.leafPrev.style.transform = "";
        Pager.turn(-1);
      } else {
        // 기준선을 못 넘었으면 살짝 되돌아가는 애니메이션과 함께 원위치
        Pager.leafCurrent.style.transition = "transform 0.22s ease";
        Pager.leafCurrent.style.transform = "translateX(0)";
        if (Pager.canGoNext()) {
          Pager.leafNext.style.transition = "transform 0.22s ease";
          Pager.leafNext.style.transform = "translateX(100%)";
        }
        if (Pager.canGoPrev()) {
          Pager.leafPrev.style.transition = "transform 0.22s ease";
          Pager.leafPrev.style.transform = "translateX(-100%)";
        }
        window.setTimeout(() => {
          Pager.leafCurrent.style.transition = "";
          Pager.leafPrev.style.transition = "";
          Pager.leafNext.style.transition = "";
        }, 240);
      }

      this.resetDrag();
    },

    resetDrag() {
      this.dragState = null;
    },
  };

  /* ============================================================
     Navigator : 메뉴 열고 닫기 (목차 데이터는 Renderer.toc()가 그림)
  ============================================================= */
  const Navigator = {
    lastFocused: null,

    renderMenuList() {
      const ol = $("#menuList");
      ol.innerHTML = Renderer.listPoems()
        .map(({ pageIndex, poem }, i) => `
          <li>
            <button type="button" data-target-index="${pageIndex}">
              <span class="menu-panel__num">${String(i + 1).padStart(2, "0")}</span>
              <span>${escapeHtml(poem.title)}</span>
            </button>
          </li>`)
        .join("");
    },

    openMenu() {
      this.lastFocused = document.activeElement;
      $("#menuOverlay").classList.add("is-open");
      $("#menuBtn").setAttribute("aria-expanded", "true");
      $("#menuCloseBtn").focus();
    },
    closeMenu() {
      $("#menuOverlay").classList.remove("is-open");
      $("#menuBtn").setAttribute("aria-expanded", "false");
      if (this.lastFocused) this.lastFocused.focus();
    },
    toggleMenu() {
      $("#menuOverlay").classList.contains("is-open") ? this.closeMenu() : this.openMenu();
    },
  };

  /* ============================================================
     Highlighter : 텍스트 선택 → 하이라이트 → localStorage 저장/복원
     ------------------------------------------------------------
     이전 버전과 저장 포맷은 동일하게 유지합니다 (localStorage key:
     "heogong-highlights-v1", { [poemId]: [{lineIndex, text}] }).
     단, 이번 구조에서는 시 페이지가 DOM에 항상 떠 있지 않고
     prev/current/next 3장 중 하나로 매번 새로 그려지므로,
     restoreAll() 대신 leaf 하나를 받아 그 안에만 적용하는
     restoreInto(leafEl) 형태로 바꿨습니다 (Pager.renderAround에서 호출).
  ============================================================= */
  const Highlighter = {
    STORAGE_KEY: "heogong-highlights-v1",
    data: {},
    toastEl: null,
    toastTimer: null,

    init() {
      this.toastEl = $("#toast");
      this.data = this.load();

      document.addEventListener("mouseup", (e) => this.handleSelectionEnd(e));
      document.addEventListener("touchend", (e) => this.handleSelectionEnd(e));
      document.addEventListener("click", (e) => {
        const hl = e.target.closest(".hl");
        if (hl) this.removeHighlightSpan(hl);
      });
    },

    load() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (err) {
        console.warn("[Highlighter] 저장된 하이라이트를 불러오지 못했습니다.", err);
        return {};
      }
    },

    save() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
      } catch (err) {
        console.warn("[Highlighter] 하이라이트를 저장하지 못했습니다.", err);
      }
    },

    handleSelectionEnd() {
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.toString().trim() === "") return;

        const range = selection.getRangeAt(0);
        const lineEl = this.findLineElement(range.commonAncestorContainer);
        if (!lineEl) return;

        if (range.commonAncestorContainer.parentElement?.closest(".hl")) {
          selection.removeAllRanges();
          return;
        }

        const applied = this.wrapRangeWithHighlight(range, lineEl);
        selection.removeAllRanges();

        if (applied) {
          this.persistLine(lineEl);
          this.showToast("하이라이트가 저장되었어요");
        }
      }, 0);
    },

    findLineElement(node) {
      const el = node.nodeType === 3 ? node.parentElement : node;
      return el ? el.closest(".poem__line") : null;
    },

    wrapRangeWithHighlight(range, lineEl) {
      try {
        const safeRange = range.cloneRange();
        if (!lineEl.contains(safeRange.commonAncestorContainer)) return false;
        const span = document.createElement("span");
        span.className = "hl";
        safeRange.surroundContents(span);
        return true;
      } catch (err) {
        console.warn("[Highlighter] 선택 영역을 하이라이트로 감싸지 못했습니다.", err);
        return false;
      }
    },

    persistLine(lineEl) {
      const bodyEl = lineEl.closest(".poem__body");
      if (!bodyEl) return;
      const poemId = bodyEl.dataset.poemId;
      const lineIndex = Number(lineEl.dataset.lineIndex);
      const hlTexts = $all(".hl", lineEl).map((hl) => hl.textContent);

      if (!this.data[poemId]) this.data[poemId] = [];
      this.data[poemId] = this.data[poemId].filter((item) => item.lineIndex !== lineIndex);
      hlTexts.forEach((text) => {
        if (text.trim() === "") return;
        this.data[poemId].push({ lineIndex, text });
      });
      this.save();
    },

    removeHighlightSpan(hlEl) {
      const lineEl = hlEl.closest(".poem__line");
      const parent = hlEl.parentNode;
      while (hlEl.firstChild) parent.insertBefore(hlEl.firstChild, hlEl);
      parent.removeChild(hlEl);
      parent.normalize();
      if (lineEl) {
        this.persistLine(lineEl);
        this.showToast("하이라이트를 지웠어요");
      }
    },

    // leafEl(.leaf 엘리먼트) 안에 그려진 시 본문에 한해 저장된 하이라이트를 복원
    restoreInto(leafEl) {
      $all(".poem__body", leafEl).forEach((bodyEl) => {
        const poemId = bodyEl.dataset.poemId;
        const saved = this.data[poemId];
        if (!saved) return;
        saved.forEach((item) => {
          const lineEl = bodyEl.querySelector('.poem__line[data-line-index="' + item.lineIndex + '"]');
          if (lineEl) this.tryApplySavedHighlight(lineEl, item.text);
        });
      });
    },

    tryApplySavedHighlight(lineEl, savedText) {
      const current = lineEl.textContent;
      const idx = current.indexOf(savedText);
      if (idx === -1) return;

      const before = current.slice(0, idx);
      const after = current.slice(idx + savedText.length);

      lineEl.textContent = "";
      if (before) lineEl.appendChild(document.createTextNode(before));
      const span = document.createElement("span");
      span.className = "hl";
      span.textContent = savedText;
      lineEl.appendChild(span);
      if (after) lineEl.appendChild(document.createTextNode(after));
    },

    showToast(message) {
      if (!this.toastEl) return;
      this.toastEl.textContent = message;
      this.toastEl.classList.add("is-visible");
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => {
        this.toastEl.classList.remove("is-visible");
      }, 1500);
    },
  };

  /* ============================================================
     초기화
  ============================================================= */
  function init() {
    Highlighter.init();
    Navigator.renderMenuList();
    Pager.init();
    InputRouter.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__heogongDebug = { Renderer, Pager, InputRouter, Navigator, Highlighter, BOOK_META, PAGES };
})();