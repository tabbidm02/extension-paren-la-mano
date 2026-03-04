const https = require('https');

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?playlist_id=PLHZOhV2rP0rl_3hY5Ff_pMMddEKcFiaXS";

function parseAllVideosFromRSS(xml) {
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];
        const idMatch = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
        const titleMatch = entry.match(/<title>(.*?)<\/title>/);
        const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/);
        const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
        const thumbMatch = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/);

        if (!idMatch || !titleMatch) continue;

        entries.push({
            id: idMatch[1],
            title: titleMatch[1],
            link: linkMatch ? linkMatch[1] : `https://www.youtube.com/watch?v=${idMatch[1]}`,
            published: publishedMatch ? publishedMatch[1] : null,
            thumbnail: thumbMatch ? thumbMatch[1] : `https://i.ytimg.com/vi/${idMatch[1]}/hqdefault.jpg`,
        });
    }
    return entries;
}

https.get(FEED_URL, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log("Raw length:", data.length);
        const videos = parseAllVideosFromRSS(data);
        console.log("Videos total:", videos.length);
        if (videos.length > 0) {
            console.log("First video:", videos[0]);
        } else {
            console.log(data);
        }
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
