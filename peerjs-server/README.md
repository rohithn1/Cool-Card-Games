# REDS PeerJS Signaling Server

A minimal PeerJS signaling server for the REDS card game.

## Quick Deploy Options

### Railway (Recommended - Free tier available)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app)
3. Create new project → Deploy from GitHub
4. Railway will auto-detect and deploy

### Render (Free tier available)
1. Push to GitHub
2. Go to [render.com](https://render.com)
3. Create new Web Service → Connect repo
4. Use these settings:
   - Build Command: `npm install`
   - Start Command: `npm start`

### Fly.io
```bash
fly launch
fly deploy
```

### Local Testing
```bash
npm install
npm start
```

## Configuration

After deployment, set these environment variables in your REDS game:

```env
NEXT_PUBLIC_PEERJS_HOST=your-server.railway.app
NEXT_PUBLIC_PEERJS_PORT=443
NEXT_PUBLIC_PEERJS_SECURE=true
NEXT_PUBLIC_PEERJS_PATH=/
```

Replace `your-server.railway.app` with your actual deployed server URL.

