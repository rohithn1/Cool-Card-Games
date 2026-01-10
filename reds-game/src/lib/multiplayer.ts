import Peer from 'simple-peer';
import { GameState, GameMessage, Player } from '@/types/game';
import { v4 as uuidv4 } from 'uuid';

type MessageHandler = (message: GameMessage, senderId: string) => void;

class SignalingChannel {
  private bc: BroadcastChannel | null = null;
  private messageHandlers: Set<(data: any) => void> = new Set();
  private gameCode: string = '';
  private playerId: string = '';

  constructor(gameCode: string, playerId: string) {
    this.gameCode = gameCode;
    this.playerId = playerId;
    if (typeof window !== 'undefined') {
      this.bc = new BroadcastChannel(`reds-signaling-${gameCode}`);
      this.bc.onmessage = (event) => {
        // IMPORTANT: Ignore messages from ourselves
        if (event.data.from === this.playerId) return;
        
        if (event.data.to === this.playerId || !event.data.to) {
          this.messageHandlers.forEach(handler => handler(event.data));
        }
      };
    }
  }

  onMessage(handler: (data: any) => void) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  send(data: any) {
    if (this.bc) {
      this.bc.postMessage({ ...data, from: this.playerId });
    }
  }

  close() {
    this.bc?.close();
    this.bc = null;
    this.messageHandlers.clear();
  }
}

class MultiplayerConnection {
  private peers: Map<string, Peer.Instance> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private gameCode: string = '';
  private playerId: string = uuidv4();
  private isHost: boolean = false;
  private signaling: SignalingChannel | null = null;
  private onPeerConnect: ((peerId: string) => void) | null = null;
  private discoveryInterval: any = null;

  async initialize(): Promise<string> {
    console.log('✨ Simple-peer initialized with ID:', this.playerId);
    return this.playerId;
  }

  private setupSignaling(gameCode: string) {
    if (this.signaling) this.signaling.close();
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);

    this.signaling = new SignalingChannel(gameCode, this.playerId);

    this.signaling.onMessage((data) => {
      const { type, signal, from, to } = data;

      if (type === 'discovery' && this.isHost) {
        console.log('👥 Host discovered peer:', from);
        this.initiateConnection(from);
      } else if (type === 'signal' && to === this.playerId) {
        console.log('📨 Received signal from:', from);
        let peer = this.peers.get(from);
        if (!peer) {
          peer = this.createPeer(from, false);
        }
        peer.signal(signal);
      }
    });

    if (!this.isHost) {
      console.log('📡 Joiner broadcasting discovery for room:', gameCode);
      this.signaling.send({ type: 'discovery' });
      
      this.discoveryInterval = setInterval(() => {
        if (this.getConnectedPeers().length === 0 && this.signaling) {
          console.log('📡 Retrying discovery...');
          this.signaling.send({ type: 'discovery' });
        } else {
          clearInterval(this.discoveryInterval);
        }
      }, 3000);
    }
  }

  private initiateConnection(peerId: string) {
    if (this.peers.has(peerId)) return;
    console.log('🔗 Initiating connection to:', peerId);
    this.createPeer(peerId, true);
  }

  private createPeer(peerId: string, initiator: boolean): Peer.Instance {
    // Check if we already have a peer for this ID to avoid double-connecting
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId)!;
    }

    console.log(`🛠 Creating peer (${initiator ? 'initiator' : 'receiver'}) for:`, peerId);
    
    const peer = new Peer({
      initiator,
      // DISABLE TRICKLE for local stability. 
      // It sends one large signal instead of many small ones.
      trickle: false, 
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    peer.on('signal', (signal) => {
      console.log('📤 Sending signal to:', peerId);
      this.signaling?.send({ type: 'signal', signal, to: peerId });
    });

    peer.on('connect', () => {
      console.log('✅ Connected to peer:', peerId);
      if (this.onPeerConnect) {
        this.onPeerConnect(peerId);
      }
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString()) as GameMessage;
        this.messageHandlers.forEach(handler => handler(message, peerId));
      } catch (e) {
        console.error('Failed to parse peer data:', e);
      }
    });

    peer.on('close', () => {
      console.log('🔌 Peer closed:', peerId);
      this.peers.delete(peerId);
      this.notifyPlayerLeft(peerId);
    });

    peer.on('error', (err) => {
      console.error('❌ Peer error:', err.message);
      // Don't delete immediately to allow for a retry if needed, 
      // but close it to be safe.
      peer.destroy();
    });

    this.peers.set(peerId, peer);
    return peer;
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

  onPeerJoined(callback: (peerId: string) => void) {
    this.onPeerConnect = callback;
    this.peers.forEach((peer, id) => {
      if (peer.connected) callback(id);
    });
    return () => { this.onPeerConnect = null; };
  }

  sendToAll(message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };

    const data = JSON.stringify(fullMessage);
    this.peers.forEach((peer) => {
      if (peer.connected) {
        peer.send(data);
      }
    });
  }

  sendToPeer(peerId: string, message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    const peer = this.peers.get(peerId);
    if (peer?.connected) {
      const fullMessage: GameMessage = {
        ...message,
        timestamp: Date.now(),
        senderId: this.playerId,
      };
      peer.send(JSON.stringify(fullMessage));
    }
  }

  broadcastState(state: GameState) {
    this.sendToAll({
      type: 'state_sync',
      payload: state,
    });
  }

  setGameCode(code: string) {
    this.gameCode = code;
    this.setupSignaling(code);
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
    return Array.from(this.peers.keys()).filter(id => this.peers.get(id)?.connected);
  }

  isReady(): boolean {
    return true;
  }

  isUsingBroadcastChannel(): boolean {
    return true;
  }

  disconnect() {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    this.peers.forEach(peer => peer.destroy());
    this.peers.clear();
    this.signaling?.close();
    this.signaling = null;
  }
}

let instance: MultiplayerConnection | null = null;

export function getMultiplayerConnection(): MultiplayerConnection {
  if (!instance) instance = new MultiplayerConnection();
  return instance;
}

export function resetMultiplayerConnection() {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}

export function encodeGameCode(gameCode: string, hostPeerId: string): string {
  const combined = `${gameCode}:${hostPeerId}`;
  if (typeof window !== 'undefined') return btoa(combined);
  return combined;
}

export function decodeGameCode(encoded: string): { gameCode: string; hostPeerId: string } | null {
  try {
    const decoded = typeof window !== 'undefined' ? atob(encoded) : encoded;
    const [gameCode, hostPeerId] = decoded.split(':');
    if (!gameCode || !hostPeerId) return null;
    return { gameCode, hostPeerId };
  } catch (e) {
    return null;
  }
}
