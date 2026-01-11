import Peer, { DataConnection } from 'peerjs';
import { GameState, GameMessage } from '@/types/game';
import { v4 as uuidv4 } from 'uuid';

type MessageHandler = (message: GameMessage, senderId: string) => void;

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return undefined;
}

let cachedTurnConfig: { enabled: boolean; urls: string[]; username: string; credential: string } | null = null;

async function getTurnConfig(): Promise<{ enabled: boolean; urls: string[]; username: string; credential: string }> {
  if (cachedTurnConfig) return cachedTurnConfig;
  try {
    const res = await fetch('/api/turn-config', { cache: 'no-store' });
    const data = (await res.json()) as { enabled: boolean; urls: string[]; username: string; credential: string };
    cachedTurnConfig = data;
    return data;
  } catch {
    cachedTurnConfig = { enabled: false, urls: [], username: '', credential: '' };
    return cachedTurnConfig;
  }
}

async function getIceServers(): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [
    // Cloudflare STUN
    { urls: 'stun:stun.cloudflare.com:3478' },

    // Metered STUN (harmless and sometimes helps)
    { urls: 'stun:stun.relay.metered.ca:80' },

    // Google STUN (extended list / ports)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.l.google.com:5349' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:3478' },
    { urls: 'stun:stun1.l.google.com:5349' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:5349' },
    { urls: 'stun:stun3.l.google.com:3478' },
    { urls: 'stun:stun3.l.google.com:5349' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:5349' },
  ];

  // TURN config fetched at runtime from Vercel (works even when Next doesn't inline env vars)
  const turn = await getTurnConfig();
  console.log('🧊 TURN config from /api/turn-config:', {
    enabled: turn.enabled,
    urlsCount: turn.urls.length,
    username: Boolean(turn.username),
    credential: Boolean(turn.credential),
  });

  if (turn.enabled) {
    servers.unshift({
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential,
    });
    console.log('🧊 TURN enabled for better cross-network connectivity');
  }

  return servers;
}

class MultiplayerConnection {
  private peer: Peer | null = null;
  private conns: Map<string, DataConnection> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private gameCode: string = '';
  private playerId: string = uuidv4();
  private isHost: boolean = false;
  private onPeerConnect: ((peerId: string) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private knownPeers: Set<string> = new Set(); // Track peers we should be connected to

  private notifyPlayerLeft(peerId: string) {
    const message: GameMessage = {
      type: 'player_left',
      payload: { playerId: peerId },
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    this.messageHandlers.forEach(handler => handler(message, peerId));
  }

  // Handle visibility changes (phone sleep/wake)
  private setupVisibilityHandler() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    // Remove existing handler if any
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('📱 App became visible - checking connections...');
        this.handleVisibilityResume();
      }
    };
    
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }
  
  private async handleVisibilityResume() {
    // Check if peer is still connected to signaling server
    if (!this.peer || this.peer.destroyed) {
      console.log('🔄 Peer destroyed, full reinitialization needed');
      // Notify that reconnection is needed - let the UI handle this
      this.notifyReconnectionNeeded();
      return;
    }
    
    if (!(this.peer as any).open) {
      console.log('🔄 Peer disconnected from signaling, attempting reconnect...');
      try {
        this.peer.reconnect();
        // Wait a bit for reconnection
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.error('Failed to reconnect to signaling:', e);
        this.notifyReconnectionNeeded();
        return;
      }
    }
    
    // Check and reconnect to known peers
    await this.reconnectToKnownPeers();
  }
  
  private async reconnectToKnownPeers() {
    const disconnectedPeers = Array.from(this.knownPeers).filter(peerId => {
      const conn = this.conns.get(peerId);
      return !conn || !conn.open;
    });
    
    if (disconnectedPeers.length === 0) {
      console.log('✅ All peer connections are healthy');
      return;
    }
    
    console.log(`🔄 Reconnecting to ${disconnectedPeers.length} peers...`);
    
    for (const peerId of disconnectedPeers) {
      try {
        await this.connectToPeer(peerId, 15000, 2);
        console.log(`✅ Reconnected to ${peerId.slice(0, 8)}`);
      } catch (e) {
        console.warn(`⚠️ Failed to reconnect to ${peerId.slice(0, 8)}:`, e);
      }
    }
  }
  
  private notifyReconnectionNeeded() {
    const message: GameMessage = {
      type: 'player_left', // Reuse existing type to trigger reconnection UI
      payload: { playerId: this.playerId, needsReconnect: true },
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    this.messageHandlers.forEach(handler => handler(message, this.playerId));
  }
  
  // Track a peer we should stay connected to
  addKnownPeer(peerId: string) {
    this.knownPeers.add(peerId);
  }
  
  // Remove a peer from tracking
  removeKnownPeer(peerId: string) {
    this.knownPeers.delete(peerId);
  }
  
  // Get connection health status
  getConnectionHealth(): { total: number; connected: number; peers: Array<{ id: string; connected: boolean }> } {
    const peers = Array.from(this.knownPeers).map(peerId => ({
      id: peerId,
      connected: this.conns.get(peerId)?.open ?? false,
    }));
    return {
      total: peers.length,
      connected: peers.filter(p => p.connected).length,
      peers,
    };
  }

  private attachConn(conn: DataConnection) {
    // Safety check - conn must be defined
    if (!conn) {
      console.error('❌ attachConn called with undefined connection');
      return;
    }
    
    const remoteId = conn.peer;
    if (!remoteId) {
      console.error('❌ Connection has no peer ID');
      return;
    }
    
    this.conns.set(remoteId, conn);
    this.knownPeers.add(remoteId); // Track this peer for reconnection

    // Extra diagnostics to help debug NAT issues
    try {
      const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (pc) {
        pc.oniceconnectionstatechange = () => {
          const state = pc.iceConnectionState;
          console.log(`🧊 ICE(${remoteId.slice(0, 8)}):`, state);
          
          // Handle ICE failures with restart attempt
          if (state === 'failed' && pc.restartIce) {
            console.log('🔄 Attempting ICE restart...');
            pc.restartIce();
          }
        };
        pc.onconnectionstatechange = () => {
          console.log(`🔌 PC(${remoteId.slice(0, 8)}):`, pc.connectionState);
        };
      }
    } catch {}

    conn.on('open', () => {
      console.log('🔗 PeerJS connected:', remoteId);
      this.onPeerConnect?.(remoteId);
    });

    conn.on('data', (data: unknown) => {
      try {
        const msg = typeof data === 'string' ? (JSON.parse(data) as GameMessage) : (data as GameMessage);
        this.messageHandlers.forEach(handler => handler(msg, remoteId));
      } catch {
        // ignore malformed packets
      }
    });

    conn.on('close', () => {
      this.conns.delete(remoteId);
      this.notifyPlayerLeft(remoteId);
    });

    conn.on('error', (err: unknown) => {
      console.warn('⚠️ PeerJS connection error:', err);
    });
  }

  private async connectToPeer(peerId: string, timeoutMs = 20000, maxRetries = 3): Promise<void> {
    if (!this.peer) throw new Error('PeerJS not initialized');
    
    // Check if peer is actually ready/open
    if (!(this.peer as any).open) {
      throw new Error('PeerJS peer is not open - try again');
    }
    
    const existing = this.conns.get(peerId);
    if (existing?.open) return;

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Connection attempt ${attempt}/${maxRetries} to ${peerId.slice(0, 8)}...`);
        
        // Verify peer is still valid before each attempt
        if (!this.peer || !(this.peer as any).open) {
          throw new Error('PeerJS peer became unavailable');
        }
        
        // Close any existing failed connection before retrying
        const existingConn = this.conns.get(peerId);
        if (existingConn && !existingConn.open) {
          try { existingConn.close(); } catch {}
          this.conns.delete(peerId);
        }
        
        const conn = this.peer.connect(peerId, { reliable: true, serialization: 'json' });
        
        // Critical: Check if connect() returned a valid connection
        if (!conn) {
          throw new Error('Failed to create connection - peer may not be ready');
        }
        
        this.attachConn(conn);

        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            try { conn.close(); } catch {}
            reject(new Error(`Connection timeout (attempt ${attempt})`));
          }, timeoutMs);
          
          conn.once('open', () => {
            clearTimeout(t);
            console.log(`✅ Connection established on attempt ${attempt}`);
            resolve();
          });
          
          conn.once('error', (err: unknown) => {
            clearTimeout(t);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        });
        
        // If we get here, connection succeeded
        return;
        
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`⚠️ Connection attempt ${attempt} failed:`, lastError.message);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s between retries
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('Connection failed after all retries');
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  onPeerJoined(callback: (peerId: string) => void) {
    this.onPeerConnect = callback;
    // Notify about already connected peers
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
    this.conns.forEach((conn) => {
      if (conn.open) conn.send(data);
    });
  }

  sendToPeer(peerId: string, message: Omit<GameMessage, 'timestamp' | 'senderId'>) {
    const fullMessage: GameMessage = {
      ...message,
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    const data = JSON.stringify(fullMessage);
    const conn = this.conns.get(peerId);
    if (conn?.open) {
      conn.send(data);
      return;
    }
    // Fire and forget: attempt to connect then send
    this.connectToPeer(peerId).then(() => {
      const c = this.conns.get(peerId);
      if (c?.open) c.send(data);
    }).catch(() => {});
  }

  broadcastState(state: GameState) {
    this.sendToAll({
      type: 'state_sync',
      payload: state,
    });
  }

  // Relay state to all peers EXCEPT the specified one (used by host to relay non-host state changes)
  relayStateExcept(state: GameState, excludePeerId: string) {
    const fullMessage: GameMessage = {
      type: 'state_sync',
      payload: state,
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    const data = JSON.stringify(fullMessage);
    this.conns.forEach((conn, peerId) => {
      if (conn.open && peerId !== excludePeerId) {
        conn.send(data);
      }
    });
  }

  setGameCode(code: string) {
    this.gameCode = code;
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
    return Array.from(this.conns.entries())
      .filter(([, conn]) => conn.open)
      .map(([id]) => id);
  }

  isReady(): boolean {
    return Boolean(this.peer && (this.peer as any).open);
  }

  isUsingBroadcastChannel(): boolean {
    return false;
  }

  async initialize(): Promise<string> {
    if (typeof window === 'undefined') return this.playerId;
    if (this.peer && (this.peer as any).open) return this.playerId;

    const iceServers = await getIceServers();
    const hasTurn = iceServers.some((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some((u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
    });
    console.log('🧊 ICE servers:', iceServers.map(s => s.urls));
    console.log('🧊 TURN present in config:', hasTurn);

    const forceRelay = parseBooleanEnv(process.env.NEXT_PUBLIC_FORCE_RELAY) ?? false;
    if (forceRelay) console.log('🧊 Forcing TURN relay-only (NEXT_PUBLIC_FORCE_RELAY=true)');

    const host = process.env.NEXT_PUBLIC_PEERJS_HOST || '0.peerjs.com';
    const port = Number(process.env.NEXT_PUBLIC_PEERJS_PORT || 443);
    const secure = parseBooleanEnv(process.env.NEXT_PUBLIC_PEERJS_SECURE) ?? true;
    const path = process.env.NEXT_PUBLIC_PEERJS_PATH || '/';

    this.peer = new Peer(this.playerId, {
      host,
      port,
      secure,
      path,
      config: { iceServers, iceTransportPolicy: forceRelay ? 'relay' : 'all' },
      debug: 3,
    });

    this.peer.on('connection', (conn: DataConnection) => {
      // Host receives incoming connections, joiners may also receive (rare) if others connect to them.
      this.attachConn(conn);
    });

    this.peer.on('disconnected', () => {
      console.warn('⚠️ PeerJS disconnected from signaling server, attempting reconnect...');
      // Attempt to reconnect to signaling server with retry
      const attemptReconnect = (retryCount = 0) => {
        if (this.peer && !this.peer.destroyed) {
          try {
            this.peer.reconnect();
            console.log('🔄 Reconnecting to signaling server...');
          } catch (e) {
            console.error('Failed to reconnect:', e);
            // Retry up to 3 times with increasing delay
            if (retryCount < 3) {
              setTimeout(() => attemptReconnect(retryCount + 1), 1000 * (retryCount + 1));
            }
          }
        }
      };
      setTimeout(() => attemptReconnect(), 1000);
    });
    
    this.peer.on('error', (err: unknown) => {
      const errorType = (err as any)?.type;
      console.error('❌ PeerJS error:', errorType, err);
      
      // Handle specific error types that can be recovered
      if (errorType === 'network' || errorType === 'server-error' || errorType === 'socket-error') {
        console.log('🔄 Attempting recovery from network error...');
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed) {
            try {
              this.peer.reconnect();
            } catch (e) {
              console.error('Recovery failed:', e);
            }
          }
        }, 2000);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PeerJS initialization timeout')), 15000);
      this.peer!.once('open', () => {
        clearTimeout(t);
        console.log('✨ PeerJS initialized with ID:', this.playerId, 'via', `${secure ? 'wss' : 'ws'}://${host}:${port}${path}`);
        resolve();
      });
      this.peer!.once('error', (err: unknown) => {
        clearTimeout(t);
        reject(err);
      });
    });

    // Setup visibility change handler for phone sleep/wake
    this.setupVisibilityHandler();

    return this.playerId;
  }

  async connectToHost(hostPeerId: string) {
    await this.connectToPeer(hostPeerId);
  }

  disconnect() {
    // Clean up visibility handler
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    
    this.conns.forEach((c) => c.close());
    this.conns.clear();
    this.knownPeers.clear();
    this.peer?.destroy();
    this.peer = null;
  }
  
  // Force reconnect all connections (can be called from UI)
  async forceReconnect(): Promise<boolean> {
    console.log('🔄 Force reconnecting all connections...');
    
    if (!this.peer || this.peer.destroyed) {
      console.log('⚠️ Peer is destroyed, needs full reinitialization');
      return false;
    }
    
    // Reconnect to signaling if needed
    if (!(this.peer as any).open) {
      try {
        this.peer.reconnect();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        console.error('Failed to reconnect to signaling:', e);
        return false;
      }
    }
    
    // Reconnect to all known peers
    await this.reconnectToKnownPeers();
    
    // Return true if at least some connections are healthy
    const health = this.getConnectionHealth();
    return health.connected > 0 || health.total === 0;
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
