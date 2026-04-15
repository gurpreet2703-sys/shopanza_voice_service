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

    // ================= NEW RMS VOICE SYSTEM =================
    let audioWindow = [];
    let silenceTimer = null;
    let processing = false;
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

                await sendTTS(ws, streamSid,
                    "Welcome to Shopanza Services. How may I help you"
                );
            }

            // ================= MEDIA (NEW ENGINE) =================
            if (msg.event === "media") {

                audioWindow.push(msg.media.payload);

                // reset timer every packet
                if (silenceTimer) clearTimeout(silenceTimer);

                silenceTimer = setTimeout(async () => {

                    if (processing) return;
                    processing = true;

                    try {

                        // ================= CONVERT BASE64 → PCM =================
                        let buffers = [];

                        for (let i = 0; i < audioWindow.length; i++) {
                            try {
                                buffers.push(Buffer.from(audioWindow[i], 'base64'));
                            } catch (e) {}
                        }

                        audioWindow = [];

                        let combined = Buffer.concat(buffers);

                        if (combined.length < 1500) {
                            console.log("🔇 Too small audio ignored");
                            processing = false;
                            return;
                        }

                        // ================= RMS CHECK =================
                        let rms = calculateRMS(combined);

                        console.log("📊 RMS:", rms.toFixed(4));

                        // silence threshold
                        if (rms < 0.008) {
                            console.log("🔇 Silence detected, skipping STT");
                            processing = false;
                            return;
                        }

                        console.log("🎧 Sending to backend STT...");

                        let base64Audio = combined.toString('base64');

                        let res = await axios.post(
                            BACKEND_URL + "/process_voice",
                            {
                                audio: base64Audio,
                                call_sid: callSid,
                                from: from
                            },
                            {
                                headers: { "Content-Type": "application/json" },
                                timeout: 20000
                            }
                        );

                        let data = res.data.d || res.data;

                        console.log("🤖 AI RESPONSE:", data);

                        if (data?.audio_url) {
                            await streamAudio(ws, streamSid, data.audio_url);
                        }

                        if (data?.status === "completed") {
                            console.log("✅ Call completed");
                            setTimeout(() => ws.close(), 3000);
                        }

                    } catch (err) {
                        console.log("❌ Backend error:", err.message);
                    }

                    processing = false;

                }, 2000); // 2 sec window
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


// ================= TTS =================
async function sendTTS(ws, streamSid, text) {

    try {
        let res = await axios.post(
            BACKEND_URL + "/tts_direct",
            { text },
            { headers: { "Content-Type": "application/json" } }
        );

        let audioUrl = res.data.d?.audio_url || res.data.audio_url;

        console.log("🔊 TTS URL:", audioUrl);

        await streamAudio(ws, streamSid, audioUrl);

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}


// ================= STREAM AUDIO =================
async function streamAudio(ws, streamSid, audioUrl) {

    try {
        let response = await axios.get(audioUrl, {
            responseType: 'arraybuffer'
        });

        let buffer = Buffer.from(response.data);

        let chunkSize = 3200;
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

            await new Promise(r => setTimeout(r, 20));
        }

        console.log("🔊 Sent chunks:", chunkCount);

        ws.send(JSON.stringify({
            event: "mark",
            stream_sid: streamSid,
            mark: { name: "audio_end" }
        }));

    } catch (err) {
        console.log("Stream Error:", err.message);
    }
}


// ================= RMS CALCULATION =================
function calculateRMS(buffer) {

    let sum = 0;

    for (let i = 0; i < buffer.length; i += 2) {

        let val = buffer.readInt16LE(i);
        sum += val * val;
    }

    let rms = Math.sqrt(sum / (buffer.length / 2));

    return rms / 32768; // normalize
}
