'use client';

import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getMultiplayerConnection, encodeGameCode, decodeGameCode } from '@/lib/multiplayer';
import { GameMessage, Player } from '@/types/game';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';

interface LobbyProps {
  onGameStart: () => void;
}

export function Lobby({ onGameStart }: LobbyProps) {
  const {
    game,
    peerId,
    playerName,
    isHost,
    setPeerId,
    setPlayerName,
    createGame,
    joinGame,
    addPlayer,
    removePlayer,
    startGame,
    syncState,
  } = useGameStore();

  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [deckCount, setDeckCount] = useState(1);

  // Initialize peer connection - always initialize on mount
  useEffect(() => {
    let mounted = true;
    
    const initPeer = async () => {
      try {
        setConnectionStatus('connecting');
        const mp = getMultiplayerConnection();
        const id = await mp.initialize();
        if (mounted) {
          setPeerId(id);
          setConnectionStatus('connected');
          console.log('✅ Peer initialized:', id);
        }
      } catch (err) {
        console.error('Failed to initialize peer:', err);
        if (mounted) {
          setConnectionStatus('error');
          setError('Failed to connect to network. Please refresh and try again.');
        }
      }
    };

    initPeer();
    
    return () => {
      mounted = false;
    };
  }, [setPeerId]);

  // Set up message handlers
  useEffect(() => {
    if (!peerId) return;

    const mp = getMultiplayerConnection();
    
    const unsubscribe = mp.onMessage((message: GameMessage, senderId: string) => {
      console.log('Received message:', message.type, 'from:', senderId);

      switch (message.type) {
        case 'join_request': {
          // Host receives join request
          const { name, peerId: joinerPeerId } = message.payload as { name: string; peerId?: string };
          const joinerId = joinerPeerId || senderId;
          
          const newPlayer: Player = {
            id: joinerId,
            name,
            cards: [],
            isHost: false,
            isReady: false,
            isConnected: true,
            hasSeenBottomCards: false,
            hasCalledReds: false,
          };
          addPlayer(newPlayer);
          console.log('👋 Player joined:', name, joinerId);
          
          // Send current game state to new player (broadcast in BC mode)
          const currentGame = useGameStore.getState().game;
          if (currentGame) {
            // Add the new player to the game state before sending
            const updatedGame = {
              ...currentGame,
              players: [...currentGame.players, newPlayer],
            };
            
            mp.sendToAll({
              type: 'join_response',
              payload: { success: true, game: updatedGame, targetId: joinerId },
            });
            
            // Broadcast to all that a new player joined
            mp.sendToAll({
              type: 'player_joined',
              payload: newPlayer,
            });
          }
          break;
        }

        case 'join_response': {
          // Clear the response timeout if it exists
          if ((window as any).__joinResponseTimeout) {
            clearTimeout((window as any).__joinResponseTimeout);
            delete (window as any).__joinResponseTimeout;
          }
          
          // Joiner receives game state
          const { success, game: gameState, targetId } = message.payload as { 
            success: boolean; 
            game: typeof game;
            targetId?: string;
          };
          // Only process if this message is for us (or no targetId specified)
          if (success && gameState && (!targetId || targetId === peerId)) {
            console.log('✅ Received game state from host');
            syncState(gameState);
            setIsConnecting(false);
          }
          break;
        }

        case 'player_joined': {
          // All players receive notification of new player
          const player = message.payload as Player;
          if (player.id !== peerId) {
            addPlayer(player);
          }
          break;
        }

        case 'player_left': {
          const { playerId } = message.payload as { playerId: string };
          removePlayer(playerId);
          break;
        }

        case 'state_sync': {
          // Clear the response timeout if it exists (state sync means we're connected)
          if ((window as any).__joinResponseTimeout) {
            clearTimeout((window as any).__joinResponseTimeout);
            delete (window as any).__joinResponseTimeout;
          }
          
          // Receive state update from host
          const state = message.payload as typeof game;
          if (state) {
            syncState(state);
            setIsConnecting(false);
          }
          break;
        }

        case 'game_start': {
          // Clear any pending timeouts
          if ((window as any).__joinResponseTimeout) {
            clearTimeout((window as any).__joinResponseTimeout);
            delete (window as any).__joinResponseTimeout;
          }
          
          const state = message.payload as typeof game;
          if (state) {
            syncState(state);
            onGameStart();
          }
          break;
        }
      }
    });

    return () => { unsubscribe(); };
  }, [peerId, addPlayer, removePlayer, syncState, onGameStart]);

  // Broadcast state changes if host
  useEffect(() => {
    if (isHost && game) {
      const mp = getMultiplayerConnection();
      mp.broadcastState(game);
    }
  }, [isHost, game]);

  const handleCreateGame = () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    const gameCode = createGame();
    const encoded = encodeGameCode(gameCode, peerId!);
    setShareCode(encoded);
    
    const mp = getMultiplayerConnection();
    mp.setGameCode(gameCode);
    mp.setIsHost(true);
    
    setMode('create');
    setError('');
  };

  const handleJoinGame = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!joinCode.trim()) {
      setError('Please enter a game code');
      return;
    }

    if (connectionStatus !== 'connected') {
      setError('Still connecting to network. Please wait...');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      const decoded = decodeGameCode(joinCode.trim());
      if (!decoded) {
        throw new Error('Invalid game code format');
      }

      const { gameCode, hostPeerId } = decoded;
      console.log('🎮 Joining room:', gameCode);
      
      joinGame(gameCode);
      
      const mp = getMultiplayerConnection();
      mp.setGameCode(gameCode);
      mp.setIsHost(false);

      console.log('⏳ Connecting to host via PeerJS (with auto-retry)...');
      
      // Let the multiplayer module handle retries and timeouts
      // No separate timeout here - connectToHost has built-in retry logic
      await mp.connectToHost(hostPeerId);

      console.log('✨ Connected to host! Sending join request...');
      mp.sendToPeer(hostPeerId, {
        type: 'join_request',
        payload: { name: playerName, peerId: mp.getPlayerId() },
      });
      
      // Set a timeout for receiving the join response (separate from connection)
      const responseTimeout = setTimeout(() => {
        const currentGame = useGameStore.getState().game;
        // Only show error if we haven't received game state yet
        if (!currentGame || currentGame.players.length === 0) {
          setError('Connected but no response from host. They may have closed the lobby.');
          setIsConnecting(false);
        }
      }, 10000);
      
      // Store timeout ID to clear it on successful join
      (window as any).__joinResponseTimeout = responseTimeout;
      
    } catch (err) {
      console.error('Failed to join game:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      
      // Provide more helpful error messages
      let userMessage = errorMessage;
      if (errorMessage.includes('timeout')) {
        userMessage = 'Connection timed out. Make sure the host has the lobby open and try again.';
      } else if (errorMessage.includes('Could not connect') || errorMessage.includes('unavailable')) {
        userMessage = 'Could not reach the host. Check your internet connection and try again.';
      } else if (errorMessage.includes('not open') || errorMessage.includes('not initialized')) {
        userMessage = 'Network connection lost. Please refresh and try again.';
      }
      
      setError(userMessage);
      setIsConnecting(false);
    }
  };

  const handleStartGame = () => {
    if (!game || game.players.length < 2) {
      setError('Need at least 2 players to start');
      return;
    }

    // Limit to 10 players max
    if (game.players.length > 10) {
      setError('Maximum 10 players allowed');
      return;
    }

    startGame(deckCount);
    
    const mp = getMultiplayerConnection();
    const currentGame = useGameStore.getState().game;
    mp.sendToAll({
      type: 'game_start',
      payload: currentGame,
    });
    
    onGameStart();
  };

  // Auto-suggest 2 decks when more than 5 players
  useEffect(() => {
    if (game && game.players.length > 5 && deckCount === 1) {
      setDeckCount(2);
    }
  }, [game?.players.length, deckCount]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = shareCode;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 flex items-center justify-center p-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-20 felt-pattern" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className="text-center mb-8"
        >
          <Image
            src="/reds-logo.png"
            alt="REDS"
            width={280}
            height={100}
            className="mx-auto drop-shadow-lg"
            priority
          />
          <p className="text-emerald-300 mt-2 text-sm tracking-wide">(Saimo Six Seven)</p>
        </motion.div>

        <AnimatePresence mode="wait">
          {mode === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-emerald-800/50 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-emerald-700/50"
            >
              {/* Name input */}
              <div className="mb-6">
                <label className="block text-emerald-200 text-sm mb-2 font-medium">
                  Your Name
                </label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 bg-emerald-900/50 border border-emerald-600 rounded-xl text-white placeholder-emerald-500 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  maxLength={20}
                />
              </div>

              {/* Error message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-sm"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Buttons */}
              <div className="space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreateGame}
                  disabled={connectionStatus !== 'connected'}
                  className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Game
                </motion.button>
                
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setMode('join')}
                  disabled={connectionStatus !== 'connected'}
                  className="w-full py-4 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Join Game
                </motion.button>
              </div>

              {/* Connection status */}
              <div className="mt-4 text-center text-sm">
                {connectionStatus === 'connecting' && (
                  <span className="text-emerald-400 flex items-center justify-center gap-2">
                    <span className="animate-spin">⏳</span> Connecting to network...
                  </span>
                )}
                {connectionStatus === 'connected' && (
                  <span className="text-green-400">✓ Connected</span>
                )}
                {connectionStatus === 'error' && (
                  <span className="text-red-400">✗ Connection failed - refresh to retry</span>
                )}
              </div>
            </motion.div>
          )}

          {mode === 'create' && game && (
            <motion.div
              key="create"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-emerald-800/50 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-emerald-700/50"
            >
              <h2 className="text-2xl font-bold text-white mb-6 text-center">
                Game Lobby
              </h2>

              {/* Share code */}
              <div className="mb-6 p-4 bg-black/30 rounded-xl">
                <div className="text-emerald-400 text-xs mb-2 text-center">Share this code with friends</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareCode}
                    readOnly
                    className="flex-1 px-3 py-2 bg-emerald-900/50 border border-emerald-600 rounded-lg text-white text-sm font-mono text-center"
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={copyToClipboard}
                    className="px-4 py-2 bg-amber-500 text-amber-950 font-bold rounded-lg text-sm"
                  >
                    {copied ? '✓' : 'Copy'}
                  </motion.button>
                </div>
              </div>

              {/* Players list */}
              <div className="mb-6">
                <div className="text-emerald-300 text-sm mb-3">
                  Players ({game.players.length}/10)
                </div>
                <div className="space-y-2">
                  {game.players.map((player, idx) => (
                    <motion.div
                      key={player.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="flex items-center gap-3 p-3 bg-emerald-700/30 rounded-xl"
                    >
                      <div className={`w-3 h-3 rounded-full ${player.isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
                      <span className="text-white font-medium flex-1">{player.name}</span>
                      {player.isHost && (
                        <span className="text-xs px-2 py-0.5 bg-amber-500 text-amber-950 rounded-full font-bold">
                          Host
                        </span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Deck Count Selector */}
              <div className="mb-6 p-4 bg-black/30 rounded-xl">
                <div className="text-emerald-400 text-xs mb-2 text-center">Number of Decks</div>
                <div className="flex items-center justify-center gap-4">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setDeckCount(Math.max(1, deckCount - 1))}
                    disabled={deckCount <= 1}
                    className="w-10 h-10 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-xl"
                  >
                    −
                  </motion.button>
                  <div className="text-white font-bold text-2xl min-w-[3ch] text-center">
                    {deckCount}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setDeckCount(Math.min(4, deckCount + 1))}
                    disabled={deckCount >= 4}
                    className="w-10 h-10 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-xl"
                  >
                    +
                  </motion.button>
                </div>
                <div className="text-emerald-500 text-xs mt-2 text-center">
                  {deckCount === 1 ? '54 cards (1-5 players)' : `${deckCount * 54} cards`}
                  {game.players.length > 5 && deckCount === 1 && (
                    <span className="text-amber-400 ml-2">⚠️ Recommend 2+ decks</span>
                  )}
                </div>
              </div>

              {/* Error message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-sm"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Start button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleStartGame}
                disabled={game.players.length < 2}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Launch Game ({game.players.length}/2 min)
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setMode('menu')}
                className="w-full mt-3 py-2 text-emerald-400 font-medium rounded-xl transition-all hover:text-emerald-300"
              >
                ← Back
              </motion.button>
            </motion.div>
          )}

          {mode === 'join' && (
            <motion.div
              key="join"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-emerald-800/50 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-emerald-700/50"
            >
              <h2 className="text-2xl font-bold text-white mb-6 text-center">
                Join Game
              </h2>

              {/* If connected to a game, show lobby */}
              {game && game.players.length > 0 ? (
                <>
                  <div className="mb-6">
                    <div className="text-emerald-300 text-sm mb-3">
                      Waiting for host to start...
                    </div>
                    <div className="space-y-2">
                      {game.players.map((player, idx) => (
                        <motion.div
                          key={player.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="flex items-center gap-3 p-3 bg-emerald-700/30 rounded-xl"
                        >
                          <div className={`w-3 h-3 rounded-full ${player.isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
                          <span className="text-white font-medium flex-1">
                            {player.name} {player.id === peerId && '(You)'}
                          </span>
                          {player.isHost && (
                            <span className="text-xs px-2 py-0.5 bg-amber-500 text-amber-950 rounded-full font-bold">
                              Host
                            </span>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Code input */}
                  <div className="mb-6">
                    <label className="block text-emerald-200 text-sm mb-2 font-medium">
                      Game Code
                    </label>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Paste the game code"
                      className="w-full px-4 py-3 bg-emerald-900/50 border border-emerald-600 rounded-xl text-white placeholder-emerald-500 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all font-mono"
                    />
                  </div>

                  {/* Error message */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-sm"
                      >
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Join button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleJoinGame}
                    disabled={isConnecting}
                    className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                  >
                    {isConnecting ? 'Connecting...' : 'Join Game'}
                  </motion.button>
                </>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setMode('menu');
                  setError('');
                }}
                className="w-full mt-3 py-2 text-emerald-400 font-medium rounded-xl transition-all hover:text-emerald-300"
              >
                ← Back
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rules hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 text-center text-emerald-500 text-xs"
        >
          <p className="font-semibold">Goal: Have the lowest sum then call &quot;Reds!&quot;</p>
          <p className="mt-1">Card values: Joker=0, Ace=1, 2-10, Jack=11, Queen=12, Black King=13, Red King=-2</p>
          
          <ul className="mt-3 text-left text-emerald-400/80 space-y-1 max-w-md mx-auto">
            <li>• Start with 4 cards face-down, peek at your bottom 2</li>
            <li>• Draw from deck or discard pile, then swap or discard</li>
            <li>• <span className="text-amber-400">7:</span> Peek at one of your own cards</li>
            <li>• <span className="text-amber-400">8:</span> Peek at one opponent&apos;s card</li>
            <li>• <span className="text-amber-400">9:</span> Blind swap with an opponent</li>
            <li>• <span className="text-amber-400">10:</span> Look at opponent&apos;s card, then swap or keep</li>
            <li>• <span className="text-blue-400">Stack:</span> Triple-tap any card you know to be the same as the top card of the discard pile</li>
            <li>• Call <span className="text-red-400">&quot;Reds!&quot;</span> when ready — everyone else gets one final turn</li>
          </ul>
          
          <p className="mt-4 text-emerald-600/60"><span className="text-emerald-400">v</span><span className="text-emerald-500">1</span><span className="text-emerald-400">.</span><span className="text-emerald-500">1</span><span className="text-emerald-400">.</span><span className="text-emerald-500">2</span>-beta</p>
        </motion.div>
      </motion.div>
    </div>
  );
}

