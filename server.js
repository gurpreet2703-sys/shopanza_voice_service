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

// ================= RETRY CONFIG =================
const NO_RESPONSE_TIMEOUT = 5000;
const MAX_RETRY = 2;

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
    let silenceTimer = null;
    let retryCount = 0;
    let isUserSpeaking = false;

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
            }

            // ================= MEDIA =================
            if (msg.event === "media") {

                const payload = msg.media.payload;

                let pcmBuffer = Buffer.from(payload, 'base64');

                let energy = calculateEnergy(pcmBuffer);

                let now = Date.now();

                // ✅ SPEECH DETECTED
                if (energy > SILENCE_THRESHOLD) {
                    lastSpeechTime = now;
                    isUserSpeaking = true;

                    // stop retry timer
                    if (silenceTimer) clearTimeout(silenceTimer);
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

                    // reset speaking flag after processing
                    isUserSpeaking = false;

                    processing = false;
                }
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call Ended");
            }

        } catch (err) {
            console.log("❌ Error:", err.message);
        }
    });

    // ================= SILENCE TIMER =================
    function startSilenceTimer() {

        if (silenceTimer) clearTimeout(silenceTimer);

        silenceTimer = setTimeout(async () => {

            if (!isUserSpeaking && lastQuestion) {

                if (retryCount >= MAX_RETRY) {
                    console.log("📴 No response, ending call");

                    await sendTTS(ws, streamSid,
                        "We are ending the call due to no response"
                    );

                    setTimeout(() => ws.close(), 3000);
                    return;
                }

                retryCount++;

                console.log("🔁 Repeating question:", lastQuestion);

                await sendTTS(ws, streamSid, lastQuestion);
            }

        }, NO_RESPONSE_TIMEOUT);
    }

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

                // ✅ SAVE LAST QUESTION
                lastQuestion = extractTextFromAudioUrl(data.audio_url);

                retryCount = 0;

                startSilenceTimer();
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


// ================= OPTIONAL HELPER =================
function extractTextFromAudioUrl(url) {
    // fallback if backend doesn't send text
    return "";
}
