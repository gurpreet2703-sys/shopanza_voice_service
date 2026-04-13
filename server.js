const WebSocket = require("ws");
const axios = require("axios");

const server = new WebSocket.Server({ port: process.env.PORT });

server.on("connection", (ws) => {
    console.log("Exotel connected");

    let call_id = "";
    let mobile = "";

    let audioBuffer = [];
    let flushTimer = null;

    // ================= FLUSH FUNCTION =================
    const flushAudio = async () => {

        if (!audioBuffer.length) return;

        let fullAudio = audioBuffer.join("");
        audioBuffer = [];

        try {
            let res = await axios.post(
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

            if (res.data.audio_url) {
                await sendAudio(ws, res.data.audio_url);
            }

            if (res.data.status === "completed") {
                console.log("Call completed");

                ws.send(JSON.stringify({ event: "stop" }));
            }

        } catch (err) {
            console.log("Backend error:", err.message);
        }
    };

    ws.on("message", async (msg) => {
        try {
            let data = JSON.parse(msg.toString());

            // ================= START =================
            if (data.event === "start") {

                call_id = data.start.call_sid;
                mobile = data.start.from;

                console.log("CALL START:", call_id, mobile);

                let res = await axios.get(
                    "https://www.shopanzaservices.in/app_files/response.aspx",
                    {
                        params: {
                            step: "start",
                            call_id,
                            mobile
                        }
                    }
                );

                await sendAudio(ws, res.data.audio_url);
            }

            // ================= MEDIA =================
            if (data.event === "media") {

                if (!call_id) return;

                audioBuffer.push(data.media.payload);

                // reset silence timer
                clearTimeout(flushTimer);

                flushTimer = setTimeout(() => {
                    flushAudio();
                }, 900); // speech pause detection

                // safety flush (prevents infinite buffer)
                if (audioBuffer.length > 25) {
                    flushAudio();
                }
            }

            // ================= STOP =================
            if (data.event === "stop") {
                console.log("Call ended:", call_id);
            }

        } catch (e) {
            console.log("WS Error:", e.message);
        }
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
