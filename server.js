const WebSocket = require('ws');
const axios = require('axios');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log("🚀 WSS Server Started on port:", PORT);

// ================= CONFIG =================
const BACKEND_URL = "https://www.shopanzaservices.in/app_files/response.aspx";

// ================= UTILS =================
function calculateRMS(buffer) {
    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {
        let val = buffer[i] - 128;
        sum += val * val;
    }

    return Math.sqrt(sum / buffer.length);
}

wss.on('connection', function (ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";

    let audioChunks = [];
    let lastActiveTime = Date.now();

    let processing = false;

    console.log("🔌 New Connection");

    ws.on('message', async (message) => {

        try {
            const msg = JSON.parse(message.toString());

            // ================= START =================
            if (msg.event === "start") {

                streamSid = msg.stream_sid;
                callSid = msg.start.call_sid;
                from = msg.start.from;

                console.log("📞 Call Started:", callSid);

                await sendTTS(ws, streamSid,
                    "Welcome to Shopanza Services. How may I help you"
                );
            }

            // ================= MEDIA =================
            if (msg.event === "media") {

                let chunk = Buffer.from(msg.media.payload, 'base64');

                audioChunks.push(chunk);

                lastActiveTime = Date.now();

                // 🔥 REAL-TIME SILENCE CHECK (RMS)
                let rms = calculateRMS(chunk);

                // log only occasionally
                if (Math.random() < 0.02) {
                    console.log("🎚 RMS:", rms.toFixed(2));
                }

                // 🔴 SILENCE DETECTED EARLY → PROCESS IMMEDIATELY
                if (rms < 6 && audioChunks.length > 8 && !processing) {
                    processAudio();
                }

                // 🔴 FORCE PROCESS AFTER 2.5 SEC
                setTimeout(() => {
                    if (!processing && Date.now() - lastActiveTime > 2500) {
                        processAudio();
                    }
                }, 2600);
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call Ended");
            }

        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    });

    // ================= PROCESS AUDIO =================
    async function processAudio() {

        if (processing) return;
        processing = true;

        try {
            if (audioChunks.length < 5) {
                processing = false;
                audioChunks = [];
                return;
            }

            console.log("🎧 Processing audio chunks:", audioChunks.length);

            let buffer = Buffer.concat(audioChunks);
            audioChunks = [];

            let base64Audio = buffer.toString('base64');

            let res = await axios.post(
                BACKEND_URL + "/process_voice",
                {
                    audio: base64Audio,
                    call_sid: callSid,
                    from: from
                },
                { timeout: 25000 }
            );

            let data = res.data.d || res.data;

            console.log("🤖 Response:", data);

            if (data?.audio_url) {
                await streamAudio(ws, streamSid, data.audio_url);
            }

        } catch (err) {
            console.log("❌ Process Error:", err.message);
        }

        processing = false;
    }
});

// ================= TTS =================
async function sendTTS(ws, streamSid, text) {

    try {
        let res = await axios.post(
            BACKEND_URL + "/tts_direct",
            { text },
            { timeout: 15000 }
        );

        let data = res.data.d || res.data;

        await streamAudio(ws, streamSid, data.audio_url);

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}

// ================= STREAM AUDIO =================
async function streamAudio(ws, streamSid, audioUrl) {

    try {
        let res = await axios.get(audioUrl, { responseType: "arraybuffer" });

        let buffer = Buffer.from(res.data);

        let chunkSize = 3200;

        for (let i = 0; i < buffer.length; i += chunkSize) {

            ws.send(JSON.stringify({
                event: "media",
                stream_sid: streamSid,
                media: {
                    payload: buffer.slice(i, i + chunkSize).toString('base64')
                }
            }));

            await new Promise(r => setTimeout(r, 20));
        }

        ws.send(JSON.stringify({
            event: "mark",
            stream_sid: streamSid,
            mark: { name: "end" }
        }));

    } catch (err) {
        console.log("Stream Error:", err.message);
    }
}
