const WebSocket = require('ws');
const axios = require('axios');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

console.log("🚀 WSS Server Started on port:", PORT);

// ================= GLOBAL CONFIG =================
const BACKEND_URL = "https://www.shopanzaservices.in/app_files/response.aspx";

wss.on('connection', function connection(ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";

    let audioBuffer = [];
    let silenceTimer = null;
    let warningGiven = false;

    console.log("🔌 New Connection");

    ws.on('message', async function incoming(message) {

        try {
            const msg = JSON.parse(message.toString());

            // ================= CONNECTED =================
            if (msg.event === "connected") {
                console.log("✅ Connected Event");
            }

            // ================= START =================
            if (msg.event === "start") {

                streamSid = msg.stream_sid;
                callSid = msg.start.call_sid;
                from = msg.start.from;

                console.log("📞 Call Started:", callSid, from);

                // 🎤 Greeting
                await sendTTS(ws, streamSid,
                    "Welcome to Shopanza Services. How may I help you"
                );
            }

            // ================= MEDIA =================
            if (msg.event === "media") {

                audioBuffer.push(msg.media.payload);

                // Reset silence timer
                if (silenceTimer) clearTimeout(silenceTimer);

                silenceTimer = setTimeout(async () => {

                    if (audioBuffer.length < 5) {
                        // very small audio → ignore
                        audioBuffer = [];
                        return;
                    }

                    let combinedAudio = audioBuffer.join("");
                    audioBuffer = [];

                    console.log("🎧 Processing user speech...");

                    try {

                        let res = await axios.post(
                            BACKEND_URL + "/process_voice",
                            {
                                audio: combinedAudio,
                                call_sid: callSid,
                                from: from
                            },
                            {
                                headers: { "Content-Type": "application/json" },
                                timeout: 20000
                            }
                        );

                        let data = res.data;

                        console.log("🤖 AI Response:", data);

                        if (data.audio_url) {
                            await streamAudio(ws, streamSid, data.audio_url);
                        }

                        if (data.status === "completed") {
                            console.log("✅ Booking completed");
                            setTimeout(() => ws.close(), 4000);
                        }

                    } catch (err) {
                        console.log("❌ Backend Error:", err.message);
                    }

                }, 1200); // 🔥 reduced from 2000 → faster response
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call Ended");
            }

        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    });
});


// ================= TTS CALL =================
async function sendTTS(ws, streamSid, text) {

    try {
        let res = await axios.post(
            BACKEND_URL + "/tts_direct",
            { text: text },
            { headers: { "Content-Type": "application/json" } }
        );

        // ✅ FIX: ASP.NET wrapper
        let audioUrl = res.data.d.audio_url;

        console.log("🔊 TTS URL:", audioUrl);

        await streamAudio(ws, streamSid, audioUrl);

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}


// ================= STREAM AUDIO TO EXOTEL =================
async function streamAudio(ws, streamSid, audioUrl) {

    try {
        let response = await axios.get(audioUrl, {
            responseType: 'arraybuffer'
        });

        let buffer = Buffer.from(response.data);

        let chunkSize = 3200; // 100ms chunks (IMPORTANT)

        let chunkCount = 0;

        for (let i = 0; i < buffer.length; i += chunkSize) {

            let chunk = buffer.slice(i, i + chunkSize);

            ws.send(JSON.stringify({
                event: "media",
                stream_sid: streamSid,
                media: {
                    payload: chunk.toString('base64')
                }
            }));

            chunkCount++;
        }

        console.log("🔊 Sent chunks:", chunkCount);

        // optional mark
        ws.send(JSON.stringify({
            event: "mark",
            stream_sid: streamSid,
            mark: { name: "audio_end" }
        }));

    } catch (err) {
        console.log("Stream Error:", err.message);
    }
}
