import { joinRoom, selfId, Room } from 'trystero/torrent';
import { GameState, GameMessage, Player } from '@/types/game';

type MessageHandler = (message: GameMessage, senderId: string) => void;

class MultiplayerConnection {
  private room: Room | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private gameCode: string = '';
  private playerId: string = selfId;
  private isHost: boolean = false;
  private sendAction: any = null;

  async initialize(): Promise<string> {
    console.log('✨ Trystero initialized with ID:', this.playerId);
    return this.playerId;
  }

  private setupRoom(gameCode: string) {
    if (this.room) {
      // Room already setup for this code?
      if (this.gameCode === gameCode) return;
      this.disconnect();
    }

    this.gameCode = gameCode;
    // Use a unique namespace for the app
    const config = { appId: 'reds-card-game-v1' };
    this.room = joinRoom(config, gameCode);

    console.log('🤝 Joined Trystero room:', gameCode);

    // Setup the primary data action
    const [send, get] = this.room.makeAction('game_message');
    this.sendAction = send;

    get((data: any, peerId: string) => {
      const message = data as GameMessage;
      console.log('📨 Received message:', message.type, 'from:', peerId);
      this.messageHandlers.forEach(handler => handler(message, peerId));
    });

    this.room.onPeerJoin((peerId: string) => {
      console.log('👥 Peer joined:', peerId);
      // In Trystero, we don't need to manually notify, but we can if we want to trigger UI updates
    });

    this.room.onPeerLeave((peerId: string) => {
      console.log('🔌 Peer left:', peerId);
      this.notifyPlayerLeft(peerId);
    });
  }

  private notifyPlayerLeft(peerId: string) {
    const message: GameMessage = {
      type: 'player_left',
      payload: { playerId: peerId },
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    this.messageHandlers.forEach(handler => handler(message, peerId));
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  sendToAll(message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    if (!this.sendAction) {
      console.warn('⚠️ Cannot send: Room not initialized');
      return;
    }

    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };

    console.log('📤 Sending to all:', message.type);
    this.sendAction(fullMessage);
  }

  sendToPeer(peerId: string, message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    if (!this.sendAction) {
      console.warn('⚠️ Cannot send: Room not initialized');
      return;
    }

    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };

    console.log('📤 Sending to peer:', peerId, message.type);
    this.sendAction(fullMessage, peerId);
  }

  broadcastState(state: GameState) {
    this.sendToAll({
      type: 'state_sync',
      payload: state,
    });
  }

  setGameCode(code: string) {
    this.setupRoom(code);
  }

  setIsHost(isHost: boolean) {
    this.isHost = isHost;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getGameCode(): string {
    return this.gameCode;
  }

  isHostPlayer(): boolean {
    return this.isHost;
  }

  getConnectedPeers(): string[] {
    // Trystero doesn't give a direct array, but we can track them if needed
    // For now, return empty or implement tracking
    return [];
  }

  isReady(): boolean {
    return this.room !== null;
  }

  disconnect() {
    if (this.room) {
      this.room.leave();
      this.room = null;
      this.sendAction = null;
      this.gameCode = '';
    }
  }
}

// Singleton instance
let instance: MultiplayerConnection | null = null;

export function getMultiplayerConnection(): MultiplayerConnection {
  if (!instance) {
    instance = new MultiplayerConnection();
  }
  return instance;
}

export function resetMultiplayerConnection() {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}

// For Trystero, game code can just be the code itself, no need to encode host peer ID
// but to keep compatibility with existing UI logic, we'll keep the functions
export function encodeGameCode(gameCode: string, hostPeerId: string): string {
  // We can just use the code directly or keep the base64 for "security" feel
  const combined = `${gameCode}:${hostPeerId}`;
  if (typeof window !== 'undefined') {
    return btoa(combined);
  }
  return combined;
}

export function decodeGameCode(encoded: string): { gameCode: string; hostPeerId: string } | null {
  try {
    if (typeof window !== 'undefined') {
      const decoded = atob(encoded);
      const [gameCode, hostPeerId] = decoded.split(':');
      if (!gameCode || !hostPeerId) {
        return null;
      }
      return { gameCode, hostPeerId };
    }
    const [gameCode, hostPeerId] = encoded.split(':');
    if (!gameCode || !hostPeerId) {
      return null;
    }
    return { gameCode, hostPeerId };
  } catch (e) {
    console.error('Failed to decode game code:', e);
    return null;
  }
}
