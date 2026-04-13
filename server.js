const WebSocket = require('ws');
const axios = require('axios');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

console.log("WSS Server Started...");

wss.on('connection', function connection(ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";
    let audioChunks = [];

    ws.on('message', async function incoming(message) {
        try {
            const msg = JSON.parse(message);

            // 🔹 CONNECTED
            if (msg.event === "connected") {
                console.log("Client Connected");
            }

            // 🔹 START EVENT
            if (msg.event === "start") {
                streamSid = msg.stream_sid;
                callSid = msg.start.call_sid;
                from = msg.start.from;

                console.log("Call Started:", callSid, from);

                // 🔥 FIRST TEST AUDIO (STATIC GREETING)
                await sendTTS(ws, streamSid, "Welcome to Shopanza Services. How may I help you?");
            }

            // 🔹 MEDIA (USER VOICE)
            if (msg.event === "media") {
                if (!msg.media.payload) return;

                audioChunks.push(msg.media.payload);

                // collect ~1 second audio then process
                if (audioChunks.length > 8) {

                    let fullAudio = audioChunks.join("");
                    audioChunks = [];

                    // 🔥 CALL YOUR ASP.NET BACKEND
                    const response = await axios.post(
                        "https://www.shopanzaservices.in/app_files/response.aspx",
                        {
                            audio: fullAudio,
                            call_sid: callSid,
                            from: from
                        },
                        {
                            headers: { "Content-Type": "application/json" }
                        }
                    );

                    if (response.data && response.data.audio) {
                        sendAudio(ws, streamSid, response.data.audio);
                    }
                }
            }

            // 🔹 STOP
            if (msg.event === "stop") {
                console.log("Call Ended:", callSid);
            }

        } catch (err) {
            console.log("Error:", err.message);
        }
    });
});


// 🔥 SEND AUDIO TO EXOTEL
function sendAudio(ws, streamSid, base64Audio) {

    const chunkSize = 3200; // must be multiple of 320

    for (let i = 0; i < base64Audio.length; i += chunkSize) {

        let chunk = base64Audio.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
            event: "media",
            stream_sid: streamSid,
            media: {
                payload: chunk
            }
        }));
    }
}


// 🔥 SIMPLE TTS HELPER (TEMP STATIC TEST)
async function sendTTS(ws, streamSid, text) {

    try {

        const response = await axios.post(
            "https://www.shopanzaservices.in/app_files/response.aspx",
            {
                action: "tts",
                text: text
            },
            {
                headers: { "Content-Type": "application/json" }
            }
        );

        if (response.data && response.data.audio) {
            sendAudio(ws, streamSid, response.data.audio);
        }

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}
