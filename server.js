const WebSocket = require('ws');
const axios = require('axios');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

console.log("WSS Server Started...");

wss.on('connection', function connection(ws) {

    let streamSid = "";
    let callSid = "";
    let from = "";
    let audioBuffer = [];

    ws.on('message', async function incoming(message) {
        try {
            const data = JSON.parse(message.toString());

            // CONNECTED
            if (data.event === "connected") {
                console.log("Connected");
            }

            // START EVENT
            if (data.event === "start") {
                streamSid = data.stream_sid;
                callSid = data.start.call_sid;
                from = data.start.from;

                console.log("Call Started:", callSid);

                // GREETING MESSAGE
                await sendTTS(ws, streamSid, "Welcome to Shopanza Services.");
            }

            // MEDIA EVENT (USER SPEAKING)
            if (data.event === "media") {
                audioBuffer.push(data.media.payload);

                // collect ~1.5 sec audio then process
                if (audioBuffer.length > 15) {
                    let combinedAudio = audioBuffer.join('');
                    audioBuffer = [];

                    let response = await processAudio(callSid, from, combinedAudio);

                    if (response && response.audio) {
                        sendAudio(ws, streamSid, response.audio);
                    }
                }
            }

            // STOP EVENT
            if (data.event === "stop") {
                console.log("Call Ended:", callSid);
            }

        } catch (err) {
            console.log("Error:", err.message);
        }
    });
});


// 🔹 SEND AUDIO BACK TO EXOTEL
function sendAudio(ws, streamSid, base64Audio) {

    ws.send(JSON.stringify({
        event: "media",
        stream_sid: streamSid,
        media: {
            payload: base64Audio
        }
    }));
}


// 🔹 HIT ASP.NET BACKEND
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


// 🔹 TEXT TO SPEECH (INITIAL GREETING)
async function sendTTS(ws, streamSid, text) {

    try {
        const res = await axios.post(
            "https://www.shopanzaservices.in/app_files/response.aspx/tts",
            { text: text }
        );

        sendAudio(ws, streamSid, res.data.audio);

    } catch (err) {
        console.log("TTS Error:", err.message);
    }
}
