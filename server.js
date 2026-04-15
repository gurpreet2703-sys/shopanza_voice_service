const WebSocket = require('ws');
const axios = require('axios');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

console.log("🚀 WSS Server Started on port:", PORT);

const BACKEND_URL = "https://www.shopanzaservices.in/app_files/response.aspx";

// ================= VAD CONFIG =================
const SILENCE_THRESHOLD = 200;
const SILENCE_DURATION = 1200;
const MAX_BUFFER_DURATION = 5000;

wss.on('connection', function connection(ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";

    let audioChunks = [];
    let lastSpeechTime = Date.now();
    let bufferStartTime = Date.now();

    let processing = false;

    // ✅ NEW VARIABLES
    let lastQuestion = "";
    let reminderSent = false;
    let callEnded = false;

    console.log("🔌 New Connection");

    ws.on('message', async function incoming(message) {

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

                lastQuestion = "How may I help you";
                lastSpeechTime = Date.now();
            }

            // ================= MEDIA =================
            if (msg.event === "media") {

                const payload = msg.media.payload;

                let pcmBuffer = Buffer.from(payload, 'base64');
                let energy = calculateEnergy(pcmBuffer);
                let now = Date.now();

                // ✅ USER SPEAKING
                if (energy > SILENCE_THRESHOLD) {
                    lastSpeechTime = now;
                    reminderSent = false;
                }

                audioChunks.push(payload);

                let silenceTime = now - lastSpeechTime;
                let bufferTime = now - bufferStartTime;

                // 🎯 PROCESS AUDIO
                if (
                    (silenceTime > SILENCE_DURATION && audioChunks.length > 5) ||
                    bufferTime > MAX_BUFFER_DURATION
                ) {

                    if (processing) return;

                    processing = true;

                    let buffers = audioChunks.map(b64 => Buffer.from(b64, 'base64'));
                    let combinedBuffer = Buffer.concat(buffers);
                    let combinedAudio = combinedBuffer.toString('base64');

                    audioChunks = [];
                    bufferStartTime = Date.now();

                    console.log("🎧 Processing chunk...");

                    await processAudio(ws, streamSid, callSid, from, combinedAudio);

                    processing = false;
                }
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call Ended");
                callEnded = true;
                clearInterval(silenceInterval);
            }

        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    });

    // ================= SILENCE WATCHER =================
    let silenceInterval = setInterval(async () => {

        if (callEnded) return;

        let now = Date.now();
        let silence = now - lastSpeechTime;

        try {

            // ⏱ 5 sec → reminder
            if (silence > 5000 && !reminderSent) {

                reminderSent = true;

                console.log("⏳ Reminder triggered");

                await sendTTS(ws, streamSid,
                    "I am waiting for your response"
                );
            }

            // ⏱ 10 sec → end call
            if (silence > 10000) {

                console.log("📴 Ending call due to no response");

                callEnded = true;

                await sendTTS(ws, streamSid,
                    "Thank you for using Shopanza Services"
                );

                setTimeout(() => ws.close(), 4000);

                clearInterval(silenceInterval);
            }

        } catch (err) {
            console.log("❌ Silence Error:", err.message);
        }

    }, 1000);


    // ================= PROCESS AUDIO =================
    async function processAudio(ws, streamSid, callSid, from, audioBase64) {

        try {
            let res = await axios.post(
                BACKEND_URL + "/process_voice",
                {
                    audio: audioBase64,
                    call_sid: callSid,
                    from: from
                },
                {
                    headers: { "Content-Type": "application/json" },
                    timeout: 20000
                }
            );

            let data = res.data.d;

            console.log("🤖 AI:", data);

            if (data && data.audio_url) {

                await streamAudio(ws, streamSid, data.audio_url);

                // ✅ FIX: USE TEXT FROM BACKEND
                if (data.text) {
                    lastQuestion = data.text;
                }

                // ✅ RESET TIMER AFTER BOT SPEAKS
                lastSpeechTime = Date.now();
                reminderSent = false;
            }

            if (data && data.status === "completed") {
                setTimeout(() => ws.close(), 4000);
            }

        } catch (err) {
            console.log("❌ Backend Error:", err.message);
        }
    }

});


// ================= ENERGY CALC =================
function calculateEnergy(buffer) {

    let sum = 0;

    for (let i = 0; i < buffer.length; i += 2) {
        let sample = buffer.readInt16LE(i);
        sum += sample * sample;
    }

    return Math.sqrt(sum / (buffer.length / 2));
}


// ================= TTS =================
async function sendTTS(ws, streamSid, text) {

    try {
        let res = await axios.post(
            BACKEND_URL + "/tts_direct",
            { text: text },
            { headers: { "Content-Type": "application/json" } }
        );

        let audioUrl = res.data.d.audio_url;

        console.log("🔊 TTS:", text);

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

        for (let i = 0; i < buffer.length; i += chunkSize) {

            let chunk = buffer.slice(i, i + chunkSize);

            ws.send(JSON.stringify({
                event: "media",
                stream_sid: streamSid,
                media: {
                    payload: chunk.toString('base64')
                }
            }));
        }

        ws.send(JSON.stringify({
            event: "mark",
            stream_sid: streamSid,
            mark: { name: "audio_end" }
        }));

    } catch (err) {
        console.log("Stream Error:", err.message);
    }
}
