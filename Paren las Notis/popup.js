// ─────────────────────────────────────────
//  PLM Notifier – Popup Script
//  Renders video list with tab filtering,
//  and month dividers
// ─────────────────────────────────────────

const VIDEO_HISTORY_KEY = "videoHistory";
const ZOOM_LEVEL_KEY = "zoomLevel";

document.addEventListener("DOMContentLoaded", () => {
    const videoList = document.getElementById("videoList");
    const emptyState = document.getElementById("emptyState");
    const tabs = document.querySelectorAll(".tab[data-tab]");

    // Info Modal elements
    const btnInfo = document.getElementById("btnInfo");
    const infoModal = document.getElementById("infoModal");
    const btnCloseInfo = document.getElementById("btnCloseInfo");

    // Search and Options elements
    const searchInput = document.getElementById("searchInput");
    const btnOptions = document.getElementById("btnOptions");
    const optionsDropdown = document.getElementById("optionsDropdown");
    const btnMarkAllSeen = document.getElementById("btnMarkAllSeen");
    const btnMarkAllUnseen = document.getElementById("btnMarkAllUnseen");

    let currentTab = "unseen";
    let videos = [];

    // ── Load videos from storage ───────────
    chrome.storage.local.get(VIDEO_HISTORY_KEY, (data) => {
        videos = data[VIDEO_HISTORY_KEY] || [];
        renderVideos();
    });

    // ── Info Modal Logic ───────────────────
    if (btnInfo && infoModal && btnCloseInfo) {
        btnInfo.addEventListener("click", () => {
            infoModal.style.display = "flex";
        });

        btnCloseInfo.addEventListener("click", () => {
            infoModal.style.display = "none";
        });

        // Close on outside click
        infoModal.addEventListener("click", (e) => {
            if (e.target === infoModal) {
                infoModal.style.display = "none";
            }
        });
    }

    // ── Zoom Logic ─────────────────────────
    const btnZoomIn = document.getElementById("btnZoomIn");
    const btnZoomOut = document.getElementById("btnZoomOut");
    const btnZoomReset = document.getElementById("btnZoomReset");
    const zoomValueDisplay = document.getElementById("zoomValue");
    let currentZoom = 1;

    const BASE_WIDTH = 402;
    const BASE_HEIGHT = 590;

    // Load zoom level
    chrome.storage.local.get(ZOOM_LEVEL_KEY, (data) => {
        if (data[ZOOM_LEVEL_KEY]) {
            currentZoom = data[ZOOM_LEVEL_KEY];
            applyZoom(currentZoom);
        }
    });

    function applyZoom(zoomFactor) {
        // Clamp between 0.8 (80%) and 1.3 (130%)
        currentZoom = Math.min(Math.max(zoomFactor, 0.8), 1.3);

        // Chromium cap on Extension Popup heights is strictly 600px!
        // To avoid native scrollbars, we calculate the max safe height dynamically
        const maxUnzoomedHeight = Math.floor(600 / currentZoom);
        const activeHeight = Math.min(BASE_HEIGHT, maxUnzoomedHeight);

        // Calculate physical layout pixels to tell Chrome how big to make the window
        const scaledWidth = Math.ceil(BASE_WIDTH * currentZoom);
        const scaledHeight = Math.ceil(activeHeight * currentZoom);

        // Set the window bounds absolutely
        document.documentElement.style.width = scaledWidth + 'px';
        document.documentElement.style.height = scaledHeight + 'px';
        document.body.style.width = scaledWidth + 'px';
        document.body.style.height = scaledHeight + 'px';

        // Wipe out the buggy CSS zoom
        document.body.style.zoom = "";

        // Properly scale layout to fit using CSS transforms
        const container = document.querySelector('.container');
        if (container) {
            container.style.width = BASE_WIDTH + "px";
            container.style.height = activeHeight + "px";
            container.style.transform = `scale(${currentZoom})`;
            container.style.transformOrigin = "top left";
        }

        if (zoomValueDisplay) {
            zoomValueDisplay.textContent = Math.round(currentZoom * 100) + "%";
        }
        chrome.storage.local.set({ [ZOOM_LEVEL_KEY]: currentZoom });
    }

    if (btnZoomIn && btnZoomOut && btnZoomReset) {
        btnZoomIn.addEventListener("click", () => applyZoom(currentZoom + 0.1));
        btnZoomOut.addEventListener("click", () => applyZoom(currentZoom - 0.1));
        btnZoomReset.addEventListener("click", () => applyZoom(1));
    }

    // ── Search & Options Logic ──────────────
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            renderVideos();
        });
    }

    if (btnOptions && optionsDropdown) {
        btnOptions.addEventListener("click", (e) => {
            e.stopPropagation();
            optionsDropdown.classList.toggle("show");
            btnOptions.classList.toggle("active");
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
            if (!optionsDropdown.contains(e.target) && e.target !== btnOptions) {
                optionsDropdown.classList.remove("show");
                btnOptions.classList.remove("active");
            }
        });
    }

    if (btnMarkAllSeen) {
        btnMarkAllSeen.addEventListener("click", () => {
            // Mark all currently visible (or all) videos as seen
            videos.forEach(v => v.seen = true);
            chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: videos }, () => {
                optionsDropdown.classList.remove("show");
                btnOptions.classList.remove("active");
                renderVideos();
            });
        });
    }

    if (btnMarkAllUnseen) {
        btnMarkAllUnseen.addEventListener("click", () => {
            // Mark all videos as unseen
            videos.forEach(v => v.seen = false);
            chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: videos }, () => {
                optionsDropdown.classList.remove("show");
                btnOptions.classList.remove("active");
                renderVideos();
            });
        });
    }

    // ── Tab switching ──────────────────────
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            if (tab.disabled) return;

            const tabName = tab.dataset.tab;
            if (tabName === currentTab) return;

            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            currentTab = tabName;

            videoList.classList.add("switching");
            videoList.classList.remove("visible");

            setTimeout(() => {
                renderVideos();
                videoList.classList.remove("switching");
                videoList.classList.add("visible");
            }, 150);
        });
    });

    // ── EN VIVO detection helpers ──────────
    function isLiveWindow() {
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 6=Sat
        if (day === 0 || day === 6) return false; // weekdays only
        const mins = now.getHours() * 60 + now.getMinutes();
        // 18:55 = 1135 min, 21:05 = 1265 min
        return mins >= 1135 && mins <= 1265;
    }

    function isLiveVideo(video) {
        return !video.title.toUpperCase().includes("COMPLETO");
    }

    const liveNow = isLiveWindow();

    // ── Render video cards with month dividers ─
    function renderVideos() {
        const filtered = getFilteredVideos();

        if (filtered.length === 0) {
            videoList.style.display = "none";
            emptyState.style.display = "flex";
            return;
        }

        videoList.style.display = "flex";
        emptyState.style.display = "none";

        let html = "";
        let lastMonthKey = "";

        let liveHeaderShown = false;

        filtered.forEach((video, index) => {
            const videoIsLive = liveNow && isLiveVideo(video);

            // Show "EN VIVO" divider before the first live video
            if (videoIsLive && !liveHeaderShown) {
                html += `<div class="month-divider live-divider"><span class="month-label">🔴 EN VIVO</span></div>`;
                liveHeaderShown = true;
            }

            // Only show month divider for non-live videos
            if (!videoIsLive) {
                const monthKey = getMonthKey(video.published);
                if (monthKey !== lastMonthKey) {
                    const label = getMonthLabel(video.published);
                    html += `<div class="month-divider"><span class="month-label">${label}</span></div>`;
                    lastMonthKey = monthKey;
                }
            }

            const liveClass = videoIsLive ? "live" : "";

            html += `
        <div class="video-card ${!video.seen ? "unseen" : ""} ${liveClass}" 
             data-id="${video.id}" 
             data-link="${video.link}"
             style="animation-delay: ${Math.min(index * 0.05, 0.5)}s">
          <div class="card-thumbnail">
            <img src="${video.thumbnail}" alt="" loading="lazy" 
                 onerror="this.style.display='none'; this.parentElement.classList.add('no-thumb');" />
          </div>
          <div class="card-info">
            <p class="video-title">${escapeHtml(video.title)}</p>
            <p class="video-date">${formatDate(video.published)}</p>
          </div>
          <div class="card-actions">
            <button class="btn-seen ${video.seen ? "is-seen" : ""}" 
                    data-id="${video.id}" 
                    title="${video.seen ? "Marcar como no visto" : "Marcar como visto"}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button class="btn-like ${video.liked ? "is-liked" : ""}" 
                    data-id="${video.id}" 
                    title="${video.liked ? "Quitar de favoritos" : "Agregar a favoritos"}">
              <svg viewBox="0 0 24 24" fill="${video.liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
        });

        videoList.innerHTML = html;
        attachCardListeners();
    }

    // ── Filter based on tabs and search ────
    function getFilteredVideos() {
        let result = videos;

        // 1. Filter by Tab
        switch (currentTab) {
            case "unseen":
                result = result.filter((v) => !v.seen);
                break;
            case "recent":
                result = [...result].sort(
                    (a, b) => new Date(b.published) - new Date(a.published)
                );
                break;
            case "favorites":
                result = result.filter((v) => v.liked);
                break;
        }

        // 2. Filter by Search Query (Title or Month)
        if (searchInput && searchInput.value) {
            const query = searchInput.value.toLowerCase().trim();
            result = result.filter((v) => {
                const titleMatch = v.title.toLowerCase().includes(query);
                const monthMatch = getMonthLabel(v.published).toLowerCase().includes(query);
                return titleMatch || monthMatch;
            });
        }

        return result;
    }

    // ── Month grouping helpers ─────────────
    function getMonthKey(dateStr) {
        if (!dateStr) return "unknown";
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${d.getMonth()}`;
    }

    function getMonthLabel(dateStr) {
        if (!dateStr) return "Fecha desconocida";
        const d = new Date(dateStr);
        const month = d.toLocaleDateString("es-AR", { month: "long" });
        const year = d.getFullYear();
        const capitalMonth = month.charAt(0).toUpperCase() + month.slice(1);
        return `${capitalMonth} ${year}`;
    }

    // ── Attach event listeners to cards ────
    function attachCardListeners() {
        document.querySelectorAll(".video-card").forEach((card) => {
            card.addEventListener("click", (e) => {
                const isBtnSeen = e.target.closest(".btn-seen");
                const isBtnLike = e.target.closest(".btn-like");

                if (isBtnSeen) {
                    // Toggle seen
                    const id = isBtnSeen.dataset.id;
                    const videoIndex = videos.findIndex((v) => v.id === id);
                    if (videoIndex !== -1) {
                        videos[videoIndex].seen = !videos[videoIndex].seen;
                        chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: videos }, () => {
                            renderVideos();
                        });
                    }
                    return;
                }

                if (isBtnLike) {
                    // Toggle liked
                    const id = isBtnLike.dataset.id;
                    const videoIndex = videos.findIndex((v) => v.id === id);
                    if (videoIndex !== -1) {
                        videos[videoIndex].liked = !videos[videoIndex].liked;
                        chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: videos }, () => {
                            renderVideos();
                        });
                    }
                    return;
                }

                // If not clicking a button, open the video link
                const link = card.dataset.link;
                if (link) {
                    chrome.tabs.create({ url: link });
                }
            });
        });
    }

    // ── Format date ────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return "";
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString("es-AR", {
                day: "numeric",
                month: "long",
                year: "numeric",
            });
        } catch {
            return dateStr;
        }
    }

    // ── Escape HTML ────────────────────────
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
});
