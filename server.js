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
    let isProcessing = false; // Prevents duplicate backend calls while waiting for AI
    let warningGiven = false;

    console.log("🔌 New Connection established");

    ws.on('message', async function incoming(message) {
        try {
            const msg = JSON.parse(message.toString());

            // ================= CONNECTED =================
            if (msg.event === "connected") {
                console.log("✅ Exotel Connected");
            }

            // ================= START =================
            if (msg.event === "start") {
                streamSid = msg.stream_sid;
                callSid = msg.start.call_sid;
                from = msg.start.from;

                console.log(`📞 Call Started: ${callSid} from ${from}`);

                // Initial Greeting
                await sendTTS(ws, streamSid, "Welcome to Shopanza Services. How may I help you?");
            }

            // ================= MEDIA (The Core Logic) =================
            if (msg.event === "media") {
                // If AI is currently "speaking" or "processing", we don't buffer new noise
                if (isProcessing) return;

                audioBuffer.push(msg.media.payload);

                // Clear the previous timer every time new audio data arrives
                if (silenceTimer) clearTimeout(silenceTimer);

                // Set a timer to detect end-of-speech (1.5 seconds of silence)
                silenceTimer = setTimeout(async () => {
                    
                    if (audioBuffer.length === 0) {
                        // Handle extreme silence (No speech at all)
                        if (!warningGiven) {
                            warningGiven = true;
                            await sendTTS(ws, streamSid, "I'm sorry, I didn't hear anything. Please say that again or the call will disconnect.");
                            setTimeout(() => {
                                if (audioBuffer.length === 0) {
                                    console.log("📴 Disconnecting due to persistent silence");
                                    ws.close();
                                }
                            }, 5000);
                        }
                        return;
                    }

                    // User has spoken and then paused -> Process the audio
                    isProcessing = true; 
                    warningGiven = false;
                    
                    let combinedAudio = audioBuffer.join("");
                    audioBuffer = []; // Reset buffer for next interaction

                    console.log("🎧 Sending collected speech to backend...");

                    try {
                        const res = await axios.post(
                            `${BACKEND_URL}/process_voice`,
                            {
                                audio: combinedAudio,
                                call_sid: callSid,
                                from: from
                            },
                            { 
                                headers: { "Content-Type": "application/json" },
                                timeout: 15000 
                            }
                        );

                        const data = res.data.d; // ASP.NET wrapper
                        console.log("🤖 AI Response Received:", data);

                        if (data && data.audio_url) {
                            await streamAudio(ws, streamSid, data.audio_url);
                        }

                        // Close call if booking is finished
                        if (data && data.status === "completed") {
                            console.log("✅ Flow Completed. Hanging up in 4s...");
                            setTimeout(() => ws.close(), 4000);
                        }

                    } catch (err) {
                        console.error("❌ Backend Processing Error:", err.message);
                    } finally {
                        isProcessing = false; // Allow next round of listening
                    }

                }, 1500); // 1.5s silence threshold
            }

            // ================= STOP =================
            if (msg.event === "stop") {
                console.log("📴 Call Ended by user");
                if (silenceTimer) clearTimeout(silenceTimer);
            }

        } catch (err) {
            console.error("❌ WebSocket Message Error:", err.message);
        }
    });

    ws.on('close', () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        console.log("🔌 Connection Closed");
    });
});

// ================= HELPER: SEND TEXT TO SPEECH =================
async function sendTTS(ws, streamSid, text) {
    try {
        const res = await axios.post(
            `${BACKEND_URL}/tts_direct`,
            { text: text },
            { headers: { "Content-Type": "application/json" } }
        );

        const audioUrl = res.data.d.audio_url;
        console.log("🔊 Playing TTS:", text);

        await streamAudio(ws, streamSid, audioUrl);
    } catch (err) {
        console.error("TTS Error:", err.message);
    }
}

// ================= HELPER: STREAM WAV TO EXOTEL =================
async function streamAudio(ws, streamSid, audioUrl) {
    try {
        const response = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Exotel expects 160-byte (10ms) or 3200-byte (200ms) chunks for 8kHz
        const chunkSize = 3200; 
        let chunkCount = 0;

        for (let i = 0; i < buffer.length; i += chunkSize) {
            const chunk = buffer.slice(i, i + chunkSize);

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    event: "media",
                    stream_sid: streamSid,
                    media: {
                        payload: chunk.toString('base64')
                    }
                }));
                chunkCount++;
            }
        }

        console.log(`🔊 Streamed ${chunkCount} chunks to Exotel`);

        // Send Mark to signal end of audio playback
        ws.send(JSON.stringify({
            event: "mark",
            stream_sid: streamSid,
            mark: { name: "audio_end" }
        }));

    } catch (err) {
        console.error("Stream Audio Error:", err.message);
    }
}
