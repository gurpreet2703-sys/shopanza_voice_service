const WebSocket = require("ws");
const axios = require("axios");

const server = new WebSocket.Server({ port: process.env.PORT });

server.on("connection", (ws) => {
    console.log("Exotel connected");

    let call_id = "";
    let mobile = "";

    let audioBuffer = [];
    let flushTimer = null;

    let isProcessing = false;
    let callActive = false;
    let lastMediaTime = Date.now();

    // ================= FORCE END CALL =================
    const FORCE_END_TIMEOUT = setTimeout(() => {
        console.log("FORCE END CALL (timeout)");

        try {
            ws.send(JSON.stringify({ event: "stop" }));
            ws.send(JSON.stringify({ event: "hangup" }));
            ws.close();
        } catch (e) {}
    }, 2 * 60 * 1000); // 2 min max call

    // ================= SILENCE WATCHDOG =================
    const silenceCheck = setInterval(() => {
        if (!callActive) return;

        const now = Date.now();

        if (now - lastMediaTime > 10000) {
            console.log("Silence detected → ending call");

            try {
                flushAudio();
                ws.send(JSON.stringify({ event: "stop" }));
                ws.send(JSON.stringify({ event: "hangup" }));
                ws.close();
            } catch (e) {}
        }
    }, 5000);

    // ================= FLUSH AUDIO =================
    const flushAudio = async () => {
        if (!audioBuffer.length || isProcessing) return;

        isProcessing = true;

        let fullAudio = audioBuffer.join("");
        audioBuffer = [];

        try {
            const res = await axios.post(
                "https://www.shopanzaservices.in/app_files/response.aspx",
                {
                    call_id,
                    mobile,
                    audio: fullAudio
                },
                {
                    headers: { "Content-Type": "application/json" }
                }
            );

            console.log("Backend:", res.data);

            if (res.data && res.data.audio_url) {
                await sendAudio(ws, res.data.audio_url);
            }

            if (res.data && res.data.status === "completed") {
                console.log("Call completed from backend");

                ws.send(JSON.stringify({ event: "stop" }));
                ws.send(JSON.stringify({ event: "hangup" }));
                ws.close();
            }

        } catch (err) {
            console.log("Backend error:", err.message);
        } finally {
            isProcessing = false;
        }
    };

    // ================= MESSAGE HANDLER =================
    ws.on("message", async (msg) => {
        try {
            let data = JSON.parse(msg.toString());

            // ================= START =================
            if (data.event === "start") {
                call_id = data.start.call_sid;
                mobile = data.start.from;

                console.log("CALL START:", call_id, mobile);

                callActive = true;
                lastMediaTime = Date.now();

                const res = await axios.get(
                    "https://www.shopanzaservices.in/app_files/response.aspx",
                    {
                        params: {
                            step: "start",
                            call_id,
                            mobile
                        }
                    }
                );

                if (res.data && res.data.audio_url) {
                    await sendAudio(ws, res.data.audio_url);
                }
            }

            // ================= MEDIA =================
            if (data.event === "media") {
                if (!call_id) return;

                callActive = true;
                lastMediaTime = Date.now();

                audioBuffer.push(data.media.payload);

                clearTimeout(flushTimer);

                flushTimer = setTimeout(() => {
                    flushAudio();
                }, 900);

                if (audioBuffer.length > 25) {
                    flushAudio();
                }
            }

            // ================= STOP =================
            if (data.event === "stop") {
                console.log("CALL STOP RECEIVED:", call_id);

                clearTimeout(flushTimer);
                clearTimeout(FORCE_END_TIMEOUT);
                clearInterval(silenceCheck);

                ws.close();
            }

        } catch (e) {
            console.log("WS Error:", e.message);
        }
    });

    ws.on("close", () => {
        console.log("WS CLOSED:", call_id);
        clearTimeout(flushTimer);
        clearInterval(silenceCheck);
    });

    ws.send(JSON.stringify({ event: "connected" }));
});

// ================= SEND AUDIO =================
async function sendAudio(ws, url) {
    try {
        const res = await axios.get(url, { responseType: "arraybuffer" });
        const base64 = Buffer.from(res.data).toString("base64");

        ws.send(JSON.stringify({
            event: "media",
            media: { payload: base64 }
        }));

        console.log("Audio sent");

    } catch (err) {
        console.log("Audio error:", err.message);
    }
}
