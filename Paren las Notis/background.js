// ─────────────────────────────────────────────────────────
//  PLM Notifier – Background Service Worker
//  • Uses YouTube Data API v3 exclusively to fetch 100+ videos
//  • Supports multiple playlists
// ─────────────────────────────────────────────────────────

const ALARM_NAME = "plm-check";

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
  checkYouTubeAPI();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
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

  let hasNewUnseen = false;
  let newestNew = null;

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
      hasNewUnseen = true;
      if (
        !newestNew ||
        new Date(video.published) > new Date(newestNew.published)
      ) {
        newestNew = video;
      }
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

  // Notify user about newest unseen video
  if (hasNewUnseen && newestNew) {
    const lastId = data[STORAGE_KEY];
    if (lastId !== newestNew.id) {
      chrome.notifications.create(`plm-${newestNew.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "🔴 ¡Nuevo Paren la Mano!",
        message: newestNew.title,
        priority: 2,
      });
      chrome.storage.local.set({ [STORAGE_KEY]: newestNew.id });
    }
  }
}
