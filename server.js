const WebSocket = require('ws');
const axios = require('axios');

const server = new WebSocket.Server({ port: process.env.PORT });

server.on('connection', (ws) => {
    console.log('Exotel connected');

    let call_id = "";

    ws.on('message', async (msg) => {
        try {
            let data = JSON.parse(msg.toString());

            console.log("EVENT:", data.event);

            if (data.event === "start") {
                call_id = data.start.call_sid;

                // initial greeting
                let res = await axios.get("https://www.shopanzaservices.in/app_files/response.aspx?step=start&call_id=" + call_id);

                await sendAudio(ws, res.data.audio_url);
            }

            if (data.event === "media") {
                // send audio chunk to backend
                let res = await axios.post("https://www.shopanzaservices.in/app_files/response.aspx", {
                    call_id: call_id,
                    audio: data.media.payload
                });

                await sendAudio(ws, res.data.audio_url);

                if (res.data.status === "completed") {
                    setTimeout(() => {
                        ws.send(JSON.stringify({ event: "stop" }));
                    }, 3000);
                }
            }

        } catch (e) {
            console.log("Error:", e.message);
        }
    });

    ws.send(JSON.stringify({ event: "connected" }));
});

async function sendAudio(ws, url) {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(res.data).toString('base64');

    ws.send(JSON.stringify({
        event: "media",
        media: { payload: base64 }
    }));
}
