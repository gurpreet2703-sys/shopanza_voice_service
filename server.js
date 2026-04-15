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

                    // ❌ No speech detected
                    if (audioBuffer.length === 0) {

                        if (!warningGiven) {
                            warningGiven = true;

                            await sendTTS(ws, streamSid,
                                "Kindly share your response else call will disconnect in five seconds"
                            );

                            setTimeout(() => {
                                console.log("📴 Disconnect due to silence");
                                ws.close();
                            }, 5000);
                        }

                        return;
                    }

                    warningGiven = false;

                    let combinedAudio = audioBuffer.join("");
                    audioBuffer = [];

                    console.log("🎧 Sending audio to backend...");

                    // 🔥 CALL ASP.NET BACKEND
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

                    // ✅ FIX: handle ASP.NET response wrapper
                    let data = res.data.d;

                    console.log("🤖 AI Response:", data);

                    // 🔊 Play AI response
                    if (data && data.audio_url) {
                        await streamAudio(ws, streamSid, data.audio_url);
                    } else {
                        console.log("⚠️ No audio_url received");
                    }

                    // ✅ Booking complete → close call
                    if (data && data.status === "completed") {
                        console.log("✅ Booking Completed, closing call");
                        setTimeout(() => ws.close(), 4000);
                    }

                }, 2000); // 2 sec buffer
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
