# REDS - The Card Game

A multiplayer card game where players try to have the lowest sum of cards when someone calls "Reds!"

## 🎮 How to Play

### Setup
1. One player creates a game and shares the game code with friends
2. Other players join using the game code
3. Each player is dealt 4 cards face down
4. Players can view their bottom 2 cards ONCE at the start

### Gameplay
1. **Drawing**: On your turn, draw from the deck OR take the top card from the discard pile
2. **Deciding**: After drawing, either:
   - Swap the drawn card with one of your face-down cards
   - Discard the drawn card

### Power-Up Cards
When you discard these cards, you get special abilities:
- **7**: Peek at one of your own cards
- **8**: Peek at one of another player's cards  
- **9**: Blindly swap one of your cards with another player's
- **10**: Peek at another player's card, then optionally swap

### Stacking
- If you know a card that matches the top of the discard pile, you can stack it!
- You can stack your own cards OR another player's cards (if you know them)
- When stacking another player's card, you transfer one of your cards to them
- **Misstack penalty**: If you stack the wrong card, you draw an extra penalty card

### Calling Reds
- When confident you have the lowest total, call "Reds!" on your turn
- You forfeit your turn, but everyone else gets one final turn
- All cards are revealed and the lowest sum wins!

### Card Values
| Card | Value |
|------|-------|
| Ace | 1 |
| 2-10 | Face value |
| Jack | 11 |
| Queen | 12 |
| Black King (♠♣) | 13 |
| Red King (♥♦) | **-2** |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
cd reds-game
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Production Build

```bash
npm run build
npm start
```

## 🌐 Deployment

This app is designed to be deployed on Vercel:

1. Push to GitHub
2. Import in Vercel
3. Deploy!

### PeerJS Signaling Server (Recommended)

⚠️ **The default public PeerJS server (`0.peerjs.com`) is often unreliable.** For production use, deploy your own PeerJS signaling server:

1. Deploy the `peerjs-server/` folder to Railway, Render, or Fly.io (all have free tiers)
2. Set these environment variables in Vercel:

```
NEXT_PUBLIC_PEERJS_HOST=your-server.railway.app
NEXT_PUBLIC_PEERJS_PORT=443
NEXT_PUBLIC_PEERJS_SECURE=true
NEXT_PUBLIC_PEERJS_PATH=/
```

See `peerjs-server/README.md` for detailed deployment instructions.

### TURN Server (for cross-network reliability)

The game uses **PeerJS** (WebRTC data channels). For players on **different networks**, some NATs/firewalls require a **TURN server** to reliably connect.

Set these in Vercel (Project → Settings → Environment Variables):

- `TURN_URLS`: comma-separated TURN URLs (example: `turn:relay.metered.ca:80,turn:relay.metered.ca:443`)
- `TURN_USERNAME`: TURN username
- `TURN_CREDENTIAL`: TURN credential/password

Free TURN servers are available from [Metered.ca](https://www.metered.ca/tools/openrelay/) or [Xirsys](https://xirsys.com/).

## 🛠 Tech Stack

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **PeerJS** - WebRTC data channels + signaling
- **Zustand** - State management

## 📱 Features

- Real-time multiplayer via WebRTC
- Beautiful card game UI with animations
- Top-down table view
- Responsive design
- No server required - fully peer-to-peer
- Game state cached in browser
