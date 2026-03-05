// ─────────────────────────────────────────────────────────
//  PLM Notifier – Background Service Worker
//  • Uses YouTube Data API v3 exclusively to fetch 100+ videos
//  • Supports multiple playlists
// ─────────────────────────────────────────────────────────

const ALARM_NAME = "plm-check";
const LIVE_ALARM_NAME = "plm-live-check";

// Playlists to monitor
const PLAYLISTS = [
  "PLHZOhV2rP0rl_3hY5Ff_pMMddEKcFiaXS", // 2026 Oficial
  "PLHZOhV2rP0rlOnK9G820aDHUi11ZkQH9Q"  // 2025 Oficial 
];

// User's API Key
const YOUTUBE_API_KEY = "AIzaSyAYT-8LvJErfLByfryoJr7Sq7A7RXG0tsQ";

// Storage keys
const STORAGE_KEY = "lastNotifiedVideoId";
const LATEST_VIDEO_KEY = "latestVideo";
const VIDEO_HISTORY_KEY = "videoHistory";
const LAST_CHECK_TIME_KEY = "lastCheckTime";
const LAST_LIVE_NOTIF_KEY = "lastLiveNotifDate";

// Performance limits
const CHECK_INTERVAL_MINUTES = 15;
const MAX_STORED_VIDEOS = 300; // Increased to hold more history

// ── Bootstrap ────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Clear any old fake history from previous versions
  const data = await chrome.storage.local.get([VIDEO_HISTORY_KEY]);
  if (data[VIDEO_HISTORY_KEY]) {
    const cleaned = data[VIDEO_HISTORY_KEY].filter((v) => !v.id?.startsWith("fake-"));
    await chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: cleaned });
  }

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.create(LIVE_ALARM_NAME, { periodInMinutes: 1 });
  checkYouTubeAPI();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.create(LIVE_ALARM_NAME, { periodInMinutes: 1 });
});

// ── Alarm handler ────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    const now = Date.now();
    const currentHour = new Date().getHours();

    // Active window: From 21:00 (when the show ends) until 07:00 next day.
    const isActiveWindow = currentHour >= 21 || currentHour < 7;

    if (isActiveWindow) {
      console.log(`[PLM] Active window (${currentHour}:00). Checking API...`);
      chrome.storage.local.set({ [LAST_CHECK_TIME_KEY]: now });
      checkYouTubeAPI();
    } else {
      // Outside active window: Check only every 2 hours (120 minutes)
      chrome.storage.local.get([LAST_CHECK_TIME_KEY], (data) => {
        const lastCheckTime = data[LAST_CHECK_TIME_KEY] || 0;
        const TWO_HOURS_MS = 120 * 60 * 1000;

        if (now - lastCheckTime >= TWO_HOURS_MS) {
          console.log(`[PLM] Passive window (${currentHour}:00). 2 hours passed, checking API...`);
          chrome.storage.local.set({ [LAST_CHECK_TIME_KEY]: now });
          checkYouTubeAPI();
        } else {
          console.log(`[PLM] Passive window (${currentHour}:00). Skipping check to save quota.`);
        }
      });
    }
  }

  // ── Live program notification at 19:00 ──────────────────
  if (alarm.name === LIVE_ALARM_NAME) {
    checkLiveProgram();
  }
});

// ── Notification click → open video ──────────────────────
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("plm-")) {
    chrome.storage.local.get(LATEST_VIDEO_KEY, (data) => {
      const video = data[LATEST_VIDEO_KEY];
      if (video && video.link) {
        chrome.tabs.create({ url: video.link });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────
//  YouTube Data API specific logic
// ─────────────────────────────────────────────────────────
async function checkYouTubeAPI() {
  try {
    console.log("[PLM] Fetching playlists via API...");
    let allVideos = [];

    // Fetch from all configured playlists
    for (const playlistId of PLAYLISTS) {
      const videosFromPlaylist = await fetchAllUploads(playlistId, YOUTUBE_API_KEY);
      allVideos = allVideos.concat(videosFromPlaylist);
    }

    if (allVideos.length > 0) {
      console.log(`[PLM] Fetched ${allVideos.length} total videos from playlists.`);
      await mergeAndSaveVideos(allVideos);
    }

  } catch (err) {
    console.error("[PLM] API fetch error:", err);
  }
}

async function fetchAllUploads(playlistId, apiKey) {
  const videos = [];
  let nextPageToken = "";
  let page = 0;
  const MAX_PAGES = 4; // 4 pages * 50 results = 200 videos per playlist max

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);

    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[PLM] YouTube API error for playlist ${playlistId}: ${errBody}`);
      break;
    }

    const json = await res.json();
    const items = json.items || [];

    for (const item of items) {
      const snippet = item.snippet;
      const videoId = snippet.resourceId?.videoId;
      if (!videoId) continue;

      // Sometimes deleted videos or private videos appear with no title
      if (!snippet.title || snippet.title === "Private video" || snippet.title === "Deleted video") {
        continue;
      }

      videos.push({
        id: videoId,
        title: snippet.title,
        link: `https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`,
        published: snippet.publishedAt,
        thumbnail:
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }

    nextPageToken = json.nextPageToken || "";
    page++;
  } while (nextPageToken && page < MAX_PAGES);

  return videos;
}

// ─────────────────────────────────────────────────────────
//  Merge new videos into existing history
// ─────────────────────────────────────────────────────────
async function mergeAndSaveVideos(newVideos) {
  const data = await chrome.storage.local.get([
    VIDEO_HISTORY_KEY,
    STORAGE_KEY,
  ]);
  const existingHistory = data[VIDEO_HISTORY_KEY] || [];
  const existingMap = new Map(existingHistory.map((v) => [v.id, v]));
  const existingIds = new Set(existingHistory.map((v) => v.id));

  for (const video of newVideos) {
    if (existingMap.has(video.id)) {
      // Update metadata but preserve seen and liked state
      const existing = existingMap.get(video.id);
      existingMap.set(video.id, {
        ...video,
        seen: existing.seen,
        liked: existing.liked || false
      });
    } else {
      // New video
      existingMap.set(video.id, { ...video, seen: false, liked: false });
    }
  }

  // Sort by published date (newest first)
  let merged = Array.from(existingMap.values()).sort(
    (a, b) => new Date(b.published) - new Date(a.published)
  );

  // Limit size to prevent filling up chrome.storage
  if (merged.length > MAX_STORED_VIDEOS) {
    merged = merged.slice(0, MAX_STORED_VIDEOS);
  }

  // Save
  chrome.storage.local.set({ [VIDEO_HISTORY_KEY]: merged });

  // Update latest video for click notifications
  if (merged.length > 0) {
    chrome.storage.local.set({ [LATEST_VIDEO_KEY]: merged[0] });
  }

  // Only notify for new videos that contain "COMPLETO" in the title
  // This filters out scheduled/upcoming videos that are already in the playlist
  const completedNewVideos = newVideos.filter(
    (v) => !existingIds.has(v.id) && v.title.toUpperCase().includes("COMPLETO")
  );

  if (completedNewVideos.length > 0) {
    // Find the newest completed video
    const newestCompleted = completedNewVideos.sort(
      (a, b) => new Date(b.published) - new Date(a.published)
    )[0];

    const lastId = data[STORAGE_KEY];
    if (lastId !== newestCompleted.id) {
      chrome.notifications.create(`plm-${newestCompleted.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "🔴 ¡Nuevo Paren la Mano!",
        message: newestCompleted.title,
        priority: 2,
      });
      chrome.storage.local.set({ [STORAGE_KEY]: newestCompleted.id });
      // Update latest video to the notified one for click handler
      chrome.storage.local.set({ [LATEST_VIDEO_KEY]: newestCompleted });
    }
  }
}

// ─────────────────────────────────────────────────────────
//  Live program notification at 19:00
// ─────────────────────────────────────────────────────────
async function checkLiveProgram() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();

  // Only fire during the 19:00 hour
  if (currentHour !== 19) return;

  // Check if we already sent the live notification today
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const data = await chrome.storage.local.get([LAST_LIVE_NOTIF_KEY, VIDEO_HISTORY_KEY]);
  const lastLiveDate = data[LAST_LIVE_NOTIF_KEY];

  if (lastLiveDate === todayStr) {
    // Already notified today
    return;
  }

  // Only on weekdays (Monday=1 to Friday=5)
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log("[PLM] Weekend, skipping live notification.");
    return;
  }

  console.log(`[PLM] 19:${String(currentMinutes).padStart(2, "0")} - Sending live program notification!`);

  // Look for today's live/scheduled video (one without "COMPLETO")
  const history = data[VIDEO_HISTORY_KEY] || [];
  const liveVideo = history.find(
    (v) => !v.title.toUpperCase().includes("COMPLETO")
  );

  const message = liveVideo
    ? liveVideo.title
    : "El programa está al aire en Vorterix";

  chrome.notifications.create("plm-live-" + todayStr, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "🔴 ¡Paren la Mano en vivo!",
    message: message,
    priority: 2,
  });

  // Mark today as notified
  chrome.storage.local.set({ [LAST_LIVE_NOTIF_KEY]: todayStr });

  // If we found a live video, set it as latest for click handler
  if (liveVideo) {
    chrome.storage.local.set({ [LATEST_VIDEO_KEY]: liveVideo });
  }
}
