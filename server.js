const WebSocket = require('ws');

const server = new WebSocket.Server({ port: process.env.PORT });

server.on('connection', (ws) => {
    console.log('Client connected');

    ws.send(JSON.stringify({
        event: "connected",
        message: "WebSocket working"
    }));

    ws.on('message', (msg) => {
        console.log('Received:', msg.toString());
    });
});
