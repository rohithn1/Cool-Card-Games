'use client';

import { useState, useEffect } from 'react';
import { Lobby } from '@/components/Lobby';
import { GameTable } from '@/components/GameTable';
import { useGameStore } from '@/store/gameStore';
import { getMultiplayerConnection } from '@/lib/multiplayer';
import { GameMessage, GameState } from '@/types/game';

export default function Home() {
  const [gameStarted, setGameStarted] = useState(false);
  const { game, peerId, isHost, syncState } = useGameStore();

  // Set up game state sync for non-host players
  useEffect(() => {
    if (!peerId || isHost) return;

    const mp = getMultiplayerConnection();
    
    const unsubscribe = mp.onMessage((message: GameMessage) => {
      if (message.type === 'state_sync' && message.payload) {
        syncState(message.payload as GameState);
      }
    });

    return () => { unsubscribe(); };
  }, [peerId, isHost, syncState, game]);

  // Broadcast state changes if host
  useEffect(() => {
    if (!isHost || !game || !gameStarted) return;

    const mp = getMultiplayerConnection();
    mp.broadcastState(game);
  }, [isHost, game, gameStarted]);

  const handleGameStart = () => {
    setGameStarted(true);
  };

  if (gameStarted && game && game.phase !== 'waiting') {
    return <GameTable />;
  }

  return <Lobby onGameStart={handleGameStart} />;
}
