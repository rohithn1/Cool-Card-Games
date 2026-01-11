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

  private notifyPlayerLeft(peerId: string) {
    const message: GameMessage = {
      type: 'player_left',
      payload: { playerId: peerId },
      timestamp: Date.now(),
      senderId: this.playerId,
    };
    this.messageHandlers.forEach(handler => handler(message, peerId));
  }

  private attachConn(conn: DataConnection) {
    const remoteId = conn.peer;
    this.conns.set(remoteId, conn);

    // Extra diagnostics to help debug NAT issues
    try {
      const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (pc) {
        pc.oniceconnectionstatechange = () => {
          console.log(`🧊 ICE(${remoteId}):`, pc.iceConnectionState);
        };
        pc.onconnectionstatechange = () => {
          console.log(`🔌 PC(${remoteId}):`, pc.connectionState);
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

  private async connectToPeer(peerId: string, timeoutMs = 15000): Promise<void> {
    if (!this.peer) throw new Error('PeerJS not initialized');
    const existing = this.conns.get(peerId);
    if (existing?.open) return;

    const conn = this.peer.connect(peerId, { reliable: true, serialization: 'json' });
    this.attachConn(conn);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
      conn.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      conn.once('error', (err: unknown) => {
        clearTimeout(t);
        reject(err);
      });
    });
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
      console.warn('⚠️ PeerJS disconnected from signaling server');
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

    return this.playerId;
  }

  async connectToHost(hostPeerId: string) {
    await this.connectToPeer(hostPeerId);
  }

  disconnect() {
    this.conns.forEach((c) => c.close());
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
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
