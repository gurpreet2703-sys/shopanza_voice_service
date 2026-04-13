const WebSocket = require("ws");
const axios = require("axios");

const server = new WebSocket.Server({ port: process.env.PORT });

// session memory
const sessions = new Map();

server.on("connection", (ws) => {

    console.log("Exotel connected");

    let session = {
        call_id: null,
        mobile: null,
        buffer: [],
        processing: false,
        timer: null
    };

    // ================= MESSAGE =================
    ws.on("message", async (msg) => {

        try {
            let data = JSON.parse(msg.toString());

            // ================= START =================
            if (data.event === "start") {

                session.call_id = data.start.call_sid;
                session.mobile = data.start.from;

                sessions.set(session.call_id, session);

                console.log("CALL START:", session.call_id);

                let res = await axios.get(
                    "https://www.shopanzaservices.in/app_files/response.aspx",
                    {
                        params: {
                            step: "start",
                            call_id: session.call_id,
                            mobile: session.mobile
                        }
                    }
                );

                if (res.data.audio_url) {
                    sendAudio(ws, res.data.audio_url);
                }
            }

            // ================= MEDIA =================
            if (data.event === "media") {

                if (!session.call_id || session.processing) return;

                session.buffer.push(data.media.payload);

                debounceProcess(session, ws);
            }

            // ================= STOP =================
            if (data.event === "stop") {
                console.log("CALL END:", session.call_id);
                sessions.delete(session.call_id);
            }

        } catch (e) {
            console.log("WS ERROR:", e.message);
        }
    });

});

// ================= DEBOUNCE PROCESS =================
function debounceProcess(session, ws) {

    clearTimeout(session.timer);

    session.timer = setTimeout(async () => {

        if (session.processing) return;

        session.processing = true;

        const audioBase64 = session.buffer.join("");
        session.buffer = [];

        try {

            let res = await axios.post(
                "https://www.shopanzaservices.in/app_files/voice_ai_handler.aspx",
                {
                    call_id: session.call_id,
                    mobile: session.mobile,
                    audio: audioBase64
                },
                {
                    headers: { "Content-Type": "application/json" }
                }
            );

            if (res.data.audio_url) {
                sendAudio(ws, res.data.audio_url);
            }

            if (res.data.status === "completed") {
                console.log("CALL COMPLETED");

                ws.send(JSON.stringify({ event: "stop" }));
            }

        } catch (err) {
            console.log("BACKEND ERROR:", err.message);
        }

        session.processing = false;

    }, 400); // FAST TURN TIME
}

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
        console.log("TTS ERROR:", err.message);
    }
}
