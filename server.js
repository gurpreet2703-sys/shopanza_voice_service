const WebSocket = require('ws');
const axios = require('axios');

const server = new WebSocket.Server({ port: process.env.PORT });

server.on('connection', (ws) => {
    console.log('Exotel connected');

    let call_id = "";
    let mobile = "";

    ws.on('message', async (msg) => {
        try {
            let data = JSON.parse(msg.toString());

            console.log("EVENT:", data.event);

            // ================= START EVENT =================
            if (data.event === "start") {

                call_id = data.start.call_sid;
                mobile = data.start.from;

                console.log("📞 Call ID:", call_id);
                console.log("📱 Caller:", mobile);

                // send to backend (initialize session)
                let res = await axios.get(
                    "https://www.shopanzaservices.in/app_files/response.aspx",
                    {
                        params: {
                            step: "start",
                            call_id: call_id,
                            mobile: mobile
                        }
                    }
                );

                await sendAudio(ws, res.data.audio_url);
            }

            // ================= MEDIA EVENT =================
            if (data.event === "media") {

                if (!call_id) {
                    console.log("❌ call_id missing");
                    return;
                }

                // send audio chunk to backend
                let res = await axios.post(
                    "https://www.shopanzaservices.in/app_files/response.aspx",
                    {
                        call_id: call_id,
                        mobile: mobile,
                        audio: data.media.payload
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );

                console.log("Backend Response:", res.data);

                // send audio reply
                if (res.data.audio_url) {
                    await sendAudio(ws, res.data.audio_url);
                }

                // if booking completed → end call
                if (res.data.status === "completed") {
                    console.log("✅ Booking completed, ending call");

                    setTimeout(() => {
                        ws.send(JSON.stringify({ event: "stop" }));
                    }, 4000);
                }
            }

            // ================= STOP EVENT =================
            if (data.event === "stop") {
                console.log("📴 Call ended:", call_id);
            }

        } catch (e) {
            console.log("❌ Error:", e.message);
        }
    });

    ws.send(JSON.stringify({ event: "connected" }));
});

// ================= SEND AUDIO =================
async function sendAudio(ws, url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });

        const base64 = Buffer.from(res.data).toString('base64');

        ws.send(JSON.stringify({
            event: "media",
            media: {
                payload: base64
            }
        }));

        console.log("🔊 Audio sent");

    } catch (err) {
        console.log("❌ Audio fetch error:", err.message);
    }
}
