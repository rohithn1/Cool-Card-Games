import Peer, { DataConnection } from 'peerjs';
import { GameState, GameMessage } from '@/types/game';
import { v4 as uuidv4 } from 'uuid';

type MessageHandler = (message: GameMessage, senderId: string) => void;

// BroadcastChannel for same-origin communication (more reliable for local dev)
class BroadcastChannelConnection {
  private channel: BroadcastChannel | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private playerId: string = '';
  private gameCode: string = '';
  private isHost: boolean = false;
  private connectedPeers: Set<string> = new Set();

  initialize(): string {
    this.playerId = uuidv4();
    console.log('📡 BroadcastChannel initialized with ID:', this.playerId);
    return this.playerId;
  }

  joinChannel(gameCode: string) {
    this.gameCode = gameCode;
    
    if (this.channel) {
      this.channel.close();
    }
    
    this.channel = new BroadcastChannel(`reds-game-${gameCode}`);
    console.log('📡 Joined channel:', `reds-game-${gameCode}`);
    
    this.channel.onmessage = (event) => {
      const message = event.data as GameMessage;
      if (message.senderId !== this.playerId) {
        console.log('📨 BC Received:', message.type, 'from:', message.senderId);
        
        // Track connected peers
        if (!this.connectedPeers.has(message.senderId)) {
          this.connectedPeers.add(message.senderId);
          console.log('👥 New peer detected:', message.senderId);
        }
        
        this.messageHandlers.forEach(handler => handler(message, message.senderId));
      }
    };
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  send(message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    if (!this.channel) {
      console.warn('⚠️ Channel not initialized');
      return;
    }
    
    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    
    console.log('📤 BC Sending:', message.type);
    this.channel.postMessage(fullMessage);
  }

  broadcastState(state: GameState) {
    this.send({
      type: 'state_sync',
      payload: state,
    });
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
    return Array.from(this.connectedPeers);
  }

  isReady(): boolean {
    return this.channel !== null;
  }

  disconnect() {
    this.channel?.close();
    this.channel = null;
    this.connectedPeers.clear();
  }
}

class MultiplayerConnection {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private gameCode: string = '';
  private playerId: string = '';
  private isHost: boolean = false;
  private isInitialized: boolean = false;
  private initPromise: Promise<string> | null = null;
  
  // BroadcastChannel for local development
  private bcConnection: BroadcastChannelConnection | null = null;
  private useBroadcastChannel: boolean = false;

  async initialize(): Promise<string> {
    // Always use PeerJS for cross-browser compatibility
    // BroadcastChannel only works within the same browser instance
    console.log('🌐 Using PeerJS for multiplayer connections');
    return this.initializePeerJS();
  }

  private async initializePeerJS(): Promise<string> {
    // If already initializing, return the same promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // If already initialized, return the player ID
    if (this.isInitialized && this.peer && !this.peer.destroyed) {
      return this.playerId;
    }

    this.initPromise = new Promise((resolve, reject) => {
      // Clean up any existing peer
      if (this.peer) {
        this.peer.destroy();
      }

      this.playerId = uuidv4();
      
      // Use PeerJS cloud server with explicit secure config
      this.peer = new Peer(this.playerId, {
        debug: 3, // maximum logging
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        pingInterval: 5000, // Keep signaling connection alive
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
          iceCandidatePoolSize: 10,
        }
      });

      const timeoutId = setTimeout(() => {
        reject(new Error('Peer initialization timeout'));
        this.initPromise = null;
      }, 15000);

      this.peer.on('open', (id) => {
        clearTimeout(timeoutId);
        console.log('✅ Peer connected with ID:', id);
        this.isInitialized = true;
        resolve(id);
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error('❌ Peer error:', err.type, err.message);
        this.isInitialized = false;
        this.initPromise = null;
        reject(err);
      });

      this.peer.on('disconnected', () => {
        console.log('⚠️ Peer disconnected, attempting reconnect...');
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });

      this.peer.on('connection', (conn) => {
        console.log('📥 Incoming connection from:', conn.peer);
        console.log('📥 Connection object:', conn);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('call', (call) => {
        console.log('📞 Incoming call from:', call.peer);
      });
    });

    return this.initPromise;
  }

  private handleIncomingConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      console.log('✅ Connection opened with:', conn.peer);
    });

    conn.on('data', (data) => {
      console.log('📨 Received data from:', conn.peer);
      const message = data as GameMessage;
      this.handleMessage(message, conn.peer);
    });

    conn.on('close', () => {
      console.log('🔌 Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
      this.notifyPlayerLeft(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('❌ Connection error:', err);
      this.connections.delete(conn.peer);
    });
  }

  async connectToPeer(peerId: string, retries = 2): Promise<void> {
    // For BroadcastChannel, just join the channel - no direct peer connection needed
    if (this.useBroadcastChannel) {
      console.log('📡 Using BroadcastChannel - no direct connection needed');
      return Promise.resolve();
    }

    // Ensure we're initialized first
    if (!this.isInitialized || !this.peer) {
      console.log('⏳ Waiting for peer initialization...');
      await this.initialize();
    }

    if (!this.peer || this.peer.destroyed) {
      throw new Error('Peer not initialized');
    }

    console.log('🔄 Attempting to connect to peer:', peerId, `(${retries} retries left)`);

    try {
      await this.attemptConnection(peerId);
    } catch (err) {
      if (retries > 0) {
        console.log('🔁 Retrying connection...');
        await new Promise(r => setTimeout(r, 1000));
        return this.connectToPeer(peerId, retries - 1);
      }
      throw err;
    }
  }

  private async attemptConnection(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🔗 Creating connection to:', peerId);
      console.log('🔗 My peer ID:', this.playerId);
      console.log('🔗 Peer object open:', this.peer?.open);
      
      // Use standard serialization and disable 'reliable' for faster handshake
      const conn = this.peer!.connect(peerId, { 
        reliable: false, 
        serialization: 'json'
      });
      
      console.log('🔗 Connection object created:', conn);

      // Increase timeout to 30 seconds for real-world networks
      const timeoutId = setTimeout(() => {
        if (!this.connections.has(peerId)) {
          console.error('⏱️ Connection timeout to:', peerId);
          conn.close();
          reject(new Error('Connection timeout - make sure the host has the game lobby open and is not behind a strict firewall'));
        }
      }, 30000);

      conn.on('open', () => {
        clearTimeout(timeoutId);
        this.connections.set(peerId, conn);
        console.log('✅ Connected to peer:', peerId);
        resolve();
      });

      conn.on('data', (data) => {
        console.log('📨 Received data from:', peerId);
        const message = data as GameMessage;
        this.handleMessage(message, peerId);
      });

      conn.on('close', () => {
        console.log('🔌 Connection closed:', peerId);
        this.connections.delete(peerId);
        this.notifyPlayerLeft(peerId);
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error('❌ Connection error to', peerId, ':', err);
        reject(new Error('Failed to connect - the host may have closed their browser'));
      });
    });
  }

  private handleMessage(message: GameMessage, senderId: string) {
    console.log('📩 Processing message:', message.type, 'from:', senderId);
    this.messageHandlers.forEach(handler => handler(message, senderId));
  }

  private notifyPlayerLeft(playerId: string) {
    const message: GameMessage = {
      type: 'player_left',
      payload: { playerId },
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    this.messageHandlers.forEach(handler => handler(message, playerId));
  }

  onMessage(handler: MessageHandler) {
    if (this.useBroadcastChannel && this.bcConnection) {
      return this.bcConnection.onMessage(handler);
    }
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  sendToAll(message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    if (this.useBroadcastChannel && this.bcConnection) {
      this.bcConnection.send(message);
      return;
    }

    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };

    console.log('📤 Sending to all peers:', message.type);
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        conn.send(fullMessage);
      } else {
        console.warn('⚠️ Connection not open to:', peerId);
      }
    });
  }

  sendToPeer(peerId: string, message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    if (this.useBroadcastChannel && this.bcConnection) {
      // In BroadcastChannel mode, we broadcast to all (the recipient filters by ID)
      this.bcConnection.send(message);
      return;
    }

    const conn = this.connections.get(peerId);
    if (conn?.open) {
      const fullMessage: GameMessage = {
        ...message,
        timestamp: Date.now(),
        senderId: this.playerId,
      };
      console.log('📤 Sending to peer:', peerId, message.type);
      conn.send(fullMessage);
    } else {
      console.warn('⚠️ Cannot send - connection not open to:', peerId);
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
    if (this.useBroadcastChannel && this.bcConnection) {
      this.bcConnection.joinChannel(code);
    }
  }

  setIsHost(isHost: boolean) {
    this.isHost = isHost;
    if (this.useBroadcastChannel && this.bcConnection) {
      this.bcConnection.setIsHost(isHost);
    }
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
    if (this.useBroadcastChannel && this.bcConnection) {
      return this.bcConnection.getConnectedPeers();
    }
    return Array.from(this.connections.keys());
  }

  isReady(): boolean {
    if (this.useBroadcastChannel) {
      return this.bcConnection?.isReady() ?? false;
    }
    return this.isInitialized && this.peer !== null && !this.peer.destroyed;
  }

  isUsingBroadcastChannel(): boolean {
    return this.useBroadcastChannel;
  }

  disconnect() {
    if (this.useBroadcastChannel && this.bcConnection) {
      this.bcConnection.disconnect();
      this.bcConnection = null;
    }
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.isInitialized = false;
    this.initPromise = null;
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

// Helper to create game codes that include the host peer ID
export function encodeGameCode(gameCode: string, hostPeerId: string): string {
  // Simple encoding: base64 of gameCode:hostPeerId
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
