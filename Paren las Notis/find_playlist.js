const https = require('https');

https.get('https://www.youtube.com/@VorterixOk/playlists', (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        const regex = /"title":\{"simpleText":"Paren la Mano[^\"]*"\},(?:[^}]*\}){0,15}?"playlistId":"([^"]+)"/g;
        let match;
        while ((match = regex.exec(data)) !== null) {
            console.log('Found ID:', match[1]);
        }
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
