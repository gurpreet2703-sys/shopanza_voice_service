const WebSocket = require("ws");
const axios = require("axios");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log("🚀 Production Voice AI WSS running on:", PORT);

// ================= CONFIG =================
const BACKEND_URL = "https://www.shopanzaservices.in/app_files/response.aspx";

// ================= STATE =================
wss.on("connection", (ws) => {

    let streamSid = "";
    let callSid = "";
    let from = "";

    let audioChunks = [];
    let silenceTimer = null;
    let processing = false;

    const SILENCE_MS = 1200;      // key tuning
    const MIN_CHUNKS = 8;         // avoid noise

    console.log("🔌 New call connected");

    // ================= MESSAGE =================
    ws.on("message", async (message) => {

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

                audioChunks.push(Buffer.from(msg.media.payload, "base64"));

                resetSilenceTimer();
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call ended");
            }

        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    });

    // ================= SILENCE DETECTOR =================
    function resetSilenceTimer() {

        clearTimeout(silenceTimer);

        silenceTimer = setTimeout(() => {

            if (processing) return;

            if (audioChunks.length < MIN_CHUNKS) {
                audioChunks = [];
                return;
            }

            processAudioSegment();

        }, SILENCE_MS);
    }

    // ================= PROCESS SPEECH =================
    async function processAudioSegment() {

        if (processing) return;
        processing = true;

        try {
            let buffer = Buffer.concat(audioChunks);
            audioChunks = [];

            console.log("🎧 Speech detected:", buffer.length, "bytes");

            let base64Audio = buffer.toString("base64");

            let res = await axios.post(
                BACKEND_URL + "/process_voice",
                {
                    audio: base64Audio,
                    call_sid: callSid,
                    from: from
                },
                { timeout: 30000 }
            );

            let data = res.data.d || res.data;

            console.log("🤖 Response:", data);

            if (data?.audio_url) {
                await streamAudio(ws, streamSid, data.audio_url);
            }

        } catch (err) {
            console.log("❌ STT ERROR:", err.message);
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
        console.log("TTS ERROR:", err.message);
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
                    payload: buffer.slice(i, i + chunkSize).toString("base64")
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
        console.log("STREAM ERROR:", err.message);
    }
}
