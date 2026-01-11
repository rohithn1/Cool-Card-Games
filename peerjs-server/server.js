const { PeerServer } = require('peer');

const PORT = process.env.PORT || 9000;

const peerServer = PeerServer({
  port: PORT,
  path: '/',
  allow_discovery: false,
  // Enable CORS for your frontend
  corsOptions: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  },
});

peerServer.on('connection', (client) => {
  console.log(`Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Client disconnected: ${client.getId()}`);
});

console.log(`🚀 PeerJS Server running on port ${PORT}`);
console.log(`   WebSocket: ws://localhost:${PORT}/`);
console.log(`   Health check: http://localhost:${PORT}/`);

