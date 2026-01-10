import Peer from 'simple-peer';
import { GameState, GameMessage, Player } from '@/types/game';
import { v4 as uuidv4 } from 'uuid';

// Polyfill for simple-peer in Next.js environment
if (typeof window !== 'undefined') {
  (window as any).global = window;
  if (!(window as any).process) {
    (window as any).process = { nextTick: (fn: Function) => setTimeout(fn, 0), env: {} };
  }
}

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
        if (event.data.from === this.playerId) return;
        this.messageHandlers.forEach(handler => handler(event.data));
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
  
  // Track "Virtual" peers connected via BroadcastChannel (local tabs only)
  private virtualPeers: Set<string> = new Set();

  async initialize(): Promise<string> {
    console.log('✨ Simple-peer (Hybrid) initialized with ID:', this.playerId);
    return this.playerId;
  }

  private setupSignaling(gameCode: string) {
    if (this.signaling) this.signaling.close();
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);

    this.signaling = new SignalingChannel(gameCode, this.playerId);

    this.signaling.onMessage((data) => {
      const { type, payload, from, to } = data;

      // 1. Discovery handling
      if (type === 'discovery' && this.isHost) {
        console.log('👥 Host discovered peer:', from);
        // Instant "Virtual" connection for local tabs
        this.virtualPeers.add(from);
        this.signaling?.send({ type: 'discovery_ack', to: from });
        
        // Also start WebRTC for cross-device support
        if (!this.peers.has(from)) {
          setTimeout(() => this.initiateWebRTC(from), 1000);
        }
      } 
      
      else if (type === 'discovery_ack' && to === this.playerId) {
        console.log('✅ Discovery acknowledged by host');
        this.virtualPeers.add(from);
        if (this.onPeerConnect) this.onPeerConnect(from);
      }

      // 2. WebRTC Signaling
      else if (type === 'signal' && to === this.playerId) {
        let peer = this.peers.get(from);
        if (!peer || peer.destroyed) {
          peer = this.createWebRTCPeer(from, false);
        }
        peer.signal(payload);
      }

      // 3. Data fallback (Virtual Peer path)
      else if (type === 'data' && (to === this.playerId || !to)) {
        // Only process if we don't have a solid WebRTC connection to this peer yet
        const webrtcPeer = this.peers.get(from);
        if (!webrtcPeer || !webrtcPeer.connected) {
          try {
            const message = JSON.parse(payload) as GameMessage;
            this.messageHandlers.forEach(handler => handler(message, from));
          } catch (e) {}
        }
      }
    });

    if (!this.isHost) {
      this.signaling.send({ type: 'discovery' });
      this.discoveryInterval = setInterval(() => {
        if (this.getConnectedPeers().length === 0) {
          this.signaling?.send({ type: 'discovery' });
        }
      }, 3000);
    }
  }

  private initiateWebRTC(peerId: string) {
    if (this.peers.has(peerId)) return;
    this.createWebRTCPeer(peerId, true);
  }

  private createWebRTCPeer(peerId: string, initiator: boolean): Peer.Instance {
    console.log(`🛠 Creating WebRTC peer (${initiator ? 'initiator' : 'receiver'}) for:`, peerId);
    
    const peer = new Peer({
      initiator,
      trickle: true, // Enable trickle for better compatibility
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (signal) => {
      this.signaling?.send({ type: 'signal', payload: signal, to: peerId });
    });

    peer.on('connect', () => {
      console.log('⚡ WebRTC connected to:', peerId);
      if (this.onPeerConnect) this.onPeerConnect(peerId);
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString()) as GameMessage;
        this.messageHandlers.forEach(handler => handler(message, peerId));
      } catch (e) {}
    });

    peer.on('close', () => {
      this.peers.delete(peerId);
      this.virtualPeers.delete(peerId);
      this.notifyPlayerLeft(peerId);
    });

    peer.on('error', (err) => {
      console.warn('⚠️ WebRTC connection failed, falling back to BroadcastChannel:', err.message);
      peer.destroy();
      this.peers.delete(peerId);
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
    // Notify about already connected virtual or webrtc peers
    this.getConnectedPeers().forEach(id => callback(id));
    return () => { this.onPeerConnect = null; };
  }

  sendToAll(message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    const data = JSON.stringify(fullMessage);

    // Try WebRTC first for all peers
    this.peers.forEach((peer, id) => {
      if (peer.connected) {
        peer.send(data);
      } else {
        // Fallback to signaling channel for virtual/connecting peers
        this.signaling?.send({ type: 'data', payload: data, to: id });
      }
    });

    // Also send to virtual peers that might not have a WebRTC object yet
    this.virtualPeers.forEach(id => {
      if (!this.peers.has(id)) {
        this.signaling?.send({ type: 'data', payload: data, to: id });
      }
    });
  }

  sendToPeer(peerId: string, message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    const data = JSON.stringify(fullMessage);

    const peer = this.peers.get(peerId);
    if (peer?.connected) {
      peer.send(data);
    } else {
      // Fallback for virtual peers
      this.signaling?.send({ type: 'data', payload: data, to: peerId });
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
    const allPeers = new Set([...this.virtualPeers, ...Array.from(this.peers.keys()).filter(id => this.peers.get(id)?.connected)]);
    return Array.from(allPeers);
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
    this.virtualPeers.clear();
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
