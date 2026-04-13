const WebSocket = require('ws');
const axios = require('axios');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

console.log("WSS Server Started...");

wss.on('connection', function connection(ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";

    let audioChunks = [];
    let lastAudioTime = Date.now();

    ws.on('message', async function incoming(message) {
        try {
            const data = JSON.parse(message.toString());

            // 🔹 CONNECTED
            if (data.event === "connected") {
                console.log("Connected");
            }

            // 🔹 START
            if (data.event === "start") {
                streamSid = data.stream_sid;
                callSid = data.start.call_sid;
                from = data.start.from;

                console.log("Call Started:", callSid);

                await sendTTS(ws, streamSid, "Welcome to Shopanza Services. How may I help you?");
            }

            // 🔹 MEDIA (REAL AUDIO)
            if (data.event === "media") {

                lastAudioTime = Date.now();

                // ✅ decode base64 → buffer
                let chunk = Buffer.from(data.media.payload, 'base64');
                audioChunks.push(chunk);

                // ✅ process after ~1 sec audio
                let totalLength = audioChunks.reduce((sum, b) => sum + b.length, 0);

                if (totalLength > 8000) // ~1 sec (8kHz)
                {
                    let combinedBuffer = Buffer.concat(audioChunks);
                    audioChunks = [];

                    let base64Audio = combinedBuffer.toString('base64');

                    let response = await processAudio(callSid, from, base64Audio);

                    if (response && response.audio) {
                        await sendAudio(ws, streamSid, response.audio);
                    }
                }
            }

            // 🔹 STOP
            if (data.event === "stop") {
                console.log("Call Ended:", callSid);
            }

        } catch (err) {
            console.log("Error:", err.message);
        }
    });

    // 🔥 SILENCE HANDLER
    setInterval(async () => {
        if (streamSid && Date.now() - lastAudioTime > 5000) {
            await sendTTS(ws, streamSid, "Kindly respond or call will disconnect.");
            lastAudioTime = Date.now();
        }
    }, 2000);
});


// 🔥 SEND AUDIO (FIXED CHUNKING)
async function sendAudio(ws, streamSid, base64Audio) {

    let buffer = Buffer.from(base64Audio, 'base64');

    let chunkSize = 3200; // multiple of 320 (IMPORTANT)
    let seq = 0;

    for (let i = 0; i < buffer.length; i += chunkSize) {

        let chunk = buffer.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
            event: "media",
            stream_sid: streamSid,
            sequence_number: seq++,
            media: {
                payload: chunk.toString('base64')
            }
        }));

        await sleep(100); // smooth playback
    }

    // 🔹 MARK EVENT (important)
    ws.send(JSON.stringify({
        event: "mark",
        stream_sid: streamSid,
        mark: { name: "done" }
    }));
}


// 🔹 BACKEND CALL
async function processAudio(callSid, from, audioBase64) {
    try {
        const res = await axios.post(
            "https://www.shopanzaservices.in/app_files/response.aspx/process_voice",
            {
                call_id: callSid,
                mobile: from,
                audio: audioBase64
            },
            { timeout: 20000 }
        );

        return res.data;

    } catch (err) {
        console.log("Backend Error:", err.message);
        return null;
    }
}


// 🔹 TTS CALL
async function sendTTS(ws, streamSid, text) {
    try {
        const res = await axios.post(
            "https://www.shopanzaservices.in/app_files/response.aspx/tts",
            { text: text }
        );

        await sendAudio(ws, streamSid, res.data.audio);

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}


// 🔹 SLEEP
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
